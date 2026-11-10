const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const root = path.join(__dirname, '..');
const payload = require('../vendor/openvpn/payload.json');
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function verifyPayload(metadata = payload) {
  const file = path.join(root, 'vendor', 'openvpn', metadata.file);
  const hash = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if (hash !== metadata.sha256) throw new Error('OpenVPN 组件 SHA-256 不匹配，禁止打包。');
  const encoded = Buffer.from(file, 'utf8').toString('base64');
  const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$s=Get-AuthenticodeSignature -LiteralPath $p
if($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${metadata.signerThumbprint}'){throw 'Invalid OpenVPN signature'}
Write-Output 'verified'`;
  const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 60000, windowsHide: true });
  return file;
}
function bundleXml({ version, vpnMsi, appMsi, license, theme = path.join(root, 'vendor/openvpn/installer-theme.xml') }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi" xmlns:bal="http://schemas.microsoft.com/wix/BalExtension" xmlns:util="http://schemas.microsoft.com/wix/UtilExtension">
  <Bundle Name="CloudMeet" Version="${escape(version)}" Manufacturer="CloudMeet" IconSourceFile="${escape(path.join(root, 'assets/icons/zhsz.ico'))}" UpgradeCode="694ECE45-1A97-4FBB-9763-601C6CC14C34" Compressed="yes">
    <BootstrapperApplicationRef Id="WixStandardBootstrapperApplication.RtfLicense">
      <bal:WixStandardBootstrapperApplication LicenseFile="${escape(license)}" ThemeFile="${escape(theme)}" SuppressOptionsUI="yes" />
      <Payload SourceFile="${escape(path.join(root, 'assets/icons/zhsz-48.png'))}" Name="cloudmeet-brand.png" Compressed="yes" />
    </BootstrapperApplicationRef>
    <Chain>
      <MsiPackage Id="CloudMeetVPN" SourceFile="${escape(vpnMsi)}" DisplayInternalUI="no" Compressed="yes" Vital="yes">
        <MsiProperty Name="CLOUDMEETROOT" Value="[ProgramFiles64Folder]CloudMeet" />
      </MsiPackage>
      <MsiPackage Id="CloudMeet" SourceFile="${escape(appMsi)}" DisplayInternalUI="no" Compressed="yes" Vital="yes">
        <MsiProperty Name="APPLICATIONROOTDIRECTORY" Value="[ProgramFiles64Folder]CloudMeet" />
      </MsiPackage>
    </Chain>
  </Bundle>
</Wix>`;
}
async function buildBundle(results, version) {
  if (process.platform !== 'win32') return results;
  const result = results.find(item => item.platform === 'win32' && item.arch === 'x64' && item.artifacts.some(file => file.endsWith('.msi')));
  if (!result) throw new Error('OpenVPN 安装版目前仅支持 Windows x64 MSI。');
  const appMsi = result.artifacts.find(file => file.endsWith('.msi'));
  const vendorMsi = await verifyPayload();
  const vpnMsi = await require('./private-openvpn.cjs').buildPrivateRuntime(version, vendorMsi);
  const output = path.join(root, 'out', 'make', 'openvpn', 'x64');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(output, 'CloudMeetBundle.wxs');
  const object = path.join(output, 'CloudMeetBundle.wixobj');
  const installer = path.join(output, `CloudMeet-${version}-with-OpenVPN-x64.exe`);
  const license = path.join(output, 'installer-license.rtf');
  await fs.writeFile(license, require('./installer-license.cjs').licenseRtf(await fs.readFile(path.join(root, 'vendor/openvpn/installer-license.txt'), 'utf8')));
  const theme = path.join(output, 'installer-theme.xml');
  await fs.copyFile(path.join(root, 'vendor/openvpn/installer-theme.xml'), theme);
  await fs.writeFile(source, bundleXml({ version, vpnMsi, appMsi, license, theme }));
  const wix = process.env.WIX ? path.join(process.env.WIX, 'bin') : '';
  await run(wix ? path.join(wix, 'candle.exe') : 'candle.exe', ['-nologo', '-ext', 'WixBalExtension', '-ext', 'WixUtilExtension', '-out', object, source], { timeout: 120000 });
  await run(wix ? path.join(wix, 'light.exe') : 'light.exe', ['-nologo', '-ext', 'WixBalExtension', '-ext', 'WixUtilExtension', '-out', installer, object], { timeout: 120000 });
  // Standalone MSI and ZIP are intermediate artifacts, not the integrated Windows installer.
  result.artifacts = [installer];
  return results;
}
if (require.main === module) verifyPayload().then(file => console.log(`Verified OpenVPN prerequisite: ${file}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyPayload, bundleXml, buildBundle };
