const http = require('node:http');
const https = require('node:https');
const { normalizeRoutes } = require('./openvpn-config');

function validateTestAddress(input, routes) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('请输入有效的 IPv4 HTTP/HTTPS 测试地址。');
  const text = input.trim();
  const match = /^https?:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?:[/?][^\s#]*)?$/i.exec(text);
  if (!match || match[1].split('.').some(part => Number(part) > 255 || String(Number(part)) !== part))
    throw new Error('测试地址仅支持 IPv4 HTTP/HTTPS，不允许域名、凭据或片段。');
  normalizeRoutes(match[1]);
  let url;
  try { url = new URL(text); } catch { throw new Error('测试地址或端口无效。'); }
  if (url.port === '0') throw new Error('测试端口无效。');
  const number = ip => ip.split('.').reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
  const ip = number(url.hostname);
  if (!normalizeRoutes((routes || []).join('\n')).some(route => {
    const [base, bits] = route.split('/');
    const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
    return ((ip & mask) >>> 0) === ((number(base) & mask) >>> 0);
  })) throw new Error('测试 IP 必须包含在已保存的分流目标中。');
  return url.href;
}

function requestProbe(address, { timeout = 5000 } = {}) {
  return new Promise(resolve => {
    const start = Date.now();
    let timer;
    const done = result => { clearTimeout(timer); resolve({ ...result, elapsedMs: Date.now() - start }); };
    const req = (address.startsWith('https:') ? https : http).get(address, {
      agent: false, headers: { Connection: 'close' }, maxHeaderSize: 8192,
    }, res => {
      // Never follow redirects, read response bodies or accept invalid TLS certificates.
      const statusCode = res.statusCode;
      res.destroy();
      done({ ok: statusCode >= 200 && statusCode < 300, statusCode });
    });
    req.on('error', () => done({ ok: false, message: '连接失败，请检查测试地址、VPN 或证书。' }));
    timer = setTimeout(() => req.destroy(new Error('timeout')), timeout);
  });
}
module.exports = { validateTestAddress, requestProbe };
