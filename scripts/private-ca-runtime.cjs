// Runtime smoke test with isolated storage; never changes system trust stores.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createPrivateCaVerifier } = require('../src/private-ca');
app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'cloudmeet-115-tls-smoke'));
app.whenReady().then(async () => {
  const verify = createPrivateCaVerifier({ origin: 'https://115.190.243.21',
    ca: fs.readFileSync(path.join(__dirname, '../src/certs/cloudmeet-115-root.crt')) });
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    verify(request).then(callback, () => callback(-2));
  });
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  try {
    await win.loadURL('https://115.190.243.21/mapi/actuator/health');
    const body = await win.webContents.executeJavaScript('document.body.innerText');
    if (JSON.parse(body).status !== 'UP') throw new Error('API not UP');
    await win.loadURL('https://115.190.243.21/cm/desktop');
    console.log('Electron runtime private CA: API UP and desktop page loaded without certificate bypass');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('Runtime smoke timeout'); app.exit(1); }, 30000);
