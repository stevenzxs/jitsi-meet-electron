const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('real managed version policy handles fresh, upgrade, equal and downgrade', { skip: process.platform !== 'win32' }, () => {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp/opencode') : os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  const dir = fs.mkdtempSync(path.join(temp, 'cloudmeet-version-'));
  const sdk = process.env.WIX_SDK || path.join(process.env.WIX || 'D:/tool/wix311-binaries', 'sdk');
  const dtf = path.join(sdk, 'Microsoft.Deployment.WindowsInstaller.dll');
  const source = path.join(dir, 'Test.cs');
  fs.copyFileSync(dtf, path.join(dir, path.basename(dtf)));
  fs.writeFileSync(source, `using System;
class Test {
  static void Expect(string expected, string current, params string[] installed) {
    string actual = InstallRootActions.CompareInstalledVersions(current, installed);
    if (actual != expected) throw new Exception(expected + " != " + actual);
  }
  static void Main() {
    Expect("fresh", "1.0.0");
    Expect("upgrade", "1.0.1", "1.0.0");
    Expect("same", "1.0.0", "1.0.0");
    Expect("downgrade", "1.0.0", "1.0.1");
    Expect("upgrade", "1.10.0", "1.9.0");
    Expect("downgrade", "1.0.0", "1.0.0", "2.0.0");
    Expect("same", "1.0.0", "0.9.0", "1.0.0");
    Console.WriteLine("PASS version policy");
  }
}`);
  const exe = path.join(dir, 'Test.exe');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', `/reference:${dtf}`, `/out:${exe}`, source, path.join(__dirname, 'installer/InstallRoot.cs')]);
  assert.match(execFileSync(exe, { encoding: 'utf8' }), /PASS version policy/);
  const harness = path.join(dir, 'Harness.exe');
  execFileSync(path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', `/out:${harness}`, path.join(__dirname, 'installer/VersionPolicyHarness.cs'), path.join(__dirname, 'installer/InstallRoot.cs')]);
  assert.match(execFileSync(harness, { encoding: 'utf8' }), /PASS action decisions/);
});
