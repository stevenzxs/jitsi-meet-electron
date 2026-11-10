const { X509Certificate } = require('node:crypto');

const OFFICIAL_ORIGIN = 'https://118.193.36.35:8443';
const OFFICIAL_URL = `${OFFICIAL_ORIGIN}/cm/desktop`;
const PIN = 'CC896427E1F03EA481BDE4D1A4102189E6988ED0C4671B00E44A0917BBFF4FF5';

function isPinnedCertificate(rawUrl, data, now = Date.now()) {
  try {
    const url = new URL(rawUrl);
    // Jitsi signaling uses the same TLS identity over secure WebSockets.
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.origin !== OFFICIAL_ORIGIN || url.username || url.password) return false;
    const cert = new X509Certificate(data);
    return cert.fingerprint256.replace(/:/g, '') === PIN
      && cert.checkIP(url.hostname) === url.hostname
      && now >= Date.parse(cert.validFrom) && now <= Date.parse(cert.validTo);
  } catch { return false; }
}

function migrateOfficialUrl(url) {
  return url === 'https://104.244.90.25:8443/cm/desktop' ? OFFICIAL_URL : url;
}

module.exports = { OFFICIAL_ORIGIN, OFFICIAL_URL, isPinnedCertificate, migrateOfficialUrl };
