const assert = require('node:assert/strict');
const test = require('node:test');

test('launcher binds only a validated MSI product and exits without holding installed files', () => {
  const { launcherSource } = require('./uninstall-launcher.cjs');
  const source = launcherSource('12345678-1234-1234-1234-123456789ABC');
  assert.match(source, /\/x \{12345678-1234-1234-1234-123456789ABC\}/);
  assert.match(source, /SpecialFolder\.System/);
  assert.match(source, /MessageBoxButtons\.YesNo/);
  assert.match(source, /Process\.Start/);
  assert.doesNotMatch(source, /WaitForExit|Directory\.Delete|File\.Delete|cmd\.exe/);
  assert.throws(() => launcherSource('bad-guid /quiet'), /ProductCode/);
});

test('WiX owns the launcher file and the Chinese uninstall shortcut', () => {
  const { extendTemplate } = require('./uninstall-launcher.cjs');
  const { MSICreator } = require('electron-wix-msi');
  const creator = new MSICreator({ name: '云会议', exe: 'cloudmeet', manufacturer: 'CloudMeet',
    version: '1.0.41', appDirectory: process.cwd(), outputDirectory: process.cwd() });
  const xml = extendTemplate(creator.wixTemplate, 'C:/build/a&b/uninstall.exe');
  assert.match(xml, /Name="uninstall.exe" Source="C:\/build\/a&amp;b\/uninstall.exe"/);
  assert.match(xml, /Name="卸载云会议"/);
  assert.match(xml, /Target="\[APPLICATIONROOTDIRECTORY\]uninstall.exe"/);
  assert.match(xml, /ComponentRef Id="CloudMeetUninstaller"/);
  assert.throws(() => extendTemplate('<Wix/>', 'test'), /template/);
});

test('Windows compiler produces a PE launcher without executing it', { skip: process.platform !== 'win32' }, async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { addUninstallLauncher } = require('./uninstall-launcher.cjs');
  const { MSICreator } = require('electron-wix-msi');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudmeet-uninstall-test-'));
  try {
    const creator = new MSICreator({ name: '云会议', exe: 'cloudmeet', manufacturer: 'CloudMeet',
      version: '1.0.41', appDirectory: process.cwd(), outputDirectory: dir });
    await addUninstallLauncher(creator);
    const [build] = await fs.readdir(dir);
    const binary = await fs.readFile(path.join(dir, build, 'uninstall.exe'));
    assert.equal(binary.toString('ascii', 0, 2), 'MZ');
    const source = await fs.readFile(path.join(dir, build, 'uninstall.cs'), 'utf8');
    assert.ok(source.includes(`/x {${creator.productCode}}`));
    assert.match(creator.wixTemplate, /ComponentRef Id="CloudMeetUninstaller"/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
