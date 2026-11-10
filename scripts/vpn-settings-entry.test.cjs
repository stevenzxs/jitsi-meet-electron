const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { handleVpnSettingsRequest } = require('../src/vpn-settings-entry');
test('only configured desktop frame origin can open local VPN settings', () => {
  const source = {};
  const frame = { contentWindow: source };
  const replies = [];
  let opened;
  source.postMessage = (...args) => replies.push(args);
  const event = { source, origin: 'https://104.244.90.25:8443', data: { type: 'cloudmeet-vpn-settings-open', requestId: 'test' } };
  const invoke = event => handleVpnSettingsRequest(event, frame, 'https://104.244.90.25:8443/cm/desktop', tab => { opened = tab; });
  invoke({ ...event, source: {} });
  invoke({ ...event, origin: 'https://192.168.199.202' });
  invoke({ ...event, origin: 'null' });
  assert.equal(opened, undefined);
  invoke(event);
  assert.equal(opened, 'vpn');
  assert.deepEqual(replies, [[{ type: 'cloudmeet-vpn-settings-opened', requestId: 'test' }, event.origin]]);
});
test('web desktop settings exposes VPN entry without native VPN operations', () => {
  const view = fs.readFileSync('../jitsi-meet-web/src/views/DesktopHomeView.vue', 'utf8');
  assert.match(view, /settingsTab = 'vpn'/);
  assert.match(view, /@click="openVpnSettings"/);
  assert.match(view, /打开本地 VPN 配置/);
  assert.doesNotMatch(view, /openVpnConnect|openVpnImport/);
});
