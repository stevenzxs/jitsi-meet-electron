// Native Electron integration checks using local synthetic video. No meeting,
// credentials, desktop capture, microphone, or camera are used.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { installCaptureRuntime } = require('../src/share-capture-preload');
app.setPath('userData', path.join(os.tmpdir(), `cloudmeet-share-verification-${process.pid}`));
// CI/remote desktop environments may not expose a usable GPU. Verify the real
// Chromium media pipeline with software rendering, without changing app defaults.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const root = path.resolve(__dirname, '..');
const windows = [];
let server;
const timeout = setTimeout(() => { console.error('Native verification timed out'); app.exit(1); }, 45000);

async function verifyMedia(install) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const raw = [];
  let color = '#ff0000';
  let fail = false;
  window.cloudmeetShareTransport = { claim: async () => ({ token: 'native-test' }), ready: async () => true, ended() {} };
  navigator.mediaDevices.getDisplayMedia = async () => {
    if (fail) throw new Error('candidate failed');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(30);
    const timer = setInterval(() => { ctx.fillRect(0, 0, 320, 240); }, 33);
    raw.push({ canvas, ctx, stream, timer }); return stream;
  };
  install();
  const output = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const track = output.getVideoTracks()[0];
  const receiver = document.createElement('video'); receiver.muted = true;
  // Exercise encoding and the receiving video track through an in-process
  // WebRTC peer pair, with no STUN/TURN service or external meeting connection.
  const senderPeer = new RTCPeerConnection({ iceServers: [] });
  const receiverPeer = new RTCPeerConnection({ iceServers: [] });
  const sender = senderPeer.addTrack(track, output);
  const senderIce = []; const receiverIce = [];
  senderPeer.onicecandidate = event => {
    if (event.candidate) {
      if (receiverPeer.remoteDescription) void receiverPeer.addIceCandidate(event.candidate);
      else receiverIce.push(event.candidate);
    }
  };
  receiverPeer.onicecandidate = event => {
    if (event.candidate) {
      if (senderPeer.remoteDescription) void senderPeer.addIceCandidate(event.candidate);
      else senderIce.push(event.candidate);
    }
  };
  const receivedTrack = new Promise(resolve => { receiverPeer.ontrack = event => { receiver.srcObject = event.streams[0]; resolve(); }; });
  await senderPeer.setLocalDescription(await senderPeer.createOffer());
  await receiverPeer.setRemoteDescription(senderPeer.localDescription);
  for (const candidate of receiverIce) await receiverPeer.addIceCandidate(candidate);
  await receiverPeer.setLocalDescription(await receiverPeer.createAnswer());
  await senderPeer.setRemoteDescription(receiverPeer.localDescription);
  for (const candidate of senderIce) await senderPeer.addIceCandidate(candidate);
  await receivedTrack;
  await receiver.play();
  const sampleCanvas = document.createElement('canvas'); sampleCanvas.width = 320; sampleCanvas.height = 240;
  const sample = async () => {
    await delay(180);
    const ctx = sampleCanvas.getContext('2d'); ctx.drawImage(receiver, 0, 0);
    return Array.from(ctx.getImageData(250, 180, 1, 1).data).slice(0, 3);
  };
  const command = action => window.__cloudmeetCapture.command({ token: 'native-test', action, shareAudio: false });
  const initial = await sample();
  await command('pause');
  raw[0].ctx.fillStyle = '#00ff00'; raw[0].ctx.fillRect(0, 0, 320, 240);
  const paused = await sample();
  await command('resume'); const resumed = await sample();
  color = '#0000ff'; const switched = await command('switch'); const switchedPixel = await sample();
  fail = true; const failedSwitch = await command('switch'); const afterFailure = await sample();
  const stable = track === output.getVideoTracks()[0] && sender.track === track && track.readyState === 'live';
  output.getVideoTracks()[0].stop(); receiver.srcObject = null;
  raw.forEach(input => clearInterval(input.timer));
  senderPeer.close(); receiverPeer.close();
  return { initial, paused, resumed, switched, switchedPixel, failedSwitch, afterFailure, stable,
    allInputsStopped: raw.every(input => input.stream.getTracks().every(t => t.readyState === 'ended')) };
}

app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/parent' ? '<!doctype html><iframe src="/child"></iframe>' : '<!doctype html><title>Share verification</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const preloadSession = session.fromPartition(`preload-test-${process.pid}`);
  preloadSession.registerPreloadScript({ type: 'frame', filePath: path.join(root, 'src/share-capture-preload.js') });
  const preloadWindow = new BrowserWindow({ show: false, webPreferences: {
    session: preloadSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: true, backgroundThrottling: false, preload: path.join(root, 'src/preload.js'),
  } });
  windows.push(preloadWindow);
  await preloadWindow.loadURL(`${url}/parent`);
  const child = preloadWindow.webContents.mainFrame.framesInSubtree.find(f => f.url.endsWith('/child'));
  assert.ok(child, 'Nested frame loaded');
  const preload = await child.executeJavaScript('({capture: !!window.__cloudmeetCapture, shell: !!window.cloudmeet, node: typeof require})');
  assert.deepEqual(preload, { capture: true, shell: false, node: 'undefined' });
  console.log('PASS sandboxed capture preload reaches nested frames without exposing Node or shell APIs');

  const mediaWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  windows.push(mediaWindow);
  await mediaWindow.loadURL(`${url}/media`);
  const media = await mediaWindow.webContents.executeJavaScript(`(${verifyMedia.toString()})(${installCaptureRuntime.toString()})`, true);
  const pixelClose = (actual, expected) => assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 6),
    `Decoded pixel ${actual} should match ${expected} within codec rounding tolerance`);
  pixelClose(media.initial, [255, 0, 0]);
  pixelClose(media.paused, [255, 0, 0]);
  pixelClose(media.resumed, [0, 255, 0]);
  pixelClose(media.switchedPixel, [0, 0, 255]);
  pixelClose(media.afterFailure, [0, 0, 255]);
  assert.equal(media.switched.ok, true); assert.equal(media.failedSwitch.ok, false);
  assert.equal(media.stable, true); assert.equal(media.allInputsStopped, true);
  console.log('PASS WebRTC receiver sees frozen/resumed/switched pixels with a stable sender track; failed source preserves pixels');

  ipcMain.handle('screenshare-floater-get-state', () => ({ active: true, paused: false,
    sourceName: '演示窗口 · 共享验收', media: { available: true, audioMuted: true, videoMuted: true } }));
  ipcMain.on('screenshare-floater-hover', () => {});
  const ui = new BrowserWindow({ show: false, width: 1040, height: 94, frame: false, webPreferences: {
    sandbox: true, contextIsolation: true, preload: path.join(root, 'src/share-floater-preload.js'),
  } });
  windows.push(ui);
  await ui.loadFile(path.join(root, 'src/share-floater.html'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const layout = await ui.webContents.executeJavaScript(`({
    buttons: [...document.querySelectorAll('button')].map(button => button.id).sort(),
    recordingHidden: document.querySelector('#recordingBtn').hidden,
    overflow: document.documentElement.scrollWidth > innerWidth,
    disabled: document.querySelector('#pauseBtn').disabled,
    label: document.querySelector('#sourceName').textContent
  })`);
  assert.deepEqual(layout.buttons, ['audioBtn', 'videoBtn', 'recordingBtn', 'participantsBtn',
    'switchBtn', 'pauseBtn', 'showMeetingBtn', 'stopBtn'].sort());
  assert.equal(layout.recordingHidden, true, 'Recording is hidden without host recording permission');
  assert.equal(layout.overflow, false); assert.equal(layout.disabled, false);
  assert.match(layout.label, /共享验收/);
  const mediaActions = [];
  ipcMain.on('screenshare-floater-media', (_, action) => mediaActions.push(action));
  ui.webContents.send('screenshare-floater-state', { active: true, media: {
    available: true, recording: { available: true, active: true },
  } });
  await new Promise(resolve => setTimeout(resolve, 100));
  const recording = await ui.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#recordingBtn');
    const result = { hidden: button.hidden, disabled: button.disabled,
      pressed: button.getAttribute('aria-pressed'), label: button.textContent,
      overflow: document.documentElement.scrollWidth > innerWidth };
    button.click(); button.click();
    return result;
  })()`);
  assert.equal(recording.hidden, false); assert.equal(recording.disabled, false);
  assert.equal(recording.pressed, 'true'); assert.match(recording.label, /停止录屏/);
  assert.equal(recording.overflow, false);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(mediaActions, ['recording'], 'Repeated clicks dispatch only once until state settles');
  fs.writeFileSync(path.join(root, 'docs/share-toolbar-preview.png'), (await ui.webContents.capturePage()).toPNG());
  console.log('PASS native toolbar control identities, recording permission/state and click IPC without overflow; preview saved');
  if (process.platform === 'win32') {
    const handle = ui.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    const script = fs.readFileSync(path.join(root, 'src/window-share-bounds.ps1'), 'utf8').replace('__WINDOW_HANDLE__', hwnd);
    const bounds = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
      let data = ''; let error = '';
      const expiry = setTimeout(() => { child.kill(); reject(new Error('Window bounds probe timed out: ' + error)); }, 8000);
      child.stdout.on('data', chunk => {
        data += chunk.toString();
        const line = data.split(/\r?\n/).find(value => value.startsWith('{'));
        if (line && data.includes('\n')) {
          try { const result = JSON.parse(line); clearTimeout(expiry); child.kill(); resolve(result); } catch { /* Wait for a complete line. */ }
        }
      });
      child.stderr.on('data', chunk => { error += chunk.toString(); });
      child.on('error', error => { clearTimeout(expiry); reject(error); });
    });
    assert.equal(bounds.valid, true); assert.equal(bounds.visible, false);
    console.log('PASS Windows bounds helper compiles and identifies a real hidden Electron window');
  }
  clearTimeout(timeout);
  windows.forEach(win => win.destroy());
  server.close();
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(timeout); windows.forEach(win => win.destroy()); server?.close(); app.exit(1);
});
