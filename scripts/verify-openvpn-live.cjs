// Explicitly opt-in live acceptance: installed private runtime, real route and server.
const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const run = require('node:util').promisify(require('node:child_process').execFile);
const { createOpenVpn } = require('../src/openvpn');
const { isTrustedVpnSender } = require('../src/windows-vpn');
const { pathToFileURL } = require('node:url');
if (process.env.CLOUDMEET_LIVE_VPN !== '118-poc') throw new Error('Live VPN opt-in required');
const root = path.resolve(__dirname, '..');
const dir = path.join(process.env.LOCALAPPDATA, 'Temp/opencode', `vpn-live-${process.pid}`);
app.setPath('userData', dir);
app.disableHardwareAcceleration();
let vpn, win;
const report = { phases: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function network() {
  const script = `@{defaults=@(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object InterfaceIndex,NextHop,RouteMetric);target=@(Get-NetRoute -DestinationPrefix '10.8.0.1/32' -ErrorAction SilentlyContinue | Select-Object InterfaceIndex,NextHop,RouteMetric);dns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)} | ConvertTo-Json -Depth 5 -Compress`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  return JSON.parse(stdout.trim());
}
async function probe() {
  return new Promise(resolve => {
    const req = http.get('http://10.8.0.1/vpn-probe', { timeout: 4000 }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ reachable: true, status: res.statusCode, body: body.slice(0, 1000) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => resolve({ reachable: false, code: e.code || e.message }));
  });
}
async function ui() {
  return win.webContents.executeJavaScript(`({status:document.getElementById('ovpnStatus').textContent,error:document.getElementById('ovpnError').textContent,connectDisabled:document.getElementById('ovpnConnect').disabled})`);
}
async function click(id) { await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function wait(predicate, limit = 95000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await predicate()) return; await sleep(300); }
  throw new Error('Timed out waiting for live VPN state');
}
app.whenReady().then(async () => {
  await fs.mkdir(dir, { recursive: true });
  vpn = createOpenVpn({ directory: path.join(dir, 'openvpn'), secure: safeStorage, connectTimeout: 45000 });
  const shellUrl = pathToFileURL(path.join(root, 'src/index.html')).href;
  const handler = (name, fn) => ipcMain.handle(name, (event, ...args) => { assert.ok(isTrustedVpnSender(event, shellUrl)); return fn(...args); });
  handler('openvpn-status', () => vpn.snapshot());
  handler('openvpn-import', async () => vpn.importProfile('electron-u1.ovpn', await fs.readFile(path.resolve(root, '../docs/vpn-poc/electron-u1.ovpn'), 'utf8')));
  handler('openvpn-routes', text => vpn.saveRoutes(text));
  handler('openvpn-test-address', text => vpn.saveTestAddress(text));
  handler('openvpn-test', () => vpn.testConnection());
  handler('openvpn-connect', args => vpn.connect(args));
  handler('openvpn-disconnect', () => vpn.disconnect());
  handler('vpn-list', () => []);
  for (const [name, result] of Object.entries({ 'user-get': null, 'server-get': '', 'settings-get': {}, 'window-is-fullscreen': false, 'meeting-window-url': '' })) ipcMain.handle(name, () => result);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_r, done) => done({ cancel: true }));
  report.before = await network(); report.beforeProbe = await probe();
  assert.equal(report.beforeProbe.reachable, false, 'Target must be unavailable before VPN');
  win = new BrowserWindow({ show: false, width: 1100, height: 860, webPreferences: { preload: path.join(root, 'src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(root, 'src/index.html'));
  await wait(async () => win.webContents.executeJavaScript(`!document.getElementById('offlineEntry').hidden`), 5000);
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('settingsBtn')).display !== 'none'`), true);
  await sleep(500);
  await fs.writeFile(path.join(dir, 'offline-entry.png'), (await win.webContents.capturePage()).toPNG());
  await click('offlineVpn');
  assert.equal(await win.webContents.executeJavaScript(`!document.querySelector('[data-settings-panel="vpn"]').hidden`), true);
  for (const height of [600, 860]) {
    win.setSize(1100, height);
    await sleep(200);
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const panel=document.querySelector('[data-settings-panel="vpn"]');
      panel.scrollTop=panel.scrollHeight;
      return {scroll:panel.scrollTop,height:panel.clientHeight,total:panel.scrollHeight,bottom:panel.getBoundingClientRect().bottom,viewport:innerHeight};
    })()`);
    assert.ok(geometry.scroll > 0 && geometry.total > geometry.height && geometry.bottom <= geometry.viewport, 'VPN page must scroll inside the window');
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-settings-panel="vpn"]').scrollTop=0;`);
  report.phases.push('Blocked remote page still opens bundled VPN settings');
  await sleep(1000);
  await click('ovpnImport');
  await wait(async () => (await vpn.snapshot()).name === 'electron-u1.ovpn');
  await win.webContents.executeJavaScript(`const input=document.getElementById('ovpnRoutes');input.value='10.8.0.1/32';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await win.webContents.executeJavaScript(`const address=document.getElementById('ovpnTestAddress');address.value='http://10.8.0.1/vpn-probe';address.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(500); await click('ovpnConnect');
  await wait(async () => { const s = await vpn.snapshot(); if (s.error) throw new Error(s.error); return s.status === 'connected'; }, 60000);
  await click('ovpnRefresh'); await sleep(500);
  report.connected = await vpn.snapshot(); report.connectedUi = await ui();
  assert.deepEqual(report.connected.routes, ['10.8.0.1/32']);
  assert.equal(report.connected.testAddress, 'http://10.8.0.1/vpn-probe');
  report.connectedNetwork = await network(); report.connectedProbe = await probe();
  assert.equal(report.connectedUi.status, '已连接');
  await click('ovpnTest');
  await wait(async () => /测试通过|测试失败/.test(await win.webContents.executeJavaScript(`document.getElementById('ovpnTestResult').textContent`)), 10000);
  report.testButtonResult = await win.webContents.executeJavaScript(`document.getElementById('ovpnTestResult').textContent`);
  assert.match(report.testButtonResult, /测试通过/);
  assert.equal(JSON.parse(report.connectedProbe.body).vpn, true);
  assert.deepEqual(report.connectedNetwork.defaults, report.before.defaults, 'Default routes changed');
  assert.deepEqual(report.connectedNetwork.dns, report.before.dns, 'DNS changed');
  assert.ok(report.connectedNetwork.target.length > 0, 'Selected route absent');
  await fs.writeFile(path.join(dir, 'connected.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('ovpnTest').scrollIntoView({block:'center'});`);
  await fs.writeFile(path.join(dir, 'test-result.png'), (await win.webContents.capturePage()).toPNG());
  report.phases.push('UI import/save/connect and real probe passed');
  await click('ovpnDisconnect');
  await wait(async () => (await vpn.snapshot()).status === 'disconnected', 20000);
  await click('ovpnRefresh'); await sleep(500);
  report.disconnectedUi = await ui();
  assert.equal(report.disconnectedUi.status, '未连接');
  report.phases.push('UI disconnect passed');
}).catch(e => { report.failure = e.message; }).finally(async () => {
  try {
    if (vpn) { vpn.dispose(); await wait(async () => (await vpn.snapshot()).status === 'disconnected', 20000); await vpn.waitForIdle(); }
    report.after = await network(); report.afterProbe = await probe();
    assert.deepEqual(report.after.defaults, report.before.defaults);
    assert.deepEqual(report.after.target, report.before.target);
    assert.deepEqual(report.after.dns, report.before.dns);
    report.runtimeClean = !(await fs.readdir(path.join(dir, 'openvpn')).catch(() => [])).some(name => name.startsWith('run-'));
    assert.ok(report.runtimeClean);
    assert.equal(report.afterProbe.reachable, false);
  } catch (e) { report.cleanupFailure = e.message; }
  await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phases: report.phases, failure: report.failure, cleanupFailure: report.cleanupFailure,
    connected: report.connected, probe: report.connectedProbe, disconnectedUi: report.disconnectedUi,
    testButtonResult: report.testButtonResult, runtimeClean: report.runtimeClean, evidence: dir }, null, 2));
  win?.destroy(); app.exit(report.failure || report.cleanupFailure ? 1 : 0);
});
