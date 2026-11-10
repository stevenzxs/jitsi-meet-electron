const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('new deployment uses normal certificate verification and configuration-owned entry', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.doesNotMatch(main, /isPinnedCertificate|118\.193\.36\.35|ignore-certificate-errors/);
  assert.match(main, /deploymentConfig\.origin === 'https:\/\/115\.190\.243\.21'/);
  assert.match(main, /createPrivateCaVerifier/);
  assert.match(main, /ipcMain\.handle\('server-save', \(\) => readStoredServerUrl\(\)\)/);
  // 明文 HTTP 测试入口的安全上下文放宽必须限定在配置 origin 本身。
  assert.match(main, /origin\.startsWith\('http:'\)/);
  assert.match(main, /unsafely-treat-insecure-origin-as-secure', deploymentConfig\.origin/);
});

test('deployment environment sets HTTPS desktop URL without code changes', () => {
  const { loadDeploymentConfig } = require('../src/deployment-config');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudmeet-config-'));
  const file = path.join(dir, 'deployment.env');
  try {
    fs.writeFileSync(file, 'SITE_DOMAIN=jks.zxs888.cn\n');
    assert.equal(loadDeploymentConfig({ file, env: {} }).desktopUrl, 'https://jks.zxs888.cn/cm/desktop');
    assert.equal(loadDeploymentConfig({ file, env: { SITE_DOMAIN: 'next.example.com' } }).desktopUrl, 'https://next.example.com/cm/desktop');
    for (const bad of ['http://bad.example', 'user@bad.example', 'bad.example/path', '', 'bad.example:443']) {
      assert.throws(() => loadDeploymentConfig({ file, env: { SITE_DOMAIN: bad } }));
    }
    assert.throws(() => loadDeploymentConfig({ file: path.join(dir, 'missing'), env: {} }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
