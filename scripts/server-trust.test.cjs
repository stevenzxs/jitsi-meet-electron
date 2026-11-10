const { test } = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const { isPinnedCertificate, migrateOfficialUrl, OFFICIAL_URL } = require('../src/server-trust');
test('pin requires exact HTTPS origin, certificate and validity', () => {
  const data = fs.readFileSync(require.resolve('../src/certs/relay-118.pem'), 'utf8');
  const cert = new X509Certificate(data);
  const now = new Date(cert.validFrom).getTime() + 60000;
  assert.equal(isPinnedCertificate(OFFICIAL_URL, data, now), true);
  assert.equal(isPinnedCertificate('wss://118.193.36.35:8443/xmpp-websocket', data, now), true);
  assert.equal(isPinnedCertificate('ws://118.193.36.35:8443/xmpp-websocket', data, now), false);
  for (const url of ['http://118.193.36.35:8443', 'https://118.193.36.35', 'https://118.193.36.35:8444', 'https://evil.example:8443', 'https://118.193.36.35.evil.example:8443']) {
    assert.equal(isPinnedCertificate(url, data, now), false, url);
  }
  assert.equal(isPinnedCertificate(OFFICIAL_URL, 'invalid', now), false);
  // A parseable certificate with one changed signature byte is not the pinned leaf.
  const der = Buffer.from(cert.raw);
  der[der.length - 1] ^= 1;
  assert.equal(isPinnedCertificate(OFFICIAL_URL, der, now), false);
  assert.equal(isPinnedCertificate(OFFICIAL_URL, data, new Date(cert.validTo).getTime() + 1), false);
  assert.equal(isPinnedCertificate(OFFICIAL_URL, data, 0), false);
});
test('migrates only exact old official desktop URL, retaining custom paths/URLs', () => {
  assert.equal(migrateOfficialUrl('https://104.244.90.25:8443/cm/desktop'), OFFICIAL_URL);
  for (const url of ['', 'https://custom.example/cm/desktop', 'https://104.244.90.25:8443/other', 'https://104.244.90.25:8443/cm/desktop?custom=1']) assert.equal(migrateOfficialUrl(url), url);
});
test('main has no global certificate bypass', () => {
  const main = fs.readFileSync(require.resolve('../src/main.js'), 'utf8');
  assert.doesNotMatch(main, /appendSwitch\(['"]ignore-certificate-errors/);
  assert.doesNotMatch(main, /callback\(true\)/);
  assert.doesNotMatch(main, /app\.on\('certificate-error'/);
  // A private deployment may register strict verification without trusting other hosts.
  const registration = main.match(/if \(deploymentConfig\.origin === 'https:\/\/115\.190\.243\.21'\) \{([\s\S]*?)\n    \}/);
  assert.ok(registration, 'private CA registration must be scoped to the explicit deployment');
  assert.equal((main.match(/setCertificateVerifyProc/g) || []).length, 1);
  assert.match(registration[1], /origin: deploymentConfig\.origin/);
  assert.match(registration[1], /certs\/cloudmeet-115-root\.crt/);
  assert.match(registration[1], /verify\(request\)\.then\(callback, \(\) => callback\(-2\)\)/);
  const verifier = fs.readFileSync(require.resolve('../src/private-ca'), 'utf8');
  assert.match(verifier, /request\.hostname !== url\.hostname\) return -3/);
  assert.match(verifier, /rejectUnauthorized: true/);
  assert.match(verifier, /socket\.authorized && peer\.raw\?\.equals\(presented\.raw\)/);
});
