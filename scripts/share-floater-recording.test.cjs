const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('recording button follows live state and sends the existing media IPC action once', () => {
  const nodes = new Map();
  function node() {
    return { disabled: false, textContent: '', attrs: {}, events: {}, children: {},
      classList: { toggle() {} }, setAttribute(k,v) { this.attrs[k]=v; },
      toggleAttribute(k,v) { this.attrs[k]=v; },
      addEventListener(k,fn) { this.events[k]=fn; },
      querySelector(k) { return this.children[k] ||= node(); } };
  }
  let render; const actions=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/share-floater.js'),'utf8'), {
    document: { querySelector(k) { if (!nodes.has(k)) nodes.set(k,node()); return nodes.get(k); } },
    window: { shareFloater: { onState(fn) { render=fn; }, getState: () => ({then() {}}), media: a => actions.push(a) } },
  });
  const btn=nodes.get('#recordingBtn');
  const state=(active,busy=false) => ({active:true,media:{available:true,recording:{available:true,active,busy}}});
  render(state(false)); assert.equal(btn.querySelector('.label').textContent,'录屏'); assert.equal(btn.disabled,false);
  assert.equal(btn.hidden, false);
  btn.events.click(); btn.events.click(); assert.deepEqual(actions,['recording']);
  render(state(true)); assert.equal(btn.querySelector('.label').textContent,'停止录屏'); assert.equal(btn.attrs['aria-pressed'],'true');
  assert.equal(btn.querySelector('.icon--off').attrs.hidden,false);
  render(state(false,true)); assert.equal(btn.disabled,true);
  render(state(false)); assert.equal(btn.disabled,false);
  render({active:true,media:{available:false}}); assert.equal(btn.disabled,true);
  assert.equal(btn.hidden, true);
  render({active:true,media:{available:true,recording:{available:false}}});
  assert.equal(btn.hidden, true);
  const html=fs.readFileSync(path.join(__dirname,'../src/share-floater.html'),'utf8');
  assert.ok(html.indexOf('id="videoBtn"') < html.indexOf('id="recordingBtn"'));
  assert.ok(html.indexOf('id="recordingBtn"') < html.indexOf('id="participantsBtn"'));
});
