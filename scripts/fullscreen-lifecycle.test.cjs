const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function harness() {
  const classes = new Set(), messages = [], frames = new Map();
  let next = 0;
  const rect = { width: 1280, height: 722 };
  const button = {};
  const frame = { getBoundingClientRect: () => rect, contentWindow: { postMessage: m => messages.push(m) } };
  const c = {
    frame, fullscreenBtn: { setAttribute(k, v) { button[k] = v; } },
    document: { body: { matches: () => true, classList: {
      toggle(k, enabled) { enabled ? classes.add(k) : classes.delete(k); }, contains: k => classes.has(k),
    } }, querySelector: () => ({ getBoundingClientRect: () => ({ height: 40 }) }) },
    window: { innerWidth: 1280, innerHeight: 800, outerWidth: 1280, outerHeight: 850,
      requestAnimationFrame(fn) { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id) },
  };
  const names = ['sendFullscreenStateToFrame', 'sendFullscreenControlsStateToFrame', 'sendWindowResizeToFrame',
    'scheduleFrameResizeSync', 'applyWindowFullscreenState', 'setFullscreenControlsVisible'];
  vm.createContext(c);
  vm.runInContext('let windowFullscreen=false, fullscreenControlsVisible=false, frameResizeSyncFrame=null, lastFrameResizeKey="";\n'
    + names.map(n => extract(renderer, n)).join('\n'), c);
  return { c, frame, rect, button, classes, frames, messages,
    flush() { const tasks = [...frames.values()]; frames.clear(); tasks.forEach(fn => fn()); } };
}

test('fullscreen round trips restore controls, labels and latest frame size without stale RAF work', () => {
  const { c, rect, button, classes, frames, messages, flush } = harness();
  for (let i = 0; i < 6; i++) {
    c.applyWindowFullscreenState(true);
    assert.equal(classes.has('window-fullscreen'), true);
    assert.equal(button['aria-label'], '退出全屏');
    rect.width = 1707;
    c.applyWindowFullscreenState(false);
    assert.equal(classes.has('fullscreen-controls-visible'), false);
    assert.equal(button['aria-label'], '全屏');
    assert.equal(frames.size, 1);
  }
  flush();
  const resized = messages.filter(m => m.type === 'cloudmeet-window-resized');
  assert.equal(resized.length, 1);
  assert.equal(resized[0].width, 1707);
  assert.equal(resized[0].fullscreen, false);
  assert.equal(messages.filter(m => m.type === 'cloudmeet-fullscreen-changed').length, 12);
})

test('same dimensions still report fullscreen/maximized changes but ignore duplicates and hidden frames', () => {
  const { c, rect, frame, classes, messages } = harness();
  c.sendWindowResizeToFrame(); c.sendWindowResizeToFrame();
  assert.equal(messages.length, 1);
  classes.add('win-maximized'); c.sendWindowResizeToFrame();
  assert.equal(messages.at(-1).maximized, true);
  c.applyWindowFullscreenState(true); c.sendWindowResizeToFrame();
  assert.equal(messages.at(-1).fullscreen, true);
  const count = messages.length;
  rect.width = 0; c.sendWindowResizeToFrame();
  frame.contentWindow = null; c.sendFullscreenStateToFrame(); c.sendWindowResizeToFrame();
  assert.equal(messages.length, count);
})

test('native and HTML fullscreen events report final state and close stops the watcher', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const states = [], stopped = [], win = new EventEmitter();
  win.isFullScreen = () => false;
  win.webContents = new EventEmitter();
  const c = { sendWindowFullscreenState: (_, value) => states.push(value),
    stopWindowFullscreenControlsWatcher: w => stopped.push(w) };
  vm.runInNewContext(extract(main, 'bindWindowFullscreenEvents'), c);
  c.bindWindowFullscreenEvents(win);
  for (const e of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen']) win.emit(e);
  assert.deepEqual(states, [true, false, true, false]);
  win.emit('closed');
  assert.deepEqual(stopped, [win]);
})
