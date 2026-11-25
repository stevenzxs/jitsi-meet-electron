const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('packaged metadata controls debug policy, with fail-closed release defaults', () => {
  const { getBuildPolicy } = require('../src/build-mode');
  for (const metadata of [{}, { cloudmeetBuildMode: 'release' }, { cloudmeetBuildMode: 'invalid' }]) {
    assert.deepEqual(getBuildPolicy(true, metadata), { debug: false, devTools: false, singleInstance: true });
  }
  assert.deepEqual(getBuildPolicy(true, { cloudmeetBuildMode: 'debug' }), { debug: true, devTools: true, singleInstance: false });
  assert.deepEqual(getBuildPolicy(false, {}), { debug: true, devTools: true, singleInstance: false });
});

test('package scripts explicitly select modes and preserve release make', () => {
  const { scripts } = require('../package.json');
  assert.match(scripts['package:debug'], /cross-env CLOUDMEET_BUILD_MODE=debug electron-forge package/);
  assert.match(scripts.package, /cross-env CLOUDMEET_BUILD_MODE=release electron-forge package/);
  assert.match(scripts.make, /CLOUDMEET_BUILD_MODE=release/);
  assert.match(scripts.make, /electron-forge make/);
});

function loadForge(mode) {
  const source = fs.readFileSync('forge.config.js', 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, {
    __dirname: path.resolve('.'), module, process: { env: { CLOUDMEET_BUILD_MODE: mode } },
    require: id => id === '@electron-forge/plugin-fuses' ? { FusesPlugin: class {} }
      : id === '@electron/fuses' ? { FuseV1Options: {}, FuseVersion: {} }
        : id === './scripts/build-openvpn-bundle.cjs' ? {}
          : id === './scripts/uninstall-launcher.cjs' ? require('./uninstall-launcher.cjs') : require(id),
  });
  return module.exports;
}

test('native WiX shortcuts use the Chinese label without changing installation identity', async () => {
  const maker = loadForge('release').makers.find(m => m.name === '@electron-forge/maker-wix');
  assert.equal(maker.config.shortcutName, '云会议');
  assert.equal(maker.config.name, '云会议');
  assert.equal(maker.config.shortName, 'CloudMeet');
  assert.equal(maker.config.exe, 'cloudmeet');
  assert.equal(maker.config.manufacturer, 'CloudMeet');
  const { MSICreator } = require('electron-wix-msi');
  const creator = new MSICreator({ ...maker.config, appDirectory: process.cwd(),
    outputDirectory: os.tmpdir(), version: '1.0.36' });
  await maker.config.beforeCreate(creator);
  assert.equal(creator.shortcutName, '云会议');
  assert.equal(creator.name, '云会议');
  assert.equal(creator.shortName, 'CloudMeet');
  assert.match(creator.wixTemplate, /<Product\b[^>]*Codepage="936"/);
  assert.match(creator.wixTemplate, /<Package\b[^>]*SummaryCodepage="936"/);
});

test('native WiX keeps the established upgrade family across builds and versions', () => {
  const { MSICreator } = require('electron-wix-msi');
  const expected = 'CF24C64F-7B2E-43DE-92E9-581984AD2437';
  // This is the desktop identity from the original unified MSI, not the VPN runtime.
  const legacy = fs.readFileSync('scripts/unified-msi.cjs', 'utf8');
  assert.ok(legacy.includes(`<Upgrade Id="${expected}">`));
  for (const version of ['1.0.40', '1.0.41']) {
    const maker = loadForge('release').makers.find(m => m.name === '@electron-forge/maker-wix');
    assert.equal(maker.config.upgradeCode, expected);
    const creator = new MSICreator({ ...maker.config, appDirectory: process.cwd(),
      outputDirectory: os.tmpdir(), version });
    assert.equal(creator.upgradeCode, expected);
  }
});

test('Forge stamps only copied metadata and isolates debug output', async () => {
  const original = fs.readFileSync('package.json', 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudmeet-build-mode-'));
  try {
    for (const mode of ['debug', 'release']) {
      fs.writeFileSync(path.join(dir, 'package.json'), original);
      const config = loadForge(mode);
      assert.equal(config.outDir, mode === 'debug' ? 'out/debug' : 'out');
      await config.hooks.packageAfterCopy({}, dir);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).cloudmeetBuildMode, mode);
    }
    assert.equal(fs.readFileSync('package.json', 'utf8'), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all windows disable release DevTools and both debug entry points are gated', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /const buildPolicy = getBuildPolicy\(app.isPackaged, require\('\.\.\/package.json'\)\)/);
  assert.equal((source.match(/webPreferences: \{\s+devTools: buildPolicy.devTools/g) || []).length, 3);
  assert.match(source, /if \(buildPolicy.debug\) win.webContents.toggleDevTools\(\)/);
  assert.match(source, /\.\.\.\(buildPolicy.debug \? \[\{/);
  assert.match(source, /devTools: buildPolicy.devTools,[\s\S]*?electron: \{ BrowserWindow/);
  const share = fs.readFileSync('src/share-controller.js', 'utf8');
  assert.equal((share.match(/webPreferences: \{ devTools,/g) || []).length, 2);
  assert.match(share, /devTools = false/);
});

test('F12 opens DevTools only in Debug; Release consumes the key without opening', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const fn = source.slice(source.indexOf('function bindWindowFullscreenEvents('), source.indexOf('function sendWindowFullscreenControlsVisible('));
  for (const debug of [false, true]) {
    let handler, toggles = 0, prevented = 0;
    const win = { on() {}, webContents: {
      on: (_name, callback) => { handler = callback; }, toggleDevTools: () => { toggles++; },
    } };
    vm.runInNewContext(`${fn}\nbindWindowFullscreenEvents(win)`, { win, buildPolicy: { debug } });
    handler({ preventDefault: () => { prevented++; } }, { type: 'keyDown', key: 'F12' });
    assert.equal(toggles, debug ? 1 : 0);
    assert.equal(prevented, 1);
    handler({ preventDefault() {} }, { type: 'keyUp', key: 'F12' });
    assert.equal(toggles, debug ? 1 : 0);
  }
});

test('Release menu omits developer tools while Debug menu includes its shortcut', () => {
  const source = fs.readFileSync('src/main.js', 'utf8');
  const fn = source.slice(source.indexOf('function createApplicationMenu('), source.indexOf('function createMainWindow('));
  for (const debug of [false, true]) {
    let menu;
    vm.runInNewContext(`${fn}\ncreateApplicationMenu()`, {
      buildPolicy: { debug }, Menu: { buildFromTemplate: template => template, setApplicationMenu: value => { menu = value; } },
    });
    const item = menu.flatMap(group => group.submenu).find(item => item.label === '开发者工具');
    assert.equal(Boolean(item), debug);
    if (debug) assert.equal(item.accelerator, 'Ctrl+Shift+I');
  }
});
