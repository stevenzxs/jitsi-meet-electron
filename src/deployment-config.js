const fs = require('node:fs');

const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidHost(host) {
  if (host.length > 253) return false;
  if (HOSTNAME_RE.test(host)) return true;
  const ip = host.match(IPV4_RE);
  return Boolean(ip) && ip.slice(1).every(octet => Number(octet) <= 255);
}

function readKey(lines, key) {
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*([^#]*?)\\s*$`));
    if (match) return match[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/** Local administrator-controlled configuration; never download this from a page. */
function loadDeploymentConfig({ file, env = process.env }) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const host = env.SITE_DOMAIN ?? readKey(lines, 'SITE_DOMAIN');
  if (typeof host !== 'string' || !isValidHost(host)) {
    throw new Error(`Invalid or missing SITE_DOMAIN in ${file}: use a DNS hostname or IPv4 address`);
  }
  const scheme = String(env.SITE_SCHEME ?? readKey(lines, 'SITE_SCHEME') ?? 'https').toLowerCase();
  if (scheme !== 'https' && scheme !== 'http') throw new Error('Invalid SITE_SCHEME: use https or http');
  // SITE_HTTPS_PORT is kept as a legacy alias for already-installed clients.
  const port = env.SITE_PORT ?? readKey(lines, 'SITE_PORT')
    ?? env.SITE_HTTPS_PORT ?? readKey(lines, 'SITE_HTTPS_PORT')
    ?? String(scheme === 'https' ? 443 : 80);
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid SITE_PORT');
  const portNumber = Number(port);
  const isDefault = portNumber === (scheme === 'https' ? 443 : 80);
  const origin = `${scheme}://${host.toLowerCase()}${isDefault ? '' : `:${portNumber}`}`;
  return Object.freeze({ origin, desktopUrl: `${origin}/cm/desktop` });
}

module.exports = { loadDeploymentConfig };
