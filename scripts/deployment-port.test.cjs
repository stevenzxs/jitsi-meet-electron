const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadDeploymentConfig } = require('../src/deployment-config');
test('deployment supports independent HTTPS port without weakening hostname validation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-port-'));
  const file = path.join(dir, 'deployment.env');
  try {
    fs.writeFileSync(file, 'SITE_DOMAIN=jks.zxs888.cn\nSITE_HTTPS_PORT=8443\n');
    assert.equal(loadDeploymentConfig({ file, env: {} }).desktopUrl, 'https://jks.zxs888.cn:8443/cm/desktop');
    assert.equal(loadDeploymentConfig({ file, env: { SITE_HTTPS_PORT: '443' } }).origin, 'https://jks.zxs888.cn');
    for (const port of ['0', '65536', 'oops']) assert.throws(() => loadDeploymentConfig({ file, env: { SITE_HTTPS_PORT: port } }));
    assert.throws(() => loadDeploymentConfig({ file, env: { SITE_DOMAIN: 'jks.zxs888.cn:8443' } }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('deployment supports plain-HTTP IPv4 test entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-ip-'));
  const file = path.join(dir, 'deployment.env');
  try {
    fs.writeFileSync(file, 'SITE_DOMAIN=8.149.234.37\nSITE_SCHEME=http\nSITE_PORT=8080\n');
    assert.equal(loadDeploymentConfig({ file, env: {} }).origin, 'http://8.149.234.37:8080');
    assert.equal(loadDeploymentConfig({ file, env: {} }).desktopUrl, 'http://8.149.234.37:8080/cm/desktop');
    assert.equal(loadDeploymentConfig({ file, env: { SITE_SCHEME: 'https', SITE_PORT: '443' } }).origin, 'https://8.149.234.37');
    assert.throws(() => loadDeploymentConfig({ file, env: { SITE_SCHEME: 'ftp' } }));
    assert.throws(() => loadDeploymentConfig({ file, env: { SITE_DOMAIN: '999.1.1.1' } }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
