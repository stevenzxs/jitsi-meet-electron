const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createPrivateCaVerifier } = require('../src/private-ca');

test('unconfigured deployments preserve Chromium verification', async () => {
  const verify = createPrivateCaVerifier({ origin: 'https://example.com', ca: null });
  assert.equal(await verify({ hostname: 'example.com' }), -3);
});
test('private CA is not trusted for other hosts', async () => {
  const ca = fs.readFileSync('src/certs/cloudmeet-115-root.crt');
  const verify = createPrivateCaVerifier({ origin: 'https://115.190.243.21', ca });
  assert.equal(await verify({ hostname: 'example.com' }), -3);
});
test('malformed presented certificate fails closed for deployment host', async () => {
  const ca = fs.readFileSync('src/certs/cloudmeet-115-root.crt');
  const verify = createPrivateCaVerifier({ origin: 'https://115.190.243.21', ca });
  assert.equal(await verify({ hostname: '115.190.243.21', certificate: { data: 'invalid' } }), -2);
});
test('live deployment chain and presented peer validate against bundled CA', async () => {
  const ca = fs.readFileSync('src/certs/cloudmeet-115-root.crt');
  const cert = await new Promise((resolve, reject) => {
    const socket = require('node:tls').connect({ host: '115.190.243.21', port: 443, ca }, () => {
      const peer = socket.getPeerCertificate();
      socket.destroy();
      resolve(new (require('node:crypto').X509Certificate)(peer.raw).toString());
    });
    socket.setTimeout(10000, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
  });
  const verify = createPrivateCaVerifier({ origin: 'https://115.190.243.21', ca });
  assert.equal(await verify({ hostname: '115.190.243.21', certificate: { data: cert } }), 0);
  assert.equal(await verify({ hostname: '115.190.243.21', certificate: { data: ca } }), -2);
});
