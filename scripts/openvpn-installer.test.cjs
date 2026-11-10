const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bundleXml, verifyPayload } = require('./build-openvpn-bundle.cjs');
test('offline bootstrapper chains vendor and app packages with protected shared prerequisite', () => {
  const xml = bundleXml({ version: '1.0.0', vpnMsi: 'C:\\test&dir\\vpn.msi', appMsi: 'C:\\app.msi', license: 'C:\\license.rtf' });
  assert.match(xml, /vpn\.msi/);
  assert.doesNotMatch(xml, /Permanent="yes"|OpenVPN\.GUI|ADDLOCAL/);
  assert.match(xml, /Vital="yes"/);
  assert.match(xml, /Compressed="yes"/);
  assert.match(xml, /test&amp;dir/);
  assert.match(xml, /WixStandardBootstrapperApplication/);
  assert.match(xml, /<Payload SourceFile="[^"]*zhsz-48\.png" Name="cloudmeet-brand\.png" Compressed="yes" \/>/);
  assert.equal(xml.indexOf('Id="CloudMeetVPN"') < xml.indexOf('Id="CloudMeet"'), true);
});
test('payload verification rejects missing MSI and hash mismatch before signature execution', async () => {
  await assert.rejects(verifyPayload({ file: 'missing.msi', sha256: '0'.repeat(64) }), /组件|ENOENT/);
});
test('bundle always forwards system default root without restoring custom paths', () => {
  const xml = bundleXml({ version: '1.0.0', vpnMsi: 'vpn.msi', appMsi: 'app.msi', license: 'license.rtf', theme: 'theme.xml' });
  assert.doesNotMatch(xml, /Variable Name="InstallFolder"|RegistrySearch|Persisted="yes"/);
  assert.match(xml, /SuppressOptionsUI="yes"/);
  assert.match(xml, /ThemeFile="theme.xml"/);
  assert.match(xml, /MsiProperty Name="APPLICATIONROOTDIRECTORY" Value="\[ProgramFiles64Folder\]CloudMeet/);
  const vpn = xml.slice(xml.indexOf('<MsiPackage Id="CloudMeetVPN"'), xml.indexOf('<MsiPackage Id="CloudMeet"'));
  assert.match(vpn, /MsiProperty Name="CLOUDMEETROOT" Value="\[ProgramFiles64Folder\]CloudMeet/);
});
test('theme has no directory selector and keeps safe bottom spacing', () => {
  const theme = require('node:fs').readFileSync(require.resolve('../vendor/openvpn/installer-theme.xml'), 'utf8');
  assert.doesNotMatch(theme, /应用目录：|VPN 固定目录|后台服务：|\[InstallFolder\]/);
  assert.doesNotMatch(theme, /OptionsButton|FolderEditbox|BrowseButton|Page Name="Options"|更改安装位置|可选择安装目录/);
  assert.match(theme, /系统默认目录/);
  const forge = require('node:fs').readFileSync(require.resolve('../forge.config.js'), 'utf8');
  assert.match(forge, /chooseDirectory: false/);
  const height = Number(theme.match(/<Window[^>]*Height="(\d+)"/)[1]);
  for (const match of theme.matchAll(/<Button[^>]*Y="(\d+)"[^>]*Height="(\d+)"/g)) {
    assert.ok(Number(match[1]) + Number(match[2]) <= height - 65, 'buttons must leave room for nonclient frame and padding');
  }
});
test('installer uses CloudMeet branding and Chinese-first third-party disclosure', () => {
  const fs = require('node:fs');
  const theme = fs.readFileSync(require.resolve('../vendor/openvpn/installer-theme.xml'), 'utf8');
  assert.match(theme, /安装 CloudMeet/);
  assert.doesNotMatch(theme, /CloudMeet · 私有 VPN/);
  assert.match(theme, /<Image[^>]*ImageFile=/);
  assert.match(theme, /ImageFile="cloudmeet-brand\.png"/);
  assert.doesNotMatch(theme, /@BRAND_IMAGE@|ImageFile="[A-Za-z]:\\/);
  const xml = bundleXml({ version: '1.0.0', vpnMsi: 'vpn.msi', appMsi: 'app.msi', license: 'license.rtf' });
  assert.match(xml, /IconSourceFile=/);
  const text = fs.readFileSync(require.resolve('../vendor/openvpn/installer-license.txt'), 'utf8');
  for (const term of ['管理员', 'OpenVPN', 'Wintun', 'GPL', '所有应用', '断网保护', 'https://github.com/OpenVPN/openvpn']) assert.ok(text.includes(term), term);
});
test('RTF disclosure escapes braces and encodes Chinese independently of Windows locale', () => {
  const { licenseRtf } = require('./installer-license.cjs');
  const rtf = licenseRtf('中{文}\\\n');
  assert.match(rtf, /\\u20013\?/);
  assert.match(rtf, /\\\{.*\\\}/);
  assert.match(rtf, /\\par/);
  assert.ok([...rtf].every(char => char.charCodeAt(0) < 128));
});
