const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

// Only the locally configured deployment may use the bundled private authority.
// Node/OpenSSL validates the full chain, IP/DNS identity, validity and constraints.
// Compare the validated peer with Chromium's presented certificate, not just host.
function createPrivateCaVerifier({ origin, ca }) {
  const url = new URL(origin);
  return async request => {
    if (!ca || url.protocol !== 'https:' || request.hostname !== url.hostname) return -3;
    let presented;
    try { presented = new X509Certificate(request.certificate.data); }
    catch { return -2; }
    return new Promise(resolve => {
      let done = false;
      let socket;
      const finish = result => {
        if (done) return;
        done = true;
        socket?.destroy();
        resolve(result);
      };
      socket = tls.connect({
        host: url.hostname, port: Number(url.port || 443), ca,
        rejectUnauthorized: true,
        ...(require('node:net').isIP(url.hostname) ? {} : { servername: url.hostname }),
      }, () => {
        const peer = socket.getPeerCertificate();
        finish(socket.authorized && peer.raw?.equals(presented.raw) ? 0 : -2);
      });
      socket.setTimeout(10000, () => finish(-2));
      socket.on('error', () => finish(-2));
    });
  };
}
module.exports = { createPrivateCaVerifier };
