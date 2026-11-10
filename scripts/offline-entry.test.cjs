const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const nodes = Object.fromEntries(['offlineEntry', 'offlineSpinner', 'offlineFailure', 'offlineMessage', 'offlineVpn', 'offlineRetry'].map(id => [id, {
    hidden: true, textContent: '', addEventListener(type, fn) { this[type] = fn; },
  }]));
  const events = {}; let timeout; let loads = 0; let tab;
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/offline-entry.js'), 'utf8'), {
    window, URL, document: { getElementById: id => nodes[id], addEventListener: (name, fn) => events[name] = fn },
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {},
  });
  const source = {};
  const entry = window.createOfflineEntry({ frame: { contentWindow: source }, openSettings: value => { tab = value; }, reload: () => loads++ });
  return { nodes, events, entry, source, expire: () => timeout(), loads: () => loads, tab: () => tab };
}
test('offline shell exposes VPN settings before a remote page loads', () => {
  const f = fixture(); f.entry.start('https://example.com/cm/desktop');
  assert.equal(f.nodes.offlineEntry.hidden, false);
  f.expire(); assert.match(f.nodes.offlineMessage.textContent, /暂不可达/);
  f.nodes.offlineVpn.click(); assert.equal(f.tab(), 'vpn');
  f.nodes.offlineRetry.click(); assert.equal(f.loads(), 1);
});
test('connecting shows only spinner; timeout shows recovery; retry restores spinner', () => {
  const f = fixture(); f.entry.start('https://example.com/cm/desktop');
  assert.equal(f.nodes.offlineSpinner.hidden, false);
  assert.equal(f.nodes.offlineFailure.hidden, true);
  f.expire();
  assert.equal(f.nodes.offlineSpinner.hidden, true);
  assert.equal(f.nodes.offlineFailure.hidden, false);
  f.entry.start('https://example.com/cm/desktop');
  assert.equal(f.nodes.offlineSpinner.hidden, false);
  assert.equal(f.nodes.offlineFailure.hidden, true);
});
test('only trusted boot handshake hides fallback; connected VPN never reloads ready page', () => {
  const f = fixture(); f.entry.start('https://example.com/cm/desktop');
  const event = { source: f.source, origin: 'https://example.com', data: { type: 'cloudmeet-user-get' } };
  f.entry.message({ ...event, origin: 'https://evil.example' });
  assert.equal(f.nodes.offlineEntry.hidden, false);
  f.events['openvpn-state']({ detail: 'connected' }); assert.equal(f.loads(), 1);
  f.entry.message(event); assert.equal(f.nodes.offlineEntry.hidden, true);
  f.events['openvpn-state']({ detail: 'disconnected' });
  f.events['openvpn-state']({ detail: 'connected' }); assert.equal(f.loads(), 1);
});
test('settings button is not hidden outside meetings', () => {
  const css = fs.readFileSync(require.resolve('../src/styles.css'), 'utf8');
  assert.doesNotMatch(css, /#settingsBtn\s*\{\s*display:\s*none/);
});
