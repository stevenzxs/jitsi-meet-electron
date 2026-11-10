// Read-only native smoke test. No VPN profiles are created and no dialing occurs.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createWindowsVpn, isTrustedVpnSender } = require('../src/windows-vpn');
const root = path.resolve(__dirname, '..');
const shellUrl = pathToFileURL(path.join(root, 'src/index.html')).href;
const vpn = createWindowsVpn();
const { createOpenVpn } = require('../src/openvpn');
const dir = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', `vpn-check-${process.pid}`);
app.setPath('userData', dir);
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('VPN smoke test timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const ovpn = createOpenVpn({ directory: path.join(dir, 'openvpn'), secure: require('electron').safeStorage });
  ipcMain.handle('openvpn-status', event => {
    assert.ok(isTrustedVpnSender(event, shellUrl));
    return ovpn.snapshot();
  });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }));
  for (const [name, result] of Object.entries({ 'user-get': null, 'server-get': '', 'settings-get': {},
    'window-is-fullscreen': false, 'meeting-window-url': '' })) {
    ipcMain.handle(name, () => result);
  }
  ipcMain.handle('vpn-list', event => {
    assert.ok(isTrustedVpnSender(event, shellUrl));
    return vpn.list();
  });
  const win = new BrowserWindow({ show: false, width: 1100, height: 800,
    webPreferences: { preload: path.join(root, 'src/preload.js'), sandbox: true,
      contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3 && !/ERR_BLOCKED_BY_CLIENT/.test(message)) errors.push(message);
  });
  await win.loadFile(path.join(root, 'src/index.html'));
  // Exercise the same navigation message as /cm/desktop, without contacting a server.
  await win.webContents.executeJavaScript(`window.dispatchEvent(new MessageEvent('message', {
    source: document.getElementById('meetingFrame').contentWindow,
    origin: 'https://104.244.90.25:8443',
    data: { type: 'cloudmeet-vpn-settings-open', requestId: 'vpn-smoke' }
  }));`);
  const expected = await vpn.list();
  let result;
  for (let i = 0; i < 60; i++) {
    result = await win.webContents.executeJavaScript(`({
      visible: !document.querySelector('[data-settings-panel="vpn"]').hidden,
      status: document.getElementById('vpnStatus').textContent,
      error: document.getElementById('vpnError').textContent,
      count: document.getElementById('vpnProfile').options.length,
      disabled: document.getElementById('vpnConnect').disabled,
       loading: document.getElementById('vpnRefresh').disabled,
       openVpnLoading: document.getElementById('ovpnRefresh').disabled,
       openVpnStatus: document.getElementById('ovpnStatus').textContent,
       openVpnError: document.getElementById('ovpnError').textContent,
       openVpnRoutes: Boolean(document.getElementById('ovpnRoutes')),
      node: typeof require
    })`);
    if (!result.loading && !result.openVpnLoading && result.status !== '尚未读取') break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(result.visible, true);
  assert.equal(result.node, 'undefined');
  assert.equal(result.error, '');
  assert.equal(result.openVpnError, '');
  assert.equal(result.openVpnRoutes, true);
  assert.equal(result.openVpnStatus, '未连接');
  assert.equal(result.count, expected.length);
  if (!expected.length) {
    assert.match(result.status, /Windows VPN 设置/);
    assert.equal(result.disabled, true);
  }
  assert.deepEqual(errors, []);
  fs.mkdirSync(dir, { recursive: true });
  const screenshot = path.join(dir, 'vpn-settings.png');
  fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ result, screenshot }, null, 2));
  clearTimeout(timeout);
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
