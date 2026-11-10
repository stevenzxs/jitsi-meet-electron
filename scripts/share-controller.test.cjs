const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createShareController } = require('../src/share-controller');

const screenSource = { id: 'screen:0:0', display_id: '202', name: 'Screen 2' };
const windowSource = { id: 'window:42:0', display_id: '', name: 'Presentation' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  const handlers = new Map();
  const windows = [];
  const children = [];
  const commands = [];
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.options = options; this.bounds = { ...options }; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.send = () => {}; windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setMenu() {} setAlwaysOnTop() {} setIgnoreMouseEvents() {} setContentProtection() {}
    loadFile(file) { this.file = file; this.emit('ready-to-show'); }
    showInactive() { this.visible = true; } show() { this.visible = true; }
    hide() { this.visible = false; }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.destroyed = true; this.emit('closed'); }
    }
    isMinimized() { return !!this.minimized; }
    minimize() { this.minimized = true; } restore() { this.minimized = false; } focus() { this.focused = true; }
  }
  const displays = [101, 202].map((id, i) => ({ id,
    bounds: { x: i * 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: i * 1920, y: 0, width: 1920, height: 1040 },
  }));
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getDisplayMatching: () => displays[0],
    screenToDipRect: (_win, bounds) => bounds,
  });
  const meeting = new Window(displays[0].bounds);
  let paused = false;
  let selection = null;
  let commandError = '';
  const frame = { processId: 7, routingId: 11, async executeJavaScript(script) {
    if (script.includes('.meetingState(')) return { available: true, audioMuted: true, videoMuted: true };
    if (script.includes('.meetingCommand(')) return { ok: true };
    const payload = JSON.parse(script.slice(script.indexOf('.command(') + 9, -1));
    commands.push(payload.action);
    if (commandError) return { ok: false, error: commandError };
    if (payload.action === 'pause') paused = true;
    if (['resume', 'switch'].includes(payload.action)) paused = false;
    return { ok: true, paused };
  } };
  meeting.webContents.mainFrame = { framesInSubtree: [frame] };
  const controller = createShareController({
    electron: { BrowserWindow: Window, screen, ipcMain: {
      handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => handlers.set(name, fn),
    } },
    selectSource: async (_parent, signal) => {
      if (typeof selection === 'function') return selection(signal);
      return selection;
    },
    getWindowIcon() {}, enableProtection() {}, disableProtection() {},
    spawnBounds: () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { this.killed = true; },
      });
      children.push(child); return child;
    },
  });
  t.after(() => controller.shutdown());
  const floater = () => windows.findLast(w => w.file?.endsWith('share-floater.html') && !w.destroyed);
  const border = () => windows.findLast(w => w.file?.endsWith('share-border.html') && !w.destroyed);
  async function action(name) {
    handlers.get('screenshare-floater-action')({ sender: floater().webContents }, name);
    await tick(); await tick();
  }
  return { controller, windows, meeting, frame, commands, children, floater, border, handlers, action,
    select(value) { selection = value; }, fail(message) { commandError = message; },
    async start(source = screenSource) {
      controller.authorize(frame, meeting, source, false);
      const grant = handlers.get('desktop-capture-claim')({ senderFrame: frame });
      assert.equal(handlers.get('desktop-capture-ready')({ senderFrame: frame }, grant.token), true);
      await tick(); return grant;
    },
  };
}

test('recording media IPC reaches only the owning meeting and publishes busy state', async t => {
  const app = setup(t); await app.start();
  const scripts=[]; const original=app.frame.executeJavaScript;
  let finish;
  app.frame.executeJavaScript = async script => {
    scripts.push(script);
    if (script.includes('.meetingCommand(')) await new Promise(resolve => { finish=resolve; });
    return original(script);
  };
  const handler=app.handlers.get('screenshare-floater-media');
  await handler({sender:{}},'recording');
  assert.equal(scripts.length,0);
  const pending=handler({sender:app.floater().webContents},'recording');
  assert.equal(app.controller.getState().mediaBusy,true);
  await handler({sender:app.floater().webContents},'recording');
  assert.equal(scripts.filter(s=>s.includes('.meetingCommand(')).length,1);
  assert.ok(scripts[0].includes('"recording"'));
  finish(); await pending;
  assert.equal(app.controller.getState().mediaBusy,false);
});

test('screen and window sharing both create a toolbar', async t => {
  const app = setup(t); await app.start(windowSource);
  assert.ok(app.floater()); assert.equal(app.controller.getState().sourceName, 'Presentation');
});
test('screen border matches display_id instead of parsed source id', async t => {
  const app = setup(t); await app.start(); assert.equal(app.border().bounds.x, 1920);
  assert.equal(app.floater().bounds.y, 8);
});
test('returning to meeting keeps toolbar and border alive', async t => {
  const app = setup(t); await app.start();
  app.handlers.get('screenshare-floater-show-meeting')({ sender: app.floater().webContents });
  assert.ok(app.border().visible); assert.ok(app.floater()); assert.ok(app.meeting.focused);
});
test('selecting and canceling a source does not stop or change active sharing', async t => {
  const app = setup(t); await app.start();
  let finish; app.select(() => new Promise(resolve => { finish = resolve; }));
  await app.action('switch');
  assert.deepEqual(app.commands, []); assert.ok(app.border().visible);
  finish(null); await tick();
  assert.equal(app.controller.getState().sourceName, 'Screen 2');
  assert.equal(app.controller.getState().busy, ''); assert.ok(app.floater());
});
test('paused sharing can select another source and cancel back to paused', async t => {
  const app = setup(t); await app.start(); await app.action('pause'); await app.action('switch');
  assert.equal(app.controller.getState().paused, true); assert.ok(app.floater());
  assert.deepEqual(app.commands, ['pause']);
});
test('screen to window replaces old border only after successful capture', async t => {
  const app = setup(t); await app.start(); const previous = app.border();
  app.select({ source: windowSource, shareAudio: false }); await app.action('switch');
  assert.equal(previous.destroyed, true); assert.notEqual(app.border(), previous);
  assert.equal(app.controller.getState().sourceType, 'window');
});
test('failed new capture preserves original source and paused state, permits retry', async t => {
  const app = setup(t); await app.start(); await app.action('pause'); const previous = app.border();
  app.select({ source: windowSource }); app.fail('source unavailable'); await app.action('switch');
  assert.equal(app.border(), previous); assert.equal(app.controller.getState().sourceName, 'Screen 2');
  assert.equal(app.controller.getState().paused, true); assert.equal(app.controller.getState().busy, '');
  assert.equal(app.controller.getState().error, 'source unavailable');
});
test('stop is available while a selector is pending and closes it', async t => {
  const app = setup(t); await app.start(); let aborted = false;
  app.select(signal => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(null); })));
  await app.action('switch'); await app.action('stop');
  assert.equal(aborted, true); assert.equal(app.controller.getState().active, false);
  assert.equal(app.floater(), undefined); assert.equal(app.border(), undefined);
});
test('foreign windows cannot control another meeting capture', async t => {
  const app = setup(t); await app.start();
  app.handlers.get('screenshare-floater-action')({ sender: {} }, 'stop'); await tick();
  assert.equal(app.controller.getState().active, true); assert.deepEqual(app.commands, []);
});
test('unrelated iframe navigation does not end sharing; capture navigation does', async t => {
  const app = setup(t); await app.start();
  app.meeting.webContents.emit('did-frame-navigate', {}, 'http://local/other', 200, 'OK', false, 8, 99);
  assert.equal(app.controller.getState().active, true);
  app.meeting.webContents.emit('did-frame-navigate', {}, 'http://local/meeting', 200, 'OK', false, 7, 11);
  assert.equal(app.controller.getState().active, false);
});
test('window bounds follow moves and hide while minimized', async t => {
  if (process.platform !== 'win32') return t.skip('Windows bounds provider');
  const app = setup(t); await app.start(windowSource);
  app.children[0].stdout.emit('data', Buffer.from(JSON.stringify({ valid: true, visible: true, x: -500, y: 100, width: 800, height: 600 }) + '\n'));
  assert.equal(app.border().bounds.x, -500); assert.equal(app.border().visible, true);
  app.children[0].stdout.emit('data', Buffer.from(JSON.stringify({ valid: true, visible: false }) + '\n'));
  assert.equal(app.border().visible, false);
});
test('idle toolbar collapses and hover expands it without ending sharing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(t); await app.start();
  t.mock.timers.tick(1801);
  assert.equal(app.controller.getState().collapsed, true); assert.equal(app.floater().bounds.height, 38);
  app.handlers.get('screenshare-floater-hover')({ sender: app.floater().webContents }, true);
  assert.equal(app.controller.getState().collapsed, false); assert.equal(app.floater().bounds.height, 94);
  assert.equal(app.controller.getState().active, true);
});
test('a nonresponsive frame times out and releases pending control state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(t); await app.start();
  app.frame.executeJavaScript = () => new Promise(() => {});
  await app.action('pause'); t.mock.timers.tick(35001); await tick();
  assert.equal(app.controller.getState().busy, '');
  assert.match(app.controller.getState().error, /超时/);
});
