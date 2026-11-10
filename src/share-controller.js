const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

// One capture session owns its source, frame, controls and border. UI visibility
// is independent of meeting-window visibility; source selection is transactional.
function createShareController({ electron, selectSource, getWindowIcon, enableProtection, disableProtection, spawnBounds = spawn, devTools = false }) {
  const { BrowserWindow, ipcMain, screen } = electron;
  const grants = new Map();
  let current = null;
  const usable = win => Boolean(win && !win.isDestroyed());
  const frameKey = frame => {
    try { return frame ? `${frame.processId}:${frame.routingId}` : null; } catch { return null; }
  };
  const sameFrame = (a, b) => Boolean(frameKey(a)) && frameKey(a) === frameKey(b);
  // 兜底注入的采集运行时借用同源父 frame 的传输桥，claim/ready/ended 的发送方是父 frame 而非授权 frame；
  // 只要发送方属于授权会议窗口（同一 WebContents）即视为合法。
  const bridgeSenderMatches = (grant, event) =>
    Boolean(grant) && (sameFrame(grant.frame, event.senderFrame) || grant.meeting?.webContents === event.sender);
  const ownFloater = event => current && event.sender === current.floater?.webContents;

  function state(c = current) {
    return c ? {
      active: !c.ended, paused: c.paused, busy: c.busy, error: c.error,
      sourceName: c.source.name, sourceType: c.source.id.startsWith('screen:') ? 'screen' : 'window',
      sourceHidden: c.source.id.startsWith('window:') && c.boundsReady && !c.boundsVisible,
      collapsed: c.collapsed, media: c.media || {}, mediaBusy: Boolean(c.mediaBusy),
    } : { active: false };
  }
  function publish(c = current) {
    if (c === current && usable(c?.floater)) c.floater.webContents.send('screenshare-floater-state', state(c));
  }
  function borderVisible(c) {
    return c === current && !c.ended && !c.paused && c.boundsVisible;
  }
  function updateBorder(c) {
    if (!usable(c.border)) return;
    if (borderVisible(c)) c.border.showInactive(); else c.border.hide();
  }
  function displayFor(source, win) {
    return screen.getAllDisplays().find(d => String(d.id) === source.display_id)
      || screen.getDisplayMatching(win.getBounds());
  }
  function restoreMeeting(c) {
    if (!usable(c.meeting)) return;
    if (c.meeting.isMinimized()) c.meeting.restore();
    c.meeting.show();
    c.meeting.focus();
  }
  function clearBorder(c) {
    c.boundsProcess?.kill();
    c.boundsProcess = null;
    if (usable(c.border)) c.border.close();
    c.border = null;
  }
  function end(c = current, restore = true) {
    if (!c || c.ended) return;
    c.ended = true;
    c.abort?.abort();
    clearTimeout(c.startTimer);
    clearInterval(c.mediaTimer);
    clearTimeout(c.collapseTimer);
    c.meeting.webContents.off('did-frame-navigate', c.onNavigate);
    c.meeting.webContents.off('render-process-gone', c.onClosed);
    c.meeting.off('closed', c.onClosed);
    clearBorder(c);
    if (usable(c.floater)) c.floater.close();
    if (current === c) {
      current = null;
      disableProtection();
    }
    if (restore) restoreMeeting(c);
  }
  function report(c, message) {
    if (current !== c) return;
    c.error = message;
    resizeFloater(c, false);
    publish(c);
  }
  function createBorder(c) {
    clearBorder(c);
    const isScreen = c.source.id.startsWith('screen:');
    const display = displayFor(c.source, c.meeting);
    c.boundsVisible = isScreen;
    c.boundsReady = isScreen;
    c.positionAtWindow = !isScreen;
    const border = new BrowserWindow({
      ...display.bounds, frame: false, transparent: true, resizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false,
      enableLargerThanScreen: true, title: '屏幕共享中', icon: getWindowIcon(),
      webPreferences: { devTools, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    c.border = border;
    // 屏幕共享使用完整 display.bounds，而不是 workArea，确保底部系统任务栏也被绿角框住。
    if (isScreen) border.setBounds(display.bounds);
    border.setMenu(null);
    border.setIgnoreMouseEvents(true, { forward: true });
    border.setAlwaysOnTop(true, 'screen-saver');
    border.setContentProtection(true);
    border.once('ready-to-show', () => updateBorder(c));
    border.loadFile(path.join(__dirname, 'share-border.html'));
    if (isScreen) return;
    const match = /^window:(\d+):\d+$/.exec(c.source.id);
    if (process.platform !== 'win32' || !match) {
      report(c, '当前系统暂不支持窗口边框跟随');
      return;
    }
    // DWM supplies physical pixels. Electron converts the entire rectangle to
    // DIP, including its origin, for mixed-DPI and negative-coordinate displays.
    const script = fs.readFileSync(path.join(__dirname, 'window-share-bounds.ps1'), 'utf8')
      .replace('__WINDOW_HANDLE__', match[1]);
    const child = spawnBounds('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    c.boundsProcess = child;
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (current !== c || c.boundsProcess !== child) return;
        try {
          const bounds = JSON.parse(line);
          c.boundsReady = true;
          if (!bounds.valid) { void run('stop'); return; }
          c.boundsVisible = bounds.visible && bounds.width > 0 && bounds.height > 0;
          if (c.boundsVisible && usable(border)) {
            const rect = screen.screenToDipRect(null, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
            border.setBounds(rect);
            if (c.positionAtWindow) {
              positionFloater(c, screen.getDisplayMatching(rect).workArea);
              c.positionAtWindow = false;
            }
          }
          updateBorder(c);
          publish(c);
        } catch { /* Ignore non-JSON startup output. */ }
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => report(c, '无法启动共享窗口边框，请重新共享'));
    child.on('exit', code => {
      if (current === c && c.boundsProcess === child && code !== 0) {
        c.boundsVisible = false;
        updateBorder(c);
        report(c, '共享窗口边框跟踪已中断');
      }
    });
  }
  async function inFrame(frame, method, payload) {
    let timer;
    try {
      return await Promise.race([
        frame.executeJavaScript(`window.__cloudmeetCapture?.${method}(${JSON.stringify(payload)})`,
          method === 'command' || method === 'meetingCommand'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('操作超时，请重试')),
          method === 'command' ? 35000 : 5000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function command(c, action, payload = {}) {
    if (c !== current || c.ended) return;
    const result = await inFrame(c.frame, 'command', { token: c.token, action, expiresAt: Date.now() + 30000, ...payload });
    if (!result?.ok) throw new Error(result?.error || '共享控制未响应，请重试');
    return result;
  }
  async function run(action) {
    const c = current;
    if (!c || c.ended || (c.busy && action !== 'stop')) return;
    if (action === 'stop') c.abort?.abort();
    c.busy = action;
    c.error = '';
    publish(c);
    try {
      if (action === 'switch') {
        c.abort = new AbortController();
        const selection = await selectSource(c.floater, c.abort.signal, { switching: true });
        if (c !== current || !selection?.source) return;
        // Keep the old output untouched while the new native source starts.
        const source = selection.source;
        c.switchSelection = { ...selection, expiresAt: Date.now() + 15000 };
        let result;
        try { result = await command(c, 'switch', { shareAudio: Boolean(selection.shareAudio) }); }
        finally { c.switchSelection = null; }
        if (current !== c) return;
        c.source = { id: source.id, name: source.name, display_id: source.display_id || '' };
        c.paused = result.paused;
        createBorder(c);
        if (c.source.id.startsWith('screen:')) positionFloater(c, displayFor(c.source, c.meeting).workArea);
      } else {
        const result = await command(c, action);
        if (c !== current) return;
        if (action === 'stop') { end(c); return; }
        c.paused = Boolean(result.paused);
        updateBorder(c);
      }
    } catch (error) {
      report(c, error.message || '操作失败，请重试');
    } finally {
      if (c === current && c.busy === action) {
        c.busy = '';
        if (c.error) resizeFloater(c, false);
        publish(c);
      }
    }
  }
  function positionFloater(c, area) {
    if (!usable(c.floater)) return;
    const width = Math.min(1040, area.width);
    c.collapsed = false;
    c.floater.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y + 8, width, height: 94 });
    publish(c);
  }
  function resizeFloater(c, collapsed) {
    if (c !== current || !usable(c.floater) || (collapsed && (c.busy || c.hovered || c.error))) return;
    c.collapsed = collapsed;
    const bounds = c.floater.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(collapsed ? 330 : 1040, area.width);
    const height = collapsed ? 38 : 94;
    c.floater.setBounds({
      x: Math.round(Math.max(area.x, Math.min(bounds.x + (bounds.width - width) / 2, area.x + area.width - width))),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)), width, height,
    });
    publish(c);
  }
  function createFloater(c) {
    const area = displayFor(c.source, c.meeting).workArea;
    const width = Math.min(1040, area.width);
    const win = new BrowserWindow({
      width, height: 94, x: Math.round(area.x + (area.width - width) / 2), y: area.y + 8,
      frame: false, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, skipTaskbar: true, show: false, title: '共享控制',
      backgroundColor: '#ffffff', icon: getWindowIcon(),
      webPreferences: { devTools, contextIsolation: true, nodeIntegration: false, sandbox: true,
        preload: path.join(__dirname, 'share-floater-preload.js') },
    });
    c.floater = win;
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.once('ready-to-show', () => {
      if (current === c) {
        win.showInactive(); publish(c);
        c.collapseTimer = setTimeout(() => resizeFloater(c, true), 1800);
      }
    });
    win.on('close', event => {
      if (current === c && !c.ended) { event.preventDefault(); resizeFloater(c, true); }
    });
    win.loadFile(path.join(__dirname, 'share-floater.html'));
  }
  async function syncMedia(c) {
    if (c !== current || c.mediaSyncing) return;
    c.mediaSyncing = true;
    try {
      const frames = c.meeting.webContents.mainFrame.framesInSubtree;
      for (const frame of frames) {
        const media = await inFrame(frame, 'meetingState');
        if (current !== c) return;
        if (media) { c.media = media; c.meetingFrame = frame; publish(c); break; }
      }
    } catch { /* Navigation tears down execution contexts; retry on the next poll. */ }
    finally { c.mediaSyncing = false; }
  }
  function begin(grant) {
    if (current) end(current, false);
    const c = { ...grant, paused: false, busy: '', error: '', ended: false, collapsed: false };
    current = c;
    c.onNavigate = (_event, _url, _responseCode, _statusText, isMainFrame, processId, routingId) => {
      if (isMainFrame || (processId === c.frame.processId && routingId === c.frame.routingId)) end(c);
    };
    c.onClosed = () => end(c, false);
    c.meeting.webContents.on('did-frame-navigate', c.onNavigate);
    c.meeting.webContents.on('render-process-gone', c.onClosed);
    c.meeting.once('closed', c.onClosed);
    createFloater(c);
    createBorder(c);
    c.mediaTimer = setInterval(() => void syncMedia(c), 1500);
    void syncMedia(c);
    // Let the source picker's modal relationship finish closing first.
    c.startTimer = setTimeout(() => {
      if (current === c && usable(c.meeting)) c.meeting.minimize();
    }, 100);
    return c;
  }
  ipcMain.handle('desktop-capture-claim', event => {
    let key = frameKey(event.senderFrame);
    let grant = grants.get(key);
    if (!grant) {
      // 借桥注入时发送方是同窗口的父 frame，回退按会议窗口匹配授权。
      for (const [candidateKey, candidate] of grants) {
        if (candidate.meeting?.webContents === event.sender) { key = candidateKey; grant = candidate; break; }
      }
    }
    grants.delete(key);
    if (!grant || Date.now() > grant.expiresAt) return null;
    return { token: grant.token, shareAudio: grant.shareAudio };
  });
  const pending = new Map();
  ipcMain.handle('desktop-capture-ready', (event, token) => {
    const grant = pending.get(token);
    if (!grant || !bridgeSenderMatches(grant, event) || Date.now() > grant.expiresAt) return false;
    pending.delete(token);
    if (current) return false;
    try { begin(grant); return true; }
    catch (error) { end(current, false); console.error('创建共享工具栏失败', error); return false; }
  });
  ipcMain.on('desktop-capture-ended', (event, token) => {
    if (current?.token === token && bridgeSenderMatches(current, event)) end(current);
    const grant = pending.get(token);
    if (grant && bridgeSenderMatches(grant, event)) {
      pending.delete(token);
      if (!current) disableProtection();
    }
  });
  ipcMain.on('screenshare-floater-action', (event, action) => {
    if (!ownFloater(event) || !['pause', 'resume', 'switch', 'stop'].includes(action)) return;
    void run(action);
  });
  ipcMain.handle('screenshare-floater-get-state', event => ownFloater(event) ? state() : null);
  ipcMain.on('screenshare-floater-show-meeting', event => {
    if (!ownFloater(event)) return;
    clearTimeout(current.startTimer);
    restoreMeeting(current);
  });
  ipcMain.on('screenshare-floater-hover', (event, hovering) => {
    if (!ownFloater(event)) return;
    const c = current;
    c.hovered = Boolean(hovering);
    clearTimeout(c.collapseTimer);
    if (hovering) resizeFloater(c, false);
    else c.collapseTimer = setTimeout(() => resizeFloater(c, true), 1800);
  });
  ipcMain.on('screenshare-floater-media', async (event, action) => {
    if (!ownFloater(event) || !['audio', 'video', 'participants', 'recording'].includes(action)) return;
    const c = current;
    if (c.mediaBusy) return;
    c.mediaBusy = true;
    c.error = '';
    publish(c);
    try {
      if (!c.meetingFrame) await syncMedia(c);
      if (!c.meetingFrame) throw new Error('会议控制尚未就绪');
      if (action === 'participants') restoreMeeting(c);
      const result = await inFrame(c.meetingFrame, 'meetingCommand', action);
      if (!result?.ok) throw new Error(result?.error || '会议控制未响应');
      await syncMedia(c);
    } catch (error) { report(c, error.message); }
    finally { c.mediaBusy = false; publish(c); }
  });
  function displaysChanged() {
    const c = current;
    if (!c) return;
    if (c.source.id.startsWith('screen:')) {
      if (c.source.display_id && !screen.getAllDisplays().some(d => String(d.id) === c.source.display_id)) {
        void run('stop');
      } else { createBorder(c); resizeFloater(c, c.collapsed); }
    }
  }
  screen.on('display-metrics-changed', displaysChanged);
  screen.on('display-removed', displaysChanged);
  return {
    authorize(frame, meeting, source, shareAudio) {
      const now = Date.now();
      for (const [key, grant] of grants) if (grant.expiresAt < now) grants.delete(key);
      for (const [key, grant] of pending) if (grant.expiresAt < now) pending.delete(key);
      const grant = { token: randomUUID(), frame, meeting, source: {
        id: source.id, name: source.name, display_id: source.display_id || '',
      }, shareAudio, expiresAt: now + 30000 };
      const key = frameKey(frame);
      if (!key) throw new Error('共享页面已经关闭');
      grants.set(key, grant);
      pending.set(grant.token, grant);
      enableProtection(meeting);
      const expiry = setTimeout(() => {
        if (pending.delete(grant.token) && !current) disableProtection();
        if (grants.get(key) === grant) grants.delete(key);
      }, 30000);
      expiry.unref?.();
    },
    hasActive: () => Boolean(current),
    activeFor: win => current?.meeting === win,
    consumeSwitchSelection(frame) {
      if (!current || !sameFrame(current.frame, frame)) return null;
      const selection = current.switchSelection;
      current.switchSelection = null;
      return selection && Date.now() < selection.expiresAt ? selection : null;
    },
    getState: () => state(),
    shutdown: () => end(current, false),
  };
}
module.exports = { createShareController };
