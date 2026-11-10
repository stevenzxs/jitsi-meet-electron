const { contextBridge, ipcRenderer } = require('electron');

// 只暴露渲染层需要的受控 IPC 能力，避免 iframe 壳页面拿到完整 Electron API。
// 子 iframe 仅使用专用采集桥，不能访问壳的文件和窗口接口。
if (process.isMainFrame) contextBridge.exposeInMainWorld('cloudmeet', {
  getDeploymentConfig() { return ipcRenderer.invoke('deployment-config-get'); },
  openVpnStatus() { return ipcRenderer.invoke('openvpn-status'); },
  openVpnImport() { return ipcRenderer.invoke('openvpn-import'); },
  openVpnSaveRoutes(routes) { return ipcRenderer.invoke('openvpn-routes', routes); },
  openVpnConnect(credentials) { return ipcRenderer.invoke('openvpn-connect', credentials); },
  openVpnDisconnect() { return ipcRenderer.invoke('openvpn-disconnect'); },
  openVpnSaveTestAddress(address) { return ipcRenderer.invoke('openvpn-test-address', address); },
  openVpnTest() { return ipcRenderer.invoke('openvpn-test'); },
  onReloadIframe(handler) {
    ipcRenderer.on('reload-iframe', handler);
  },
  onDesktopInvite(handler) {
    ipcRenderer.on('desktop-invite-received', handler);
  },
  onWindowMaximized(handler) {
    ipcRenderer.on('window-maximized', handler);
  },
  onWindowFullscreen(handler) {
    ipcRenderer.on('window-fullscreen', handler);
  },
  onWindowFullscreenControlsVisible(handler) {
    ipcRenderer.on('window-fullscreen-controls-visible', handler);
  },
  minimizeWindow() {
    ipcRenderer.send('window-minimize');
  },
  toggleMaximizeWindow() {
    ipcRenderer.send('window-maximize');
  },
  toggleFullscreenWindow() {
    ipcRenderer.send('window-toggle-fullscreen');
  },
  setFullscreenWindow(fullscreen) {
    ipcRenderer.send('window-set-fullscreen', Boolean(fullscreen));
  },
  isWindowFullscreen() {
    return ipcRenderer.invoke('window-is-fullscreen');
  },
  closeWindow() {
    ipcRenderer.send('window-close');
  },
  requestCloseWindow() {
    ipcRenderer.send('window-close-request');
  },
  onMeetingWindowCloseRequest(handler) {
    ipcRenderer.on('meeting-window-close-request', handler);
  },
  onScreenSharePickerLoading(handler) {
    ipcRenderer.on('screen-share-picker-loading', handler);
  },
  onScreenShareStopRequest(handler) {
    ipcRenderer.on('screenshare-stop-request', handler);
  },
  // 悬浮条的暂停/恢复/新共享请求：壳转发给会议页执行对应共享操作。
  onScreenSharePauseRequest(handler) {
    ipcRenderer.on('screenshare-pause-request', handler);
  },
  onScreenShareResumeRequest(handler) {
    ipcRenderer.on('screenshare-resume-request', handler);
  },
  onScreenShareSwitchRequest(handler) {
    ipcRenderer.on('screenshare-switch-request', handler);
  },
  // paused 标记暂停态（流已停但共享会话未结束），驱动悬浮条和绿框的状态刷新。
  sendScreenShareState(active, paused) {
    ipcRenderer.send('screenshare-state', { active: Boolean(active), paused: Boolean(paused) });
  },
  getUser() {
    return ipcRenderer.invoke('user-get');
  },
  saveUser(name, userId, legacyUserIds) {
    // userId 只在 Web 本地已有稳定身份、桌面端首次同步时传入；普通改昵称不传。
    return ipcRenderer.invoke('user-save', { name, userId, legacyUserIds });
  },
  getServerUrl() {
    return ipcRenderer.invoke('server-get');
  },
  saveServerUrl(url) {
    return ipcRenderer.invoke('server-save', String(url || ''));
  },
  getSettings() {
    return ipcRenderer.invoke('settings-get');
  },
  saveSettings(settings) {
    return ipcRenderer.invoke('settings-save', settings || {});
  },
  onDesktopSettingsChanged(handler) {
    ipcRenderer.on('desktop-settings-changed', handler);
  },
  chooseRecordingDirectory() {
    return ipcRenderer.invoke('recording-directory-choose');
  },
  openRecordingDirectory(directory) {
    return ipcRenderer.invoke('recording-directory-open', String(directory || ''));
  },
  prepareRecordingCapture() {
    return ipcRenderer.invoke('recording-capture-prepare');
  },
  startRecordingSession(options) {
    return ipcRenderer.invoke('recording-session-start', options || {});
  },
  writeRecordingChunk(payload) {
    return ipcRenderer.invoke('recording-session-write', payload || {});
  },
  finishRecordingSession(sessionId) {
    return ipcRenderer.invoke('recording-session-finish', String(sessionId || ''));
  },
  cancelRecordingSession(sessionId) {
    return ipcRenderer.invoke('recording-session-cancel', String(sessionId || ''));
  },
  onRecordingTranscodeComplete(handler) {
    ipcRenderer.on('recording-transcode-complete', handler);
  },
  onRecordingTranscodeFailed(handler) {
    ipcRenderer.on('recording-transcode-failed', handler);
  },
  openMeetingWindow(url) {
    return ipcRenderer.invoke('open-meeting-window', url);
  },
  getMeetingWindowUrl() {
    return ipcRenderer.invoke('meeting-window-url');
  },
  setWindowTitle(title) {
    ipcRenderer.send('window-set-title', String(title));
  },
  setNativeTheme(theme) {
    ipcRenderer.send('native-theme', String(theme));
  },
});
