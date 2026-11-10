const { app, BrowserWindow, session } = require('electron');
const { isPinnedCertificate, OFFICIAL_URL } = require('../src/server-trust');
const assert = require('node:assert/strict');
app.setPath('userData', require('node:path').join(app.getPath('temp'), `cloudmeet-tls-check-${process.pid}`));
app.on('certificate-error', (event, contents, url, error, certificate, callback) => {
  event.preventDefault();
  const allowed = isPinnedCertificate(url, certificate.data);
  console.log('certificate decision', new URL(url).origin, allowed);
  callback(allowed);
});
app.whenReady().then(async () => {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === '118.193.36.35' && !isPinnedCertificate('https://118.193.36.35:8443', request.certificate.data)) callback(-2);
    else callback(-3);
  });
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(OFFICIAL_URL);
    assert.equal(await win.webContents.executeJavaScript('isSecureContext'), true);
    const result = await win.webContents.executeJavaScript(`({url:location.href, secure:isSecureContext, media:!!navigator.mediaDevices})`);
    console.log(JSON.stringify(result));
    assert.equal(result.media, true);
    // Load a minimal, media-disabled Jitsi frame to verify nested HTTPS and WSS.
    await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=location.origin+'/external_api.js';script.onload=()=>resolve(true);script.onerror=()=>reject(new Error('external API load failed'));document.head.append(script);})`);
    await win.webContents.executeJavaScript(`window.__tlsApi=new JitsiMeetExternalAPI(location.host,{roomName:'frp-tls-check-${Date.now()}',parentNode:document.body,configOverwrite:{prejoinConfig:{enabled:false},startWithAudioMuted:true,startWithVideoMuted:true,disableInitialGUM:true},userInfo:{displayName:'TLS verification'}}); true;`);
    await new Promise(resolve => setTimeout(resolve, 7000));
    const frameResult = await win.webContents.executeJavaScript(`(()=>{const frame=document.querySelector('iframe');return {src:frame?.src,origin:frame?new URL(frame.src).origin:null,accessible:!!frame?.contentDocument,secure:frame?.contentWindow.isSecureContext};})()`);
    console.log('Jitsi iframe', JSON.stringify(frameResult));
    assert.equal(frameResult.origin, new URL(OFFICIAL_URL).origin);
    assert.equal(frameResult.accessible, true);
    assert.equal(frameResult.secure, true);
    const signaling = await win.webContents.executeJavaScript(`new Promise(resolve=>{const ws=new WebSocket('wss://118.193.36.35:8443/xmpp-websocket','xmpp');ws.onopen=()=>{ws.close();resolve(true)};ws.onerror=()=>resolve(false);setTimeout(()=>{ws.close();resolve(false)},8000);})`);
    assert.equal(signaling, true, 'Jitsi WSS must pass exact certificate trust');
    console.log('Jitsi secure WebSocket opened');
    await win.webContents.executeJavaScript('window.__tlsApi.dispose()');
    const negative = new BrowserWindow({ show: false });
    await assert.rejects(negative.loadURL('https://192.168.199.202/cm/desktop'));
    negative.destroy();
    console.log('Pinned public origin accepted; unrelated self-signed origin rejected');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('TLS verification timed out'); app.exit(1); }, 45000);
