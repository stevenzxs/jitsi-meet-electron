const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProfile, normalizeRoutes, buildConfig } = require('../src/openvpn-config');
const profile = `client\ndev tun\nproto udp\nremote vpn.example.org 1194\nremote-cert-tls server\n<ca>\n-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n</ca>\nauth-user-pass\n`;
test('accepts inline profiles without exposing credentials', () => {
  const parsed = parseProfile(profile);
  assert.equal(parsed.auth, true);
  assert.match(parsed.config, /remote vpn.example.org/);
  assert.doesNotMatch(parsed.config, /^auth-user-pass/m);
});
test('canonicalizes and deduplicates explicit IPv4 routes', () => {
  assert.deepEqual(normalizeRoutes('10.0.0.7\n10.2.3.4/16\n10.0.0.7/32'), ['10.0.0.7/32', '10.2.0.0/16']);
  for (const value of ['0.0.0.0/0', '10.0.0.1/1', '127.0.0.1', '224.1.1.1', '::1', '01.2.3.4', '300.2.3.4', '10.0.0.2\nup evil']) {
    assert.throws(() => normalizeRoutes(value), /IP|网段|路由/);
  }
  assert.throws(() => normalizeRoutes(''), /至少/);
});
test('rejects executable, file, route, DNS and unsupported options', () => {
  for (const line of ['up evil.exe', 'plugin evil.dll', 'config other.ovpn', 'ca ca.crt', 'management 0.0.0.0 1234',
    'redirect-gateway def1', 'route 0.0.0.0 0.0.0.0', 'dhcp-option DNS 1.1.1.1', 'setenv opt up evil',
    'ip-win32 dynamic', 'dev tap', 'remote vpn.example.org 1194 udp6', 'auth-user-pass pass.txt',
    'remote-cert-tls client', 'remote vpn.example.org 1194\n<connection>\nup evil\n</connection>']) {
    assert.throws(() => parseProfile(`${profile}\n${line}`));
  }
  assert.throws(() => parseProfile(profile.replace('remote-cert-tls server', '')), /身份/);
  assert.throws(() => parseProfile(profile + '\n<ca>\nunclosed'), /闭合|重复/);
});
test('generates only selected routes and rejects server takeover', () => {
  const config = buildConfig(parseProfile(profile), ['10.0.0.7/32', '10.2.0.0/16']);
  assert.match(config, /^route 10\.0\.0\.7 255\.255\.255\.255 vpn_gateway$/m);
  assert.match(config, /^route 10\.2\.0\.0 255\.255\.0\.0 vpn_gateway$/m);
  assert.match(config, /^route-nopull$/m);
  assert.match(config, /pull-filter ignore "redirect-gateway"/);
  assert.match(config, /pull-filter ignore "dhcp-option"/);
  assert.match(config, /^script-security 0$/m);
  assert.match(config, /^windows-driver wintun$/m);
  assert.doesNotMatch(config, /^auth-user-pass/m);
});
