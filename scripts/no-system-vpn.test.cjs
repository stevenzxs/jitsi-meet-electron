const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(require.resolve(`../src/${file}`), 'utf8');
test('settings exposes integrated OpenVPN, not Windows system VPN', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /Windows 系统 VPN|id="vpnProfile"|src="\.\/vpn-panel.js"/);
  assert.match(html, /id="ovpnConnect"/);
  assert.match(html, /src="\.\/openvpn-panel.js"/);
});
test('system VPN commands are not exposed or registered', () => {
  assert.doesNotMatch(read('preload.js'), /listVpn\(|connectVpn\(|disconnectVpn\(|openVpnSettings\(/);
  assert.doesNotMatch(read('main.js'), /createWindowsVpn|windowsVpn\[|vpn-open-settings|ms-settings:network-vpn/);
  assert.match(read('preload.js'), /openVpnConnect\(/);
});
