const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const run = require('node:util').promisify(require('node:child_process').execFile);
const root = path.join(__dirname, '..');
const runtimeFiles = ['openvpn.exe', 'openvpnserv.exe', 'openvpnservmsg.dll', 'libcrypto-3-x64.dll',
  'libssl-3-x64.dll', 'libpkcs11-helper-1.dll', 'vcruntime140.dll', 'wintun.dll'];
const x = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tool = name => process.env.WIX ? path.join(process.env.WIX, 'bin', `${name}.exe`) : `${name}.exe`;
const licenses = ['COPYING.md', 'gpl_2.0.txt', 'LICENSE_OpenSSL.txt', 'WINTUN-LICENSE.txt'];
function runtimeXml(version, stage, action = path.join(stage, '../InstallRoot.CA.dll')) {
  const files = [...runtimeFiles, ...licenses].map((name, index) => `<Component Id="Runtime${index}" Guid="*" Win64="yes">
    <File Id="File${index}" Name="${name}" Source="${x(path.join(stage, name))}" KeyPath="yes" />
    ${name === 'openvpnserv.exe' ? `<ServiceInstall Id="PrivateService" Name="CloudMeetVPN" DisplayName="CloudMeet VPN" Description="CloudMeet private VPN privilege helper" Type="ownProcess" Start="auto" ErrorControl="normal" Account="LocalSystem" Arguments="-instance interactive -CloudMeet" />
    <ServiceControl Id="PrivateServiceControl" Name="CloudMeetVPN" Start="install" Stop="both" Remove="uninstall" Wait="yes" />` : ''}
  </Component>`).join('\n');
  return String.raw`<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
<Product Id="*" Name="CloudMeet VPN Runtime" Language="1033" Version="${x(version)}" Manufacturer="CloudMeet" UpgradeCode="5C086AE0-89C6-40FC-A6FB-37B95C86AD19">
<Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Platform="x64" />
<MajorUpgrade DowngradeErrorMessage="A newer CloudMeet VPN Runtime is already installed." Schedule="afterInstallInitialize" />
<MediaTemplate EmbedCab="yes" />
<Property Id="CLOUDMEETROOT" Secure="yes" />
<Property Id="PREVIOUSROOT" Secure="yes"><RegistrySearch Id="PreviousRoot" Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="InstallRoot" Type="raw" Win64="yes" /></Property>
<Property Id="PREVIOUSEXE" Secure="yes"><RegistrySearch Id="PreviousExe" Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="exe_path" Type="raw" Win64="yes" /></Property>
<Condition Message="Uninstall the previous private VPN bundle before installing this version.">Installed OR NOT PREVIOUSEXE OR PREVIOUSROOT</Condition>
<Binary Id="InstallRootActions" SourceFile="${x(action)}" />
<CustomAction Id="SetProtectInstallRoot" Property="ProtectInstallRoot" Value="Root=[CLOUDMEETROOT];Previous=[PREVIOUSROOT];Default=[ProgramFiles64Folder]CloudMeet" />
<CustomAction Id="ProtectInstallRoot" BinaryKey="InstallRootActions" DllEntry="ProtectInstallRoot" Execute="deferred" Impersonate="no" Return="check" />
<InstallExecuteSequence>
<Custom Action="SetProtectInstallRoot" After="CostFinalize">NOT (REMOVE~="ALL")</Custom>
<Custom Action="ProtectInstallRoot" Before="CreateFolders">NOT (REMOVE~="ALL")</Custom>
</InstallExecuteSequence>
<Directory Id="TARGETDIR" Name="SourceDir"><Directory Id="ProgramFiles64Folder"><Directory Id="CLOUDMEETROOT" Name="CloudMeet"><Directory Id="RuntimeDir" Name="vpn">
${files}
<Directory Id="ConfigDir" Name="config"><Component Id="ConfigDirectory" Guid="*" Win64="yes"><CreateFolder /><RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="config_dir" Value="[ConfigDir]" Type="string" KeyPath="yes" /></Component></Directory>
<Directory Id="LogDir" Name="log"><Component Id="LogDirectory" Guid="*" Win64="yes"><CreateFolder /><RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="log_dir" Value="[LogDir]" Type="string" KeyPath="yes" /></Component></Directory>
<Component Id="RuntimeRegistry" Guid="*" Win64="yes">
<RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="InstallRoot" Value="[CLOUDMEETROOT]" Type="string" />
<RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Value="[RuntimeDir]" Type="string" KeyPath="yes" />
<RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="exe_path" Value="[RuntimeDir]openvpn.exe" Type="string" />
<RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="bin_dir" Value="[RuntimeDir]" Type="string" />
<RegistryValue Root="HKLM" Key="Software\OpenVPN-CloudMeet" Name="ovpn_admin_group" Value="CloudMeet VPN Administrators" Type="string" />
</Component>
</Directory></Directory></Directory></Directory>
<Feature Id="Runtime" Title="Private VPN runtime" Level="1">${[...runtimeFiles, ...licenses].map((_, i) => `<ComponentRef Id="Runtime${i}" />`).join('')}<ComponentRef Id="RuntimeRegistry" /><ComponentRef Id="ConfigDirectory" /><ComponentRef Id="LogDirectory" /></Feature>
</Product></Wix>`;
}
async function buildPrivateRuntime(version, vendorMsi) {
  const output = path.join(root, 'out', 'make', 'private-vpn', 'x64');
  const extracted = path.join(output, 'extracted');
  const stage = path.join(output, 'runtime');
  await fs.mkdir(stage, { recursive: true });
  await run(tool('dark'), ['-nologo', '-x', extracted, vendorMsi, '-o', path.join(output, 'vendor.wxs')], { timeout: 60000 });
  const sourceNames = { 'openvpn.exe': 'bin.openvpn.exe', 'libcrypto-3-x64.dll': 'libcrypto_3_x64.dll',
    'libssl-3-x64.dll': 'libssl_3_x64.dll', 'libpkcs11-helper-1.dll': 'libpkcs11_helper_1.dll' };
  for (const name of [...runtimeFiles.filter(file => file !== 'wintun.dll'), ...licenses.filter(file => file !== 'WINTUN-LICENSE.txt')]) {
    await fs.copyFile(path.join(extracted, 'File', sourceNames[name] || name), path.join(stage, name));
  }
  const pin = require('../vendor/openvpn/wintun.json');
  const archive = path.join(root, 'vendor', 'openvpn', pin.file);
  if (crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== pin.sha256) throw new Error('Wintun archive hash mismatch');
  const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const b64 = value => Buffer.from(value).toString('base64');
  const script = `$ErrorActionPreference='Stop'
$a=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(archive)}'))
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(path.join(output, 'wintun'))}'))
Expand-Archive -LiteralPath $a -DestinationPath $d -Force
$s=Get-AuthenticodeSignature -LiteralPath (Join-Path $d 'wintun\\bin\\amd64\\wintun.dll')
if($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${pin.signerThumbprint}'){throw 'Wintun signature invalid'}`;
  await run(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 60000 });
  await fs.copyFile(path.join(output, 'wintun', 'wintun', 'bin', 'amd64', 'wintun.dll'), path.join(stage, 'wintun.dll'));
  await fs.copyFile(path.join(output, 'wintun', 'wintun', 'LICENSE.txt'), path.join(stage, 'WINTUN-LICENSE.txt'));
  const source = path.join(output, 'CloudMeetVPN.wxs');
  const object = path.join(output, 'CloudMeetVPN.wixobj');
  const msi = path.join(output, 'CloudMeetVPN.msi');
  const action = await require('./build-install-root.cjs').buildInstallRoot(output);
  await fs.writeFile(source, runtimeXml(version, stage, action));
  await run(tool('candle'), ['-nologo', '-out', object, source], { timeout: 60000 });
  await run(tool('light'), ['-nologo', '-out', msi, object], { timeout: 120000 });
  return msi;
}
module.exports = { runtimeXml, runtimeFiles, buildPrivateRuntime };
