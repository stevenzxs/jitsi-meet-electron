const { isIP } = require('node:net');

const INLINE = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2']);
const OPTIONS = {
  client: /^$/, dev: /^tun$/, proto: /^(udp|udp4|tcp-client|tcp4-client)$/,
  remote: /^[a-zA-Z0-9][a-zA-Z0-9.-]*(?:\s+\d{1,5})?(?:\s+(?:udp|udp4|tcp-client|tcp4-client))?$/,
  port: /^\d{1,5}$/, 'resolv-retry': /^(infinite|\d{1,5})$/,
  nobind: /^$/, 'persist-key': /^$/, 'persist-tun': /^$/, 'remote-random': /^$/,
  'remote-cert-tls': /^server$/, 'verify-x509-name': /^[a-zA-Z0-9_.@*-]+(?:\s+(?:subject|name|name-prefix))?$/,
  cipher: /^[a-zA-Z0-9-]+$/, 'data-ciphers': /^[a-zA-Z0-9:-]+$/,
  'data-ciphers-fallback': /^[a-zA-Z0-9-]+$/, auth: /^[a-zA-Z0-9-]+$/,
  'auth-nocache': /^$/, 'auth-user-pass': /^$/, 'key-direction': /^[01]$/,
  'tls-version-min': /^1\.[23]$/, 'tls-cipher': /^[a-zA-Z0-9_:+!-]+$/,
  'tls-ciphersuites': /^[a-zA-Z0-9_:]+$/, verb: /^[0-4]$/, mute: /^\d{1,3}$/,
  'connect-timeout': /^\d{1,3}$/, 'connect-retry': /^\d{1,3}(?:\s+\d{1,3})?$/,
  'connect-retry-max': /^\d{1,3}$/, 'reneg-sec': /^\d{1,6}$/,
};

function normalizeRoutes(input) {
  if (typeof input !== 'string' || input.length > 16000) throw new Error('IP 路由列表无效。');
  const entries = input.split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean);
  if (!entries.length) throw new Error('请至少配置一个目标 IP 或网段。');
  if (entries.length > 128) throw new Error('最多配置 128 条 IP 路由。');
  return [...new Set(entries.map(value => {
    const match = /^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/.exec(value);
    if (!match || isIP(match[1]) !== 4) throw new Error(`无效的 IPv4 地址或网段：${value}`);
    const prefix = match[2] === undefined ? 32 : Number(match[2]);
    // Broad routes are deliberately disallowed: this UI is not a default-route switch.
    if (prefix < 8 || prefix > 32) throw new Error('IP 网段前缀必须为 /8 至 /32，禁止默认路由。');
    const parts = match[1].split('.').map(Number);
    const ip = parts.reduce((n, octet) => (n * 256 + octet) >>> 0, 0);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ip & mask) >>> 0;
    const first = network >>> 24;
    if (first === 0 || first === 127 || first >= 224 || (network >>> 16) === 0xa9fe) {
      throw new Error('不支持本机、链路本地、多播或保留 IP 路由。');
    }
    return `${[24, 16, 8, 0].map(shift => (network >>> shift) & 255).join('.')}/${prefix}`;
  }))];
}

function parseProfile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
    throw new Error('OpenVPN 配置无效或超过 1 MB。');
  }
  const result = [];
  const blocks = new Set();
  let block = '';
  let auth = false;
  let serverIdentity = false;
  let remote = false;
  for (const original of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = original.trim();
    if (block) {
      if (line === `</${block}>`) { result.push(line); block = ''; continue; }
      if (line.startsWith('<')) throw new Error('证书块未正确闭合。');
      result.push(original);
      continue;
    }
    if (!line || /^[#;]/.test(line)) continue;
    const inline = /^<([a-z0-9-]+)>$/.exec(line);
    if (inline) {
      if (!INLINE.has(inline[1]) || blocks.has(inline[1])) throw new Error('不支持或重复的内联配置块。');
      block = inline[1]; blocks.add(block); result.push(line); continue;
    }
    const match = /^(?:--)?([a-z][a-z0-9-]*)(?:\s+(.*))?$/.exec(line);
    if (!match || !OPTIONS[match[1]]?.test(match[2] || '')) {
      throw new Error(`不支持的 OpenVPN 配置项：${match?.[1] || '格式错误'}。请使用内联证书配置，不支持脚本、外部文件或自带路由。`);
    }
    const [, option, value = ''] = match;
    if (option === 'remote') {
      const port = value.split(/\s+/)[1];
      if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error('VPN 服务器端口无效。');
      remote = true;
    }
    if (option === 'port' && (Number(value) < 1 || Number(value) > 65535)) throw new Error('VPN 服务器端口无效。');
    if (option === 'auth-user-pass') { auth = true; continue; }
    if (option === 'remote-cert-tls') serverIdentity = true;
    result.push(`${option}${value ? ` ${value}` : ''}`);
  }
  if (block) throw new Error('内联证书块未闭合。');
  if (!remote) throw new Error('配置缺少 remote 服务器。');
  if (!serverIdentity) throw new Error('配置必须包含 remote-cert-tls server，以验证服务器身份。');
  if (!blocks.has('ca')) throw new Error('请将 CA 证书内联到 <ca> 配置块。');
  return { config: result.join('\n'), auth };
}

function buildConfig(profile, routes) {
  const normalized = normalizeRoutes(routes.join('\n'));
  return `${profile.config}\nclient\ndev tun\nwindows-driver wintun\nscript-security 0\nauth-nocache\nroute-nopull\n` +
    ['route ', 'route-ipv6', 'redirect-gateway', 'redirect-private', 'dhcp-option', 'dns', 'block-outside-dns',
      'register-dns', 'ifconfig-ipv6', 'tun-ipv6', 'ip-win32', 'route-method'].map(option => `pull-filter ignore "${option}"`).join('\n') + '\n' +
    normalized.map(value => {
      const [ip, prefix] = value.split('/');
      const mask = (0xffffffff << (32 - Number(prefix))) >>> 0;
      return `route ${ip} ${[24, 16, 8, 0].map(shift => (mask >>> shift) & 255).join('.')} vpn_gateway`;
    }).join('\n') + '\n';
}

module.exports = { parseProfile, normalizeRoutes, buildConfig };
