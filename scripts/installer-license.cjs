// RTF uses signed UTF-16 code units, not locale-dependent ANSI Chinese bytes.
function licenseRtf(text) {
  const escaped = text.replace(/\r\n/g, '\n').split('').map(char => {
    const code = char.charCodeAt(0);
    if (char === '\n') return '\\par\n';
    if ('\\{}'.includes(char)) return '\\' + char;
    return code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : char;
  }).join('');
  return `{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0 Microsoft YaHei UI;}}{\\colortbl;\\red70\\green82\\blue99;}\\f0\\fs18\\cf1\\sa100 ${escaped}}`;
}
module.exports = { licenseRtf };
