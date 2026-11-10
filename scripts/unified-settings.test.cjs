const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { handleVpnSettingsRequest } = require('../src/vpn-settings-entry');
test('client preferences opens local profile panel with validated sender and acknowledgement', () => {
  let tab; let response;
  const source = { postMessage: data => response = data };
  const frame = { contentWindow: source };
  const event = { source, origin: 'https://example.com', data: { type: 'cloudmeet-preferences-open', requestId: 'one' } };
  assert.equal(handleVpnSettingsRequest(event, frame, 'https://example.com/cm/desktop', value => tab = value), true);
  assert.equal(tab, 'profile');
  assert.equal(response.type, 'cloudmeet-preferences-opened');
  tab = undefined;
  handleVpnSettingsRequest({ ...event, origin: 'https://evil.example' }, frame, 'https://example.com', value => tab = value);
  assert.equal(tab, undefined);
});
test('local settings main has bounded height and shrinkable scroll content', () => {
  const css = fs.readFileSync(require.resolve('../src/styles.css'), 'utf8');
  assert.match(css, /\.settings-dialog__main\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.settings-dialog__panel\s*\{[^}]*flex:\s*1 1 auto/);
});
test('Web has no duplicate preferences entry; local titlebar keeps settings', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../jitsi-meet-web/src/views/DesktopHomeView.vue'), 'utf8');
  assert.doesNotMatch(source, /title="客户端偏好"|aria-label="客户端偏好"|@click="openSettings"/);
  const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
  assert.match(html, /id="settingsBtn"/);
});
