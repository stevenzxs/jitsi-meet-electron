// Native product build support: Windows Installer owns all removal operations.
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

function launcherSource(productCode) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(productCode)) {
    throw new Error('Invalid MSI ProductCode');
  }
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
internal static class UninstallLauncher {
  [STAThread] private static void Main() {
    if (MessageBox.Show("是否卸载云会议？用户配置和录制文件将保留。", "卸载云会议",
        MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
    try {
      string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
      Process.Start(new ProcessStartInfo(Path.Combine(system, "msiexec.exe"),
        "/x {${productCode}}") { UseShellExecute = true, WorkingDirectory = system });
      // Exit immediately so Windows Installer can remove this executable.
    } catch (Exception) {
      MessageBox.Show("无法启动 Windows Installer，请从系统应用设置卸载云会议。",
        "卸载云会议", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }
}
`;
}

function extendTemplate(template, file) {
  const directory = '<DirectoryRef Id="ApplicationProgramsFolder">';
  const feature = '<ComponentRef Id="ApplicationShortcut"';
  if (!template.includes(directory) || !template.includes(feature)) {
    throw new Error('Unsupported WiX template for uninstall launcher');
  }
  const escaped = file.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return template.replace(directory, `<DirectoryRef Id="APPLICATIONROOTDIRECTORY">
      <Component Id="CloudMeetUninstaller" Guid="*" Win64="{{Win64YesNo}}">
        <File Id="CloudMeetUninstallExe" Name="uninstall.exe" Source="${escaped}" KeyPath="yes" />
      </Component>
    </DirectoryRef>
    ${directory}`).replace('<RemoveFolder Id="ApplicationProgramsFolder"',
    `<Shortcut Id="CloudMeetUninstallShortcut" Name="卸载云会议"
        Target="[APPLICATIONROOTDIRECTORY]uninstall.exe" WorkingDirectory="APPLICATIONROOTDIRECTORY" />
        <RemoveFolder Id="ApplicationProgramsFolder"`)
    .replace(feature, `<ComponentRef Id="CloudMeetUninstaller" />\n        ${feature}`);
}

async function addUninstallLauncher(creator) {
  const source = launcherSource(creator.productCode);
  const dir = await fs.mkdtemp(path.join(creator.outputDirectory, 'cloudmeet-uninstall-'));
  const input = path.join(dir, 'uninstall.cs');
  const output = path.join(dir, 'uninstall.exe');
  await fs.writeFile(input, source, 'utf8');
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  await execFile(compiler, ['/nologo', '/target:winexe', '/platform:anycpu',
    '/reference:System.Windows.Forms.dll', `/out:${output}`, input]);
  creator.wixTemplate = extendTemplate(creator.wixTemplate, output);
}

module.exports = { launcherSource, extendTemplate, addUninstallLauncher };
