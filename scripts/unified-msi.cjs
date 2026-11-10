const fs = require('node:fs/promises');
const path = require('node:path');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { runtimeXml, buildPrivateRuntime } = require('./private-openvpn.cjs');
const root = path.join(__dirname, '..');
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tool = name => process.env.WIX ? path.join(process.env.WIX, 'bin', `${name}.exe`) : `${name}.exe`;

function unifiedXml(version, stage, action, appFiles, appDir = 'C:/app') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('MSI requires a numeric major.minor.patch version');
  if (!appFiles.includes('cloudmeet.exe')) throw new Error('Packaged cloudmeet.exe is missing');
  const tree = { files: [], children: new Map() };
  appFiles.forEach((file, index) => {
    const parts = file.split('/');
    let node = tree;
    for (const part of parts.slice(0, -1)) {
      if (!node.children.has(part)) node.children.set(part, { files: [], children: new Map() });
      node = node.children.get(part);
    }
    node.files.push({ file, index, name: parts.at(-1) });
  });
  let directoryId = 0;
  function render(node) {
    return node.files.map(({ file, index, name }) => `<Component Id="App${index}" Guid="*" Win64="yes"><File Id="AppFile${index}" Name="${escape(name)}" Source="${escape(path.join(appDir, file))}" KeyPath="yes">${file === 'cloudmeet.exe' ? '<Shortcut Id="CloudMeetShortcut" Name="CloudMeet" Advertise="yes" Directory="ProgramMenuFolder" WorkingDirectory="CLOUDMEETROOT" />' : ''}</File></Component>`).join('\n')
      + [...node.children].map(([name, child]) => `<Directory Id="AppDir${directoryId++}" Name="${escape(name)}">${render(child)}</Directory>`).join('\n');
  }
  const appXml = render(tree).replace('WorkingDirectory="CLOUDMEETROOT" />', 'WorkingDirectory="CLOUDMEETROOT" /><Shortcut Id="CloudMeetDesktopShortcut" Name="CloudMeet" Advertise="yes" Directory="DesktopFolder" WorkingDirectory="CLOUDMEETROOT" />')
    .replaceAll('WorkingDirectory="CLOUDMEETROOT"', 'Icon="CloudMeetIcon" IconIndex="0" WorkingDirectory="CLOUDMEETROOT"');
  let xml = runtimeXml(version, stage, action)
    .replace('Name="CloudMeet VPN Runtime"', 'Name="CloudMeet"')
    .replace('5C086AE0-89C6-40FC-A6FB-37B95C86AD19', 'CF24C64F-7B2E-43DE-92E9-581984AD2437')
    .replace('A newer CloudMeet VPN Runtime is already installed.', 'A newer CloudMeet is already installed.')
    .replace('Installed OR NOT PREVIOUSEXE OR PREVIOUSROOT', 'Installed OR WIX_UPGRADE_DETECTED OR NOT PREVIOUSEXE')
    .replace('Uninstall the previous private VPN bundle before installing this version.', 'Uninstall the previous CloudMeet bundle and VPN runtime before installing this unified MSI.')
    .replace('<Directory Id="RuntimeDir" Name="vpn">', `${appXml}<Directory Id="RuntimeDir" Name="vpn">`)
    .replace('Title="Private VPN runtime"', 'Title="CloudMeet and VPN"')
    .replace('<ComponentRef Id="RuntimeRegistry" />', `${appFiles.map((_, i) => `<ComponentRef Id="App${i}" />`).join('')}<ComponentRef Id="UninstallShortcut" /><ComponentRef Id="RuntimeRegistry" />`)
    .replace('<Directory Id="TARGETDIR" Name="SourceDir">', '<Directory Id="TARGETDIR" Name="SourceDir"><Directory Id="ProgramMenuFolder" /><Directory Id="DesktopFolder" />')
    .replace('<Property Id="CLOUDMEETROOT" Secure="yes" />', `<Property Id="ARPNOMODIFY" Value="1" /><Icon Id="CloudMeetIcon" SourceFile="${escape(path.join(root, 'assets/icons/zhsz.ico'))}" /><Property Id="ARPPRODUCTICON" Value="CloudMeetIcon" />`)
    .replace('<Feature Id="Runtime"', '<DirectoryRef Id="ProgramMenuFolder"><Component Id="UninstallShortcut" Guid="*" Win64="yes"><Shortcut Id="CloudMeetUninstallShortcut" Name="Uninstall CloudMeet" Target="[System64Folder]msiexec.exe" Arguments="/x [ProductCode]" Icon="CloudMeetIcon" IconIndex="0" /><RegistryValue Root="HKCU" Key="Software\\CloudMeetUnified" Name="UninstallShortcut" Type="integer" Value="1" KeyPath="yes" /></Component></DirectoryRef><Feature Id="Runtime"');
  // Refuse legacy app-only MSI even if its VPN runtime has been removed.
  xml = xml.replace('<Binary Id="InstallRootActions"', '<Property Id="LEGACYCLOUDMEET"><RegistrySearch Id="LegacyApp" Root="HKCU" Key="Software\\Microsoft\\CloudMeet" Name="installed" Type="raw" /></Property><Condition Message="Uninstall the previous CloudMeet installer before installing the unified MSI.">Installed OR WIX_UPGRADE_DETECTED OR NOT LEGACYCLOUDMEET</Condition><Binary Id="InstallRootActions"');
  // Advertised shortcut icon keys must have the same extension as their EXE key file (ICE50).
  return xml.replaceAll('CloudMeetIcon', 'CloudMeetIcon.exe')
    .replace(/<MajorUpgrade[^>]*\/>/, `<Upgrade Id="CF24C64F-7B2E-43DE-92E9-581984AD2437">
      <UpgradeVersion Maximum="${escape(version)}" IncludeMaximum="yes" Property="WIX_UPGRADE_DETECTED" MigrateFeatures="yes" />
      <UpgradeVersion Minimum="${escape(version)}" IncludeMinimum="no" OnlyDetect="yes" Property="WIX_DOWNGRADE_DETECTED" />
      </Upgrade>
      <Condition Message="已安装更新版本的 CloudMeet，无法安装此版本。">Installed OR NOT WIX_DOWNGRADE_DETECTED</Condition>`)
    .replace('<Binary Id="InstallRootActions"', `<Property Id="CLOUDMEET_REINSTALL" Secure="yes" />
      <CustomAction Id="CheckInstallVersion" BinaryKey="InstallRootActions" DllEntry="CheckInstallVersion" Execute="immediate" Return="check" />
      <InstallUISequence><Custom Action="CheckInstallVersion" Before="LaunchConditions">NOT (REMOVE~="ALL") AND NOT UPGRADINGPRODUCTCODE</Custom></InstallUISequence>
      <Binary Id="InstallRootActions"`)
    .replace('<InstallExecuteSequence>', '<InstallExecuteSequence><RemoveExistingProducts After="InstallInitialize" /><Custom Action="CheckInstallVersion" Before="LaunchConditions">NOT (REMOVE~="ALL") AND NOT UPGRADINGPRODUCTCODE</Custom>')
    .replace('Language="1033"', 'Language="2052" Codepage="936"')
    .replace('<Package InstallerVersion=', '<Package SummaryCodepage="936" InstallerVersion=')
    .replace('A newer CloudMeet is already installed.', '已安装更新版本的 CloudMeet，无法安装此版本。')
    .replace('Uninstall the previous CloudMeet bundle and VPN runtime before installing this unified MSI.', '请先卸载旧版 CloudMeet 集成包及 VPN 运行时，再安装此集成包。')
    .replace('Uninstall the previous CloudMeet installer before installing the unified MSI.', '请先卸载旧版 CloudMeet，再安装此集成包。')
    .replace('Name="Uninstall CloudMeet"', 'Name="卸载 CloudMeet"')
    .replace('Title="CloudMeet and VPN"', 'Title="CloudMeet 及 VPN"')
    .replace('</Product>', `<UI Id="CloudMeetProgressUI">
      <TextStyle Id="WixUI_Font_Normal" FaceName="Tahoma" Size="8" />
      <TextStyle Id="WixUI_Font_Bigger" FaceName="Tahoma" Size="12" />
      <TextStyle Id="WixUI_Font_Title" FaceName="Tahoma" Size="9" Bold="yes" />
      <Property Id="DefaultUIFont" Value="WixUI_Font_Normal" />
      <DialogRef Id="ProgressDlg" /><DialogRef Id="ErrorDlg" />
      <DialogRef Id="FilesInUse" /><DialogRef Id="MsiRMFilesInUse" />
      <DialogRef Id="FatalError" /><DialogRef Id="UserExit" /><DialogRef Id="ExitDialog" />
      <Publish Dialog="ExitDialog" Control="Finish" Event="EndDialog" Value="Return" Order="999">1</Publish>
      <InstallUISequence>
        <Show Dialog="FatalError" OnExit="error" />
        <Show Dialog="UserExit" OnExit="cancel" />
        <Show Dialog="ExitDialog" OnExit="success" />
        <Show Dialog="ProgressDlg" Before="ExecuteAction" />
      </InstallUISequence>
    </UI><UIRef Id="WixUI_Common" /></Product>`);
}
async function listFiles(dir, relative = '') {
  const entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true });
  const groups = await Promise.all(entries.map(e => {
    if (e.isSymbolicLink()) throw new Error('Installer payload must not contain links');
    const file = relative ? `${relative}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, file) : [file];
  }));
  return groups.flat().sort();
}
async function findSigntool() {
  if (process.env.SIGNTOOL_PATH) return process.env.SIGNTOOL_PATH;
  const kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  const versions = await fs.readdir(kitsRoot).catch(() => []);
  const candidates = versions.filter(v => /^\d+\.\d+\.\d+\.\d+$/.test(v)).sort().reverse()
    .map(v => path.join(kitsRoot, v, 'x64', 'signtool.exe'));
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* keep looking */ }
  }
  return 'signtool.exe';
}
async function signMsiIfConfigured(msi) {
  const pfx = process.env.CLOUDMEET_CODESIGN_PFX;
  if (!pfx) return false;
  const signtool = await findSigntool();
  await run(signtool, ['sign', '/fd', 'sha256', '/td', 'sha256', '/tr', 'http://timestamp.digicert.com',
    '/f', pfx, '/p', process.env.CLOUDMEET_CODESIGN_PASSWORD || '', msi], { timeout: 120000 });
  await run(signtool, ['verify', '/pa', msi], { timeout: 60000 });
  return true;
}
async function buildUnifiedMsi(results, version, vendorMsi) {
  const result = results.find(r => r.platform === 'win32' && r.arch === 'x64');
  if (!result) throw new Error('Unified MSI supports Windows x64 only');
  const runtime = await buildPrivateRuntime(version, vendorMsi);
  const runtimeRoot = path.dirname(runtime);
  const appDir = path.join(root, 'out/cloudmeet-win32-x64');
  const output = path.join(root, 'out/make/unified/x64');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(output, 'CloudMeet.wxs');
  const object = path.join(output, 'CloudMeet.wixobj');
  const msi = path.join(output, `CloudMeet-${version}-x64.msi`);
  await fs.writeFile(source, unifiedXml(version, path.join(runtimeRoot, 'runtime'), path.join(runtimeRoot, 'InstallRoot.CA.dll'), await listFiles(appDir), appDir));
  await run(tool('candle'), ['-nologo', '-out', object, source], { timeout: 120000 });
  await run(tool('light'), ['-nologo', '-ext', 'WixUIExtension', '-cultures:zh-CN', '-out', msi, object], { timeout: 240000 });
  if (await signMsiIfConfigured(msi)) console.log(`Authenticode signed: ${msi}`);
  result.artifacts = [msi];
  return results;
}
module.exports = { unifiedXml, buildUnifiedMsi };
