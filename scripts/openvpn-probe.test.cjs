const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validateTestAddress, requestProbe } = require('../src/openvpn-probe');
test('probe allows only canonical IPv4 HTTP addresses in selected routes', () => {
  assert.equal(validateTestAddress('http://10.8.0.1/vpn-probe', ['10.8.0.0/24']), 'http://10.8.0.1/vpn-probe');
  for (const address of ['http://example.com', 'http://127.0.0.1', 'http://169.254.169.254', 'file:///etc/passwd',
    'http://10.8.0.2', 'http://user:pass@10.8.0.1', 'http://0x0a080001', 'http://010.8.0.1', 'http://10.8.0.1/#x', 'http://10.8.0.1:0']) {
    assert.throws(() => validateTestAddress(address, ['10.8.0.1/32']), undefined, address);
  }
});
test('probe does not follow redirects and enforces a total timeout', async t => {
  let redirected = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    if (req.url === '/other') redirected = true;
    res.writeHead(302, { Location: '/other' }); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await requestProbe(base)).statusCode, 302);
  assert.equal(redirected, false);
  assert.equal((await requestProbe(base + '/hang', { timeout: 50 })).ok, false);
});
