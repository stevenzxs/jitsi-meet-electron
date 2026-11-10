const fs = require('node:fs/promises');
const path = require('node:path');
const run = require('node:util').promisify(require('node:child_process').execFile);
async function buildInstallRoot(output) {
  await fs.mkdir(output, { recursive: true });
  // Override supports machines with an independently installed WiX SDK.
  const sdk = process.env.WIX_SDK || path.join(process.env.WIX || 'D:/tool/wix311-binaries', 'sdk');
  const dtf = path.join(sdk, 'Microsoft.Deployment.WindowsInstaller.dll');
  const assembly = path.join(output, 'InstallRoot.dll');
  const target = path.join(output, 'InstallRoot.CA.dll');
  await run(path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:library', `/reference:${dtf}`, `/out:${assembly}`, path.join(__dirname, 'installer/InstallRoot.cs')]);
  await fs.copyFile(path.join(__dirname, 'installer/CustomAction.config'), path.join(output, 'CustomAction.config'));
  await run(path.join(sdk, 'MakeSfxCA.exe'), [target, path.join(sdk, 'x64/SfxCA.dll'), assembly, dtf, path.join(output, 'CustomAction.config')]);
  return target;
}
module.exports = { buildInstallRoot };
