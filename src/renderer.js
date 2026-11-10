let DEFAULT_URL = '';
// Initialize before startup calls normalizeDesktopSettings below.
const sharedRecordingSettings = typeof window !== 'undefined' && window.RecordingSettings
  ? window.RecordingSettings
  : null;

// 当前生效的服务器工作台地址：启动时从主进程读取用户配置覆盖编译期默认值。
let currentServerUrl = DEFAULT_URL;

const frame = document.querySelector('#meetingFrame');
let pendingFrameUrl = '';
const offlineEntry = window.createOfflineEntry({
  frame, openSettings,
  reload() { if (pendingFrameUrl) loadFrameUrl(pendingFrameUrl); },
});
const inviteModal = document.querySelector('#inviteModal');
const inviteForm = document.querySelector('#inviteForm');
const closeInviteBtn = document.querySelector('#closeInviteBtn');
const cancelInviteBtn = document.querySelector('#cancelInviteBtn');
const inviteRoomText = document.querySelector('#inviteRoomText');
const inviteSubjectText = document.querySelector('#inviteSubjectText');
const inviteNameInput = document.querySelector('#inviteNameInput');
const invitePasswordInput = document.querySelector('#invitePasswordInput');
const inviteHostKeyInput = document.querySelector('#inviteHostKeyInput');
const minimizeBtn = document.querySelector('#minimizeBtn');
const layoutBtn = document.querySelector('#layoutBtn');
const fullscreenBtn = document.querySelector('#fullscreenBtn');
const maximizeBtn = document.querySelector('#maximizeBtn');
const closeBtn = document.querySelector('#closeBtn');
const settingsBtn = document.querySelector('#settingsBtn');
const winbarSubject = document.querySelector('#winbarSubject');
const winbarTimer = document.querySelector('#winbarTimer');
const shareLoading = document.querySelector('#shareLoading');
const settingsModal = document.querySelector('#settingsModal');
const closeSettingsBtn = document.querySelector('#closeSettingsBtn');
const settingsPanelTitle = document.querySelector('#settingsPanelTitle');
const settingsMenuButtons = Array.from(document.querySelectorAll('[data-settings-tab]'));
const settingsPanels = Array.from(document.querySelectorAll('[data-settings-panel]'));
const recordingDirectoryText = document.querySelector('#recordingDirectoryText');
const changeRecordingDirBtn = document.querySelector('#changeRecordingDirBtn');
const openRecordingDirBtn = document.querySelector('#openRecordingDirBtn');
const recordAudioFileInput = document.querySelector('#recordAudioFileInput');
const tilePollingSecondsInput = document.querySelector('#tilePollingSecondsInput');
const settingsError = document.querySelector('#settingsError');
const layoutModal = document.querySelector('#layoutModal');
const closeLayoutBtn = document.querySelector('#closeLayoutBtn');
const layoutOptionButtons = Array.from(document.querySelectorAll('[data-layout-mode]'));

const DEFAULT_LAYOUT_MODE = 'auto';
const SUPPORTED_LAYOUT_MODES = new Set(['auto', 'default', 'polling', 'grid-2', 'grid-4', 'grid-9', 'grid-16', 'grid-25', 'grid-36', 'grid-49']);
const SETTINGS_TAB_TITLES = {
  profile: '个人信息',
  recording: '录制',
  video: '视频',
  vpn: 'VPN',
};

// 会议窗口使用系统原生边框/标题栏（frame: true），隐藏外壳自绘控件条，避免与系统按钮重复。
const isMeetingWindow = new URLSearchParams(window.location.search).get('mode') === 'meeting';
if (isMeetingWindow) {
  document.body.classList.add('meeting-shell');
}

let pendingInvite = null;
let currentUser = null;
let closeFallbackTimer = null;
let shareLoadingTimer = null;
let windowFullscreen = false;
let fullscreenControlsVisible = false;
let desktopSettings = normalizeDesktopSettings();
let currentLayoutMode = readStoredLayoutMode();
let frameResizeSyncFrame = null;
let lastFrameResizeKey = '';
const meetingPerfStart = performance.now();
const meetingPerfMark = (label) => {
  if (isMeetingWindow) console.info(`[meeting-perf] electron-renderer ${label}`, `${Math.round(performance.now() - meetingPerfStart)}ms`);
};
meetingPerfMark('renderer-start');

// 启动时从桌面存储读取用户，供弹窗预填和转发给 Web 端。
window.cloudmeet.getUser().then((user) => {
  currentUser = user;
  sendUserToFrame();
});

// 与 Web 端 stores/user.ts 约定的用户同步协议：
// - Web 请求当前用户 → cloudmeet-user-get
// - Web 保存新用户名（桌面存储为准） → cloudmeet-user-save
// - 桌面推送用户给 Web → cloudmeet-user
function sendUserToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-user', user: currentUser }, '*');
  }
}

// 与 Web 端 stores/server.ts 约定的服务器配置协议：
// - Web 请求当前服务器 → cloudmeet-server-get
// - Web 保存新服务器 → cloudmeet-server-save
// - 桌面推送配置给 Web → cloudmeet-server
function sendServerToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage(
      { type: 'cloudmeet-server', server: { url: currentServerUrl, defaultUrl: DEFAULT_URL } },
      '*',
    );
  }
}

function sendFullscreenStateToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-fullscreen-changed', fullscreen: windowFullscreen }, '*');
  }
}

function sendFullscreenControlsStateToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage(
      {
        type: 'cloudmeet-fullscreen-controls-visible',
        visible: fullscreenControlsVisible,
        titlebarHeight: Math.ceil(document.querySelector('.winbar')?.getBoundingClientRect().height || 0),
      },
      '*',
    );
  }
}

function sendLayoutToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-layout-change', mode: currentLayoutMode }, '*');
  }
}

function sendWindowResizeToFrame() {
  if (!frame.contentWindow) return;
  const frameRect = frame.getBoundingClientRect();
  const width = Math.round(frameRect.width);
  const height = Math.round(frameRect.height);
  if (width <= 0 || height <= 0) return;
  const maximized = document.body.classList.contains('win-maximized');
  const sizeKey = `${width}x${height}:${windowFullscreen}:${maximized}`;
  if (sizeKey === lastFrameResizeKey) return;
  lastFrameResizeKey = sizeKey;
  frame.contentWindow.postMessage(
    {
      type: 'cloudmeet-window-resized',
      width,
      height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      fullscreen: windowFullscreen,
      maximized,
    },
    '*',
  );
}

function scheduleFrameResizeSync() {
  if (frameResizeSyncFrame !== null) window.cancelAnimationFrame(frameResizeSyncFrame);
  frameResizeSyncFrame = window.requestAnimationFrame(() => {
    frameResizeSyncFrame = null;
    sendWindowResizeToFrame();
  });
}

let recordingActiveNow = false;

function sendSettingsToFrame() {
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({
      type: 'cloudmeet-desktop-settings-changed',
      settings: desktopSettings,
      recordingActive: recordingActiveNow,
    }, '*');
  }
}

function sendFrameResponse(type, requestId, payload = {}) {
  if (!requestId || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type, requestId, ...payload }, '*');
}

function sendRecordingTranscodeResult(type, result) {
  if (!result?.sessionId || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type, sessionId: result.sessionId }, '*');
}

window.cloudmeet.onRecordingTranscodeComplete((_event, result) => {
  sendRecordingTranscodeResult('cloudmeet-recording-transcode-complete', result);
});
window.cloudmeet.onRecordingTranscodeFailed((_event, result) => {
  sendRecordingTranscodeResult('cloudmeet-recording-transcode-failed', result);
});

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

function applyWindowFullscreenState(isFullscreen) {
  windowFullscreen = Boolean(isFullscreen);
  document.body.classList.toggle('window-fullscreen', windowFullscreen);
  setFullscreenControlsVisible(windowFullscreen && document.body.matches(':hover'));
  fullscreenBtn.title = windowFullscreen ? '退出全屏' : '全屏';
  fullscreenBtn.setAttribute('aria-label', windowFullscreen ? '退出全屏' : '全屏');
  sendFullscreenStateToFrame();
  scheduleFrameResizeSync();
}

function setFullscreenControlsVisible(visible) {
  const nextVisible = windowFullscreen && Boolean(visible);
  if (fullscreenControlsVisible === nextVisible) return;
  fullscreenControlsVisible = nextVisible;
  document.body.classList.toggle('fullscreen-controls-visible', fullscreenControlsVisible);
  sendFullscreenControlsStateToFrame();
}

function blurWindowButton(event) {
  event.currentTarget?.blur?.();
}

function normalizeLayoutMode(mode) {
  const value = String(mode || '');
  return SUPPORTED_LAYOUT_MODES.has(value) ? value : DEFAULT_LAYOUT_MODE;
}

// 布局模式持久化到壳 localStorage（与主题同款机制）：重启后恢复上次的分屏选择。
const SHELL_LAYOUT_MODE_KEY = 'cloudmeet-shell-layout-mode';

function readStoredLayoutMode() {
  try {
    const saved = localStorage.getItem(SHELL_LAYOUT_MODE_KEY);
    return SUPPORTED_LAYOUT_MODES.has(saved) ? saved : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

function writeStoredLayoutMode(mode) {
  try {
    localStorage.setItem(SHELL_LAYOUT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function renderLayoutOptions() {
  layoutOptionButtons.forEach((button) => {
    button.classList.toggle('layout-dialog__option--active', normalizeLayoutMode(button.dataset.layoutMode) === currentLayoutMode);
  });
}

// 宫格选项右侧的迷你网格预览：按 data-grid-cols/rows 生成小格，直观展示分屏排列。
function buildGridPreviews() {
  document.querySelectorAll('.layout-dialog__grid-preview').forEach((preview) => {
    const cols = Math.max(1, Number(preview.dataset.gridCols) || 1);
    const rows = Math.max(1, Number(preview.dataset.gridRows) || 1);
    preview.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i = 0; i < cols * rows; i += 1) {
      preview.appendChild(document.createElement('i'));
    }
  });
}
buildGridPreviews();

function openLayout() {
  if (!layoutModal) return;
  renderLayoutOptions();
  layoutModal.hidden = false;
}

function closeLayout() {
  if (!layoutModal) return;
  layoutModal.hidden = true;
}

function applyLayoutMode(mode) {
  currentLayoutMode = normalizeLayoutMode(mode);
  writeStoredLayoutMode(currentLayoutMode);
  renderLayoutOptions();
  sendLayoutToFrame();
  closeLayout();
}

/** Web 设置页保存服务器：校验并持久化后，仅主窗口（工作台）切换到新服务器，会议窗口不打断。 */
function applyServerFromFrame(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    // 地址非法时回推当前生效配置，让 Web 端结束等待并还原显示。
    sendServerToFrame();
    return;
  }
  window.cloudmeet.saveServerUrl(normalized).then((savedUrl) => {
    if (savedUrl) {
      currentServerUrl = savedUrl;
    }
    sendServerToFrame();
    window.cloudmeet.getMeetingWindowUrl().then((meetingUrl) => {
      if (!meetingUrl) {
        loadFrameUrl(currentServerUrl);
      }
    });
  });
}

function handleFrameMessage(event) {
  offlineEntry.message(event);
  if (window.VpnSettingsEntry.handleVpnSettingsRequest(event, frame, currentServerUrl, openSettings)) return;
  if (event.source !== frame.contentWindow) return;
  const data = event.data || {};
  if (data.type === 'cloudmeet-user-get') {
    sendUserToFrame();
  } else if (data.type === 'cloudmeet-user-save' && typeof data.name === 'string' && data.name.trim()) {
    window.cloudmeet.saveUser(data.name.trim()).then((user) => {
      currentUser = user;
      sendUserToFrame();
    });
  } else if (data.type === 'cloudmeet-user-sync' && data.user?.name && !currentUser) {
    // 桌面端作为权威存储；若 Web 本地已有合法 ID，则首次同步时沿用，避免预定会议归属变化。
    window.cloudmeet.saveUser(String(data.user.name).trim(), data.user.userId, data.user.legacyUserIds).then((user) => {
      currentUser = user;
      sendUserToFrame();
    });
  } else if (data.type === 'cloudmeet-server-get') {
    sendServerToFrame();
  } else if (data.type === 'cloudmeet-desktop-settings-get') {
    loadDesktopSettings({ notify: true, requestId: data.requestId }).catch((error) => {
      sendFrameResponse('cloudmeet-desktop-settings', data.requestId, { error: getErrorMessage(error, '读取设置失败') });
    });
  } else if (data.type === 'cloudmeet-desktop-settings-save') {
    window.cloudmeet.saveSettings(data.settings || {}).then((settings) => {
      desktopSettings = normalizeDesktopSettings(settings);
      renderSettings();
      sendSettingsToFrame();
      sendFrameResponse('cloudmeet-desktop-settings-saved', data.requestId, { settings: desktopSettings });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-desktop-settings-saved', data.requestId, { error: getErrorMessage(error, '保存设置失败') });
    });
  } else if (data.type === 'cloudmeet-recording-directory-choose') {
    window.cloudmeet.chooseRecordingDirectory().then((settings) => {
      desktopSettings = normalizeDesktopSettings(settings);
      renderSettings();
      sendSettingsToFrame();
      sendFrameResponse('cloudmeet-recording-directory-chosen', data.requestId, { settings: desktopSettings });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-directory-chosen', data.requestId, { error: getErrorMessage(error, '选择录制目录失败') });
    });
  } else if (data.type === 'cloudmeet-recording-directory-open') {
    window.cloudmeet.openRecordingDirectory(data.directory || '').then((result) => {
      sendFrameResponse('cloudmeet-recording-directory-opened', data.requestId, { result });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-directory-opened', data.requestId, { error: getErrorMessage(error, '打开录制目录失败') });
    });
  } else if (data.type === 'cloudmeet-server-save' && typeof data.url === 'string') {
    applyServerFromFrame(data.url);
  } else if (data.type === 'cloudmeet-open-meeting' && typeof data.url === 'string') {
    // 会议在独立的新桌面窗口打开，主窗口保持在首页。
    window.cloudmeet.openMeetingWindow(data.url);
  } else if (data.type === 'cloudmeet-close-window') {
    // 桌面会议页结束/被移出/出错面板上的"关闭窗口"。
    clearCloseFallback();
    window.cloudmeet.closeWindow();
  } else if (data.type === 'cloudmeet-window-close-deferred') {
    // Web 会议页已把标题栏关闭请求转成结束菜单选择，此时不能再由壳兜底强关窗口。
    clearCloseFallback();
  } else if (data.type === 'cloudmeet-screen-share-loading') {
    setShareLoading(Boolean(data.loading));
  } else if (data.type === 'cloudmeet-screen-share-state') {
    // Web 会议页上报本地共享状态（含暂停态）：主进程据此驱动悬浮条/绿框/窗口还原。
    window.cloudmeet.sendScreenShareState(Boolean(data.active), Boolean(data.paused));
  } else if (data.type === 'cloudmeet-meeting-subject' && typeof data.subject === 'string') {
    // 主题写入窗口标题（任务栏/Alt-Tab 可见），并显示在自绘标题栏中央。
    window.cloudmeet.setWindowTitle(data.subject);
    if (winbarSubject) {
      winbarSubject.textContent = data.subject;
      winbarSubject.title = data.subject;
    }
  } else if (data.type === 'cloudmeet-layout-changed' && SUPPORTED_LAYOUT_MODES.has(data.mode)) {
    currentLayoutMode = data.mode;
    writeStoredLayoutMode(currentLayoutMode);
    renderLayoutOptions();
  } else if (data.type === 'cloudmeet-meeting-elapsed' && typeof data.text === 'string') {
    // 会议页每秒推送的时长（04:12 / 1:04:12），显示在标题栏全屏按钮左侧；空串表示会议结束，隐藏。
    if (winbarTimer) {
      winbarTimer.textContent = data.text ? `会议详情 ${data.text}` : '';
      winbarTimer.hidden = !data.text;
    }
  } else if (data.type === 'cloudmeet-theme-changed' && (data.theme === 'light' || data.theme === 'dark')) {
    // 跟随 Web 页面主题：标题栏/外壳弹窗整体切换浅色/深色，并通知主进程切换原生标题栏。
    applyShellTheme(data.theme);
  } else if (data.type === 'cloudmeet-toggle-fullscreen') {
    window.cloudmeet.toggleFullscreenWindow();
  } else if (data.type === 'cloudmeet-set-fullscreen') {
    window.cloudmeet.setFullscreenWindow(Boolean(data.fullscreen));
  } else if (data.type === 'cloudmeet-request-fullscreen-state') {
    sendFullscreenStateToFrame();
  } else if (data.type === 'cloudmeet-recording-capture-prepare') {
    window.cloudmeet.prepareRecordingCapture().then((result) => {
      sendFrameResponse('cloudmeet-recording-capture-prepared', data.requestId, { result });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-capture-prepared', data.requestId, { error: getErrorMessage(error, '准备录屏采集失败') });
    });
  } else if (data.type === 'cloudmeet-recording-settings-get') {
    window.cloudmeet.getSettings().then((settings) => {
      sendFrameResponse('cloudmeet-recording-settings', data.requestId, { settings });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-settings', data.requestId, { error: getErrorMessage(error, '读取录制设置失败') });
    });
  } else if (data.type === 'cloudmeet-recording-session-start') {
    window.cloudmeet.startRecordingSession(data.options || {}).then((session) => {
      sendFrameResponse('cloudmeet-recording-session-started', data.requestId, { session });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-session-started', data.requestId, { error: getErrorMessage(error, '创建录制文件失败') });
    });
  } else if (data.type === 'cloudmeet-recording-session-chunk') {
    window.cloudmeet.writeRecordingChunk({
      sessionId: data.sessionId,
      kind: data.kind,
      data: data.data,
    }).then((result) => {
      sendFrameResponse('cloudmeet-recording-session-chunk-written', data.requestId, { result });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-session-chunk-written', data.requestId, { error: getErrorMessage(error, '写入录制文件失败') });
    });
  } else if (data.type === 'cloudmeet-recording-session-finish') {
    window.cloudmeet.finishRecordingSession(data.sessionId).then((result) => {
      sendFrameResponse('cloudmeet-recording-session-finished', data.requestId, { result });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-session-finished', data.requestId, { error: getErrorMessage(error, '结束录制失败') });
    });
  } else if (data.type === 'cloudmeet-recording-session-cancel') {
    window.cloudmeet.cancelRecordingSession(data.sessionId).then((result) => {
      sendFrameResponse('cloudmeet-recording-session-canceled', data.requestId, { result });
    }).catch((error) => {
      sendFrameResponse('cloudmeet-recording-session-canceled', data.requestId, { error: getErrorMessage(error, '取消录制失败') });
    });
  }
}

const SHELL_THEME_KEY = 'cloudmeet-shell-theme';

/**
 * 应用外壳主题：
 * 1. 壳自身 data-theme（驱动 styles.css 的浅色/深色变量）；
 * 2. 通知主进程更新 nativeTheme，让系统原生标题栏（会议窗口 frame:true）跟随主题；
 * 3. 持久化到壳自己的 localStorage（与 Web 应用 localStorage 不同源），重启后第一时间恢复。
 */
function applyShellTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  window.cloudmeet.setNativeTheme(theme);
  try {
    localStorage.setItem(SHELL_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

// 启动时先恢复上次主题，避免 Web 页面加载完成前原生标题栏一直停留在默认浅色。
const savedShellTheme = localStorage.getItem(SHELL_THEME_KEY);
if (savedShellTheme === 'light' || savedShellTheme === 'dark') {
  applyShellTheme(savedShellTheme);
}

window.addEventListener('message', handleFrameMessage);
window.cloudmeet.onDesktopSettingsChanged((_event, settings, meta) => {
  desktopSettings = normalizeDesktopSettings(settings);
  recordingActiveNow = Boolean(meta && meta.recordingActive);
  renderSettings();
  sendSettingsToFrame();
});
window.addEventListener('resize', scheduleFrameResizeSync);
// iframe 重新加载（F5/深链跳转）后把用户和窗口状态再推一次，保证 Web 端 store 与工具栏状态不丢。
frame.addEventListener('load', () => {
  meetingPerfMark('meeting-frame-load');
  lastFrameResizeKey = '';
  sendUserToFrame();
  sendFullscreenStateToFrame();
  sendFullscreenControlsStateToFrame();
  sendLayoutToFrame();
  scheduleFrameResizeSync();
  loadDesktopSettings({ notify: true }).catch(() => {});
});

// 无边框窗口控件。
minimizeBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  window.cloudmeet.minimizeWindow();
});
layoutBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  openLayout();
});
fullscreenBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  window.cloudmeet.toggleFullscreenWindow();
});
settingsBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  openSettings();
});
maximizeBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  window.cloudmeet.toggleMaximizeWindow();
});
closeBtn.addEventListener('click', (event) => {
  blurWindowButton(event);
  window.cloudmeet.requestCloseWindow();
});
window.cloudmeet.onWindowMaximized((_event, isMaximized) => {
  document.body.classList.toggle('win-maximized', Boolean(isMaximized));
  maximizeBtn.title = isMaximized ? '还原' : '最大化';
  maximizeBtn.setAttribute('aria-label', isMaximized ? '还原' : '最大化');
  scheduleFrameResizeSync();
});
window.cloudmeet.onWindowFullscreen((_event, isFullscreen) => {
  applyWindowFullscreenState(isFullscreen);
});
window.cloudmeet.onWindowFullscreenControlsVisible((_event, visible) => {
  setFullscreenControlsVisible(Boolean(visible));
});
window.cloudmeet.isWindowFullscreen().then((isFullscreen) => {
  applyWindowFullscreenState(isFullscreen);
});

window.cloudmeet.onReloadIframe(() => {
  // 会议窗口刷新会议页；主窗口（无会议 URL）回到当前配置的服务器工作台。
  window.cloudmeet.getMeetingWindowUrl().then((url) => {
    loadFrameUrl(url || currentServerUrl);
  });
});
window.cloudmeet.onMeetingWindowCloseRequest(requestWindowClose);
window.cloudmeet.onScreenSharePickerLoading((_event, loading) => {
  setShareLoading(Boolean(loading));
});
window.cloudmeet.onScreenShareStopRequest(() => {
  // 悬浮控制条的"停止共享"按钮：转成契约消息交给会议页执行 toggleShareScreen。
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-stop-screen-share' }, '*');
  }
});
window.cloudmeet.onScreenSharePauseRequest(() => {
  // 悬浮控制条的"暂停共享"：会议页停止推流但保留共享会话（壳端记住共享源，恢复时免选择器）。
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-pause-screen-share' }, '*');
  }
});
window.cloudmeet.onScreenShareResumeRequest(() => {
  // 悬浮控制条的"恢复共享"：会议页重新发起共享，主进程自动授权上一次的源。
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-resume-screen-share' }, '*');
  }
});
window.cloudmeet.onScreenShareSwitchRequest(() => {
  // 悬浮控制条的"新共享"：会议页停止当前共享并重新发起，触发主进程弹出源选择器。
  if (frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'cloudmeet-switch-screen-share' }, '*');
  }
});
window.cloudmeet.onDesktopInvite((_event, invite) => openInvite(invite));
closeLayoutBtn.addEventListener('click', closeLayout);
layoutModal.addEventListener('click', (event) => {
  if (event.target === layoutModal) {
    closeLayout();
  }
});
layoutOptionButtons.forEach((button) => {
  button.addEventListener('click', () => applyLayoutMode(button.dataset.layoutMode));
});
closeSettingsBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) {
    closeSettings();
  }
});
settingsMenuButtons.forEach((button) => {
  button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
});
changeRecordingDirBtn.addEventListener('click', changeRecordingDirectory);
openRecordingDirBtn.addEventListener('click', openRecordingDirectory);
recordAudioFileInput.addEventListener('change', () => {
  desktopSettings.recording.recordAudioFile = recordAudioFileInput.checked;
  saveDesktopSettings();
});
document.querySelectorAll('input[name="recordingMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    const modes = Array.from(document.querySelectorAll('input[name="recordingMode"]')).filter(item => item.checked).map(item => item.value);
    if (!modes.length) {
      input.checked = true;
      setSettingsError('请至少选择一种录制模式');
      return;
    }
    desktopSettings.recording.modes = modes;
    saveDesktopSettings();
  });
});
tilePollingSecondsInput.addEventListener('change', () => {
  desktopSettings.video.tilePollingSeconds = normalizeTilePollingSeconds(tilePollingSecondsInput.value);
  saveDesktopSettings();
});
inviteHostKeyInput.addEventListener('input', () => {
  inviteHostKeyInput.value = formatHostKey(inviteHostKeyInput.value);
});
closeInviteBtn.addEventListener('click', closeInvite);
cancelInviteBtn.addEventListener('click', closeInvite);
inviteModal.addEventListener('click', (event) => {
  if (event.target === inviteModal) {
    closeInvite();
  }
});

inviteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  joinPendingInvite();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsModal && !settingsModal.hidden) {
    closeSettings();
  }
});

// 与主进程共用同一规范化实现（src/recording-settings.js，window.RecordingSettings）。
function normalizeDesktopSettings(settings = {}) {
  if (sharedRecordingSettings) return sharedRecordingSettings.normalizeDesktopSettings(settings);
  const recording = settings?.recording || {};
  const video = settings?.video || {};
  // 旧版配置是分钟字段（tilePollingMinutes），读取时按 ×60 兼容换算为秒。
  const legacyMinutes = Number(video.tilePollingMinutes);
  const seconds = video.tilePollingSeconds ?? (Number.isFinite(legacyMinutes) ? legacyMinutes * 60 : undefined);
  return {
    recording: {
      directory: typeof recording.directory === 'string' ? recording.directory : '',
      recordAudioFile: Boolean(recording.recordAudioFile),
      mode: recording.mode === 'shared-screen' ? 'shared-screen' : 'host-camera',
      modes: Array.isArray(recording.modes)
        ? ['host-camera', 'shared-screen', 'composite'].filter(mode => recording.modes.includes(mode))
        : [recording.mode === 'shared-screen' ? 'shared-screen' : 'host-camera'],
    },
    video: {
      tilePollingSeconds: normalizeTilePollingSeconds(seconds),
    },
  };
}

function normalizeTilePollingSeconds(value) {
  if (sharedRecordingSettings) return sharedRecordingSettings.normalizeTilePollingSeconds(value);
  if (value === undefined || value === null || value === '') return 60;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 60;
  const rounded = Math.round(seconds);
  if (rounded <= 0) return 0;
  return Math.min(7200, Math.max(15, rounded));
}

function setSettingsError(message = '') {
  if (!settingsError) return;
  settingsError.textContent = message;
  settingsError.hidden = !message;
}

function renderSettings() {
  const directory = desktopSettings.recording.directory || '未设置';
  if (recordingDirectoryText) {
    recordingDirectoryText.textContent = directory;
    recordingDirectoryText.title = desktopSettings.recording.directory || '';
  }
  if (recordAudioFileInput) {
    recordAudioFileInput.checked = desktopSettings.recording.recordAudioFile;
  }
  document.querySelectorAll('input[name="recordingMode"]').forEach((input) => {
    input.checked = desktopSettings.recording.modes.includes(input.value);
    // 录制会话期间主进程拒绝模式变更；控件同步禁用，避免无效操作。
    input.disabled = recordingActiveNow;
  });
  const modeHint = document.querySelector('#recordingModeHint');
  if (modeHint) modeHint.textContent = recordingActiveNow
    ? '录制中，暂不可切换模式。停止录制后可更改。'
    : '可多选，每项生成一个视频；不含会议界面或电脑共享声音。';
  if (tilePollingSecondsInput) {
    tilePollingSecondsInput.value = String(desktopSettings.video.tilePollingSeconds);
  }
}

function setSettingsTab(tab = 'recording') {
  const normalizedTab = SETTINGS_TAB_TITLES[tab] ? tab : 'recording';
  settingsMenuButtons.forEach((button) => {
    button.classList.toggle('settings-dialog__nav--active', button.dataset.settingsTab === normalizedTab);
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== normalizedTab;
  });
  if (settingsPanelTitle) {
    settingsPanelTitle.textContent = SETTINGS_TAB_TITLES[normalizedTab];
  }
  document.dispatchEvent(new CustomEvent('vpn-panel-visibility', { detail: normalizedTab === 'vpn' }));
}

function loadDesktopSettings(options = {}) {
  return window.cloudmeet.getSettings().then((settings) => {
    desktopSettings = normalizeDesktopSettings(settings);
    if (options.render) {
      renderSettings();
    }
    if (options.notify) {
      sendSettingsToFrame();
    }
    if (options.requestId) {
      sendFrameResponse('cloudmeet-desktop-settings', options.requestId, { settings: desktopSettings });
    }
    return desktopSettings;
  });
}

function openSettings(tab = 'profile') {
  if (!settingsModal) return;
  setSettingsTab(typeof tab === 'string' ? tab : 'profile');
  document.getElementById('preferencesName').value = currentUser?.name || '';
  document.getElementById('preferencesUserId').textContent = currentUser?.userId || '填写用户名并关闭设置后自动生成';
  document.getElementById('preferencesUserResult').textContent = '';
  setSettingsError('');
  settingsModal.hidden = false;
  if (recordingDirectoryText) {
    recordingDirectoryText.textContent = '正在读取...';
    recordingDirectoryText.title = '';
  }
  loadDesktopSettings({ render: true }).catch(() => {
    setSettingsError('读取设置失败');
    renderSettings();
  });
}

let closingSettings = false;
async function closeSettings() {
  if (!settingsModal || settingsModal.hidden || closingSettings) return;
  const result = document.getElementById('preferencesUserResult');
  const name = document.getElementById('preferencesName').value.trim();
  const nameChanged = name !== (currentUser?.name || '');
  if (nameChanged && (!name || name.length > 20 || /[\x00-\x1f]/.test(name))) {
    setSettingsTab('profile');
    result.textContent = '请输入 1–20 个字符的用户名。';
    document.getElementById('preferencesName').focus();
    return;
  }
  closingSettings = true;
  document.getElementById('preferencesName').disabled = true;
  try {
    try { await window.cloudmeetVpnPanel?.savePending(); }
    catch (cause) { setSettingsTab('vpn'); throw cause; }
    if (nameChanged) {
      try { currentUser = await window.cloudmeet.saveUser(name); }
      catch (cause) { setSettingsTab('profile'); result.textContent = '保存用户名失败，请重试。'; throw cause; }
      document.getElementById('preferencesUserId').textContent = currentUser.userId || '';
      sendUserToFrame();
    }
    document.dispatchEvent(new CustomEvent('vpn-panel-visibility', { detail: false }));
    settingsModal.hidden = true;
    setSettingsError('');
  } catch (cause) { setSettingsError(cause.message || '保存设置失败，请重试。'); }
  finally { closingSettings = false; document.getElementById('preferencesName').disabled = false; }
}

function saveDesktopSettings() {
  setSettingsError('');
  const requestedMode = JSON.stringify(desktopSettings.recording.modes);
  return window.cloudmeet.saveSettings(desktopSettings).then((settings) => {
    desktopSettings = normalizeDesktopSettings(settings);
    // 主进程在录制会话期间会强制保留旧模式：返回模式与请求不一致即被拒绝。
    if (JSON.stringify(desktopSettings.recording.modes) !== requestedMode) {
      setSettingsError('录制期间不可切换录制模式');
    }
    renderSettings();
    sendSettingsToFrame();
    return desktopSettings;
  }).catch(() => {
    setSettingsError('保存设置失败');
    renderSettings();
    return desktopSettings;
  });
}

async function changeRecordingDirectory() {
  setSettingsError('');
  changeRecordingDirBtn.disabled = true;
  try {
    const settings = await window.cloudmeet.chooseRecordingDirectory();
    desktopSettings = normalizeDesktopSettings(settings);
    renderSettings();
    sendSettingsToFrame();
  } catch {
    setSettingsError('选择目录失败');
  } finally {
    changeRecordingDirBtn.disabled = false;
  }
}

async function openRecordingDirectory() {
  setSettingsError('');
  openRecordingDirBtn.disabled = true;
  try {
    const result = await window.cloudmeet.openRecordingDirectory(desktopSettings.recording.directory);
    if (!result?.ok) {
      setSettingsError(result?.error || '打开目录失败');
    }
  } catch {
    setSettingsError('打开目录失败');
  } finally {
    openRecordingDirBtn.disabled = false;
  }
}

/** 打开桌面协议唤起后的加入弹窗，让用户补齐不会出现在分享链接里的入会信息。 */
function openInvite(invite) {
  if (!invite?.roomName) return;
  pendingInvite = invite;
  inviteRoomText.textContent = formatMeetingId(invite.roomName);
  inviteSubjectText.textContent = invite.subject || '云会议邀请';
  inviteNameInput.value = currentUser?.name || '';
  invitePasswordInput.value = '';
  inviteHostKeyInput.value = '';
  inviteModal.hidden = false;
  document.body.classList.add('modal-open');
  inviteNameInput.focus();
}

function closeInvite() {
  inviteModal.hidden = true;
  document.body.classList.remove('modal-open');
}

function clearCloseFallback() {
  if (closeFallbackTimer) {
    window.clearTimeout(closeFallbackTimer);
    closeFallbackTimer = null;
  }
}

function setShareLoading(loading) {
  if (shareLoading) {
    shareLoading.hidden = !loading;
  }
  if (shareLoadingTimer) {
    window.clearTimeout(shareLoadingTimer);
    shareLoadingTimer = null;
  }
  if (loading) {
    // Jitsi 点击事件可能先于 Electron 共享回调；超时兜底避免异常时加载态停留。
    shareLoadingTimer = window.setTimeout(() => {
      if (shareLoading) {
        shareLoading.hidden = true;
      }
      shareLoadingTimer = null;
    }, 10000);
  }
}

/** 用户关闭会议窗口时先通知 iframe 主动离会；无会议窗口或页面无响应时再兜底关窗。 */
function requestWindowClose() {
  window.cloudmeet.getMeetingWindowUrl().then((url) => {
    if (!url) {
      window.cloudmeet.closeWindow();
      return;
    }
    frame.contentWindow?.postMessage({ type: 'cloudmeet-window-close-request', anchor: getCloseButtonAnchor() }, '*');
    clearCloseFallback();
    closeFallbackTimer = window.setTimeout(() => {
      window.cloudmeet.closeWindow();
    }, 1600);
  });
}

/**
 * 把壳层关闭按钮位置换算成 iframe 内可用的 top/right 坐标。
 * 会议页会用这个锚点在关闭按钮下方弹出结束选项，而不是打开底部工具栏菜单。
 */
function getCloseButtonAnchor() {
  const buttonRect = closeBtn.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return {
    top: Math.max(8, buttonRect.bottom - frameRect.top + 8),
    right: Math.max(8, frameRect.right - buttonRect.right + 12),
  };
}

/** 加载 iframe 目标页，统一追加 desktop=1，方便 Web 端识别桌面壳环境。 */
function loadFrameUrl(url) {
  pendingFrameUrl = url;
  offlineEntry.start(url);
  frame.src = buildDesktopUrl(url);
  // 新页面加载时清掉标题栏会议主题和时长，等会议页挂载后重新推送。
  if (winbarSubject) {
    winbarSubject.textContent = '';
    winbarSubject.title = '';
  }
  if (winbarTimer) {
    winbarTimer.textContent = '';
    winbarTimer.hidden = true;
  }
}

function buildDesktopUrl(rawUrl) {
  const url = new URL(rawUrl);
  // 给被嵌入页面一个明确标记，方便 Web 端按桌面壳场景隐藏装饰和优化滚动条。
  url.searchParams.set('desktop', '1');
  return url.href;
}

/** 根据协议传来的 Web 根地址或当前配置的服务器拼出桌面会议页； */
function buildMeetingUrlFromConfiguredBase(roomName, webBaseUrl) {
  const configuredUrl = normalizeUrl(webBaseUrl || currentServerUrl);
  const base = getWebBaseUrl(configuredUrl);
  return new URL(`desktop/meeting/${roomName}`, base.href);
}

/** 从桌面工作台、桌面会议页、邀请页或 Web 会议页 URL 还原 Web 应用根路径。 */
function getWebBaseUrl(rawUrl) {
  const base = new URL(rawUrl);
  const normalizedPath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const desktopMeetingIndex = normalizedPath.indexOf('/desktop/meeting/');
  if (desktopMeetingIndex >= 0) {
    base.pathname = normalizedPath.slice(0, desktopMeetingIndex + 1);
  } else {
    const meetingIndex = normalizedPath.indexOf('/meeting/');
    if (meetingIndex >= 0) {
      base.pathname = normalizedPath.slice(0, meetingIndex + 1);
    } else if (normalizedPath.endsWith('/desktop/')) {
      base.pathname = normalizedPath.slice(0, -'desktop/'.length);
    } else if (normalizedPath.endsWith('/invite/')) {
      base.pathname = normalizedPath.slice(0, -'invite/'.length);
    } else {
      base.pathname = normalizedPath;
    }
  }
  base.search = '';
  base.hash = '';
  return base;
}

/** 把桌面弹窗中的昵称/密码作为一次性 query 交给 Web 会议页，随后由 Web 端写入 sessionStorage 并清理 URL。 */
function joinPendingInvite() {
  if (!pendingInvite?.roomName) return;
  const displayName = inviteNameInput.value.trim();
  const password = invitePasswordInput.value.trim();
  const hostKey = formatHostKey(inviteHostKeyInput.value);
  if (!displayName) {
    inviteNameInput.focus();
    return;
  }
  const meetingUrl = buildMeetingUrlFromConfiguredBase(pendingInvite.roomName, pendingInvite.webBaseUrl);
  meetingUrl.searchParams.set('desktopJoin', '1');
  meetingUrl.searchParams.set('displayName', displayName);
  if (password) {
    meetingUrl.searchParams.set('password', password);
  }
  if (hostKey) {
    meetingUrl.searchParams.set('hostKey', hostKey);
  }
  if (pendingInvite.subject) {
    meetingUrl.searchParams.set('subject', pendingInvite.subject);
  }
  closeInvite();
  // 深链入会同样在独立的新桌面窗口进行。
  window.cloudmeet.openMeetingWindow(meetingUrl.href);
}

/** 主持人密钥输入清洗：只保留合法字符并按 XXXX-XXXX-XXXX-XXXX 分组 */
function formatHostKey(value) {
  const raw = String(value || '')
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, 16);
  return (raw.match(/.{4}/g) || []).join('-');
}

function formatMeetingId(id) {
  return String(id || '')
    .replace(/\D/g, '')
    .replace(/(\d{3})(?=\d)/g, '$1 ')
    .trim();
}

function normalizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const hasProtocol = value.startsWith('http://') || value.startsWith('https://');
    const defaultProtocol = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value) ? 'http://' : 'https://';
    const url = new URL(hasProtocol ? value : `${defaultProtocol}${value}`);
    return url.href;
  } catch {
    return '';
  }
}

// 会议窗口由主进程通过 IPC 告知 iframe 加载目标；主窗口回退到用户配置的服务器工作台。
// 不在 URL query 里传会议地址，避免含 & / % / 中文的参数被编码破坏。
// 启动顺序：先读主进程持久化的服务器地址（覆盖编译期默认），再决定加载目标。
window.cloudmeet.getDeploymentConfig().then((config) => {
  DEFAULT_URL = config.desktopUrl;
  return window.cloudmeet.getServerUrl();
}).then((storedServerUrl) => {
  if (storedServerUrl) {
    currentServerUrl = storedServerUrl;
  }
  return window.cloudmeet.getMeetingWindowUrl();
}).then((url) => {
  if (url) {
    // IPC 层面再次确认会议窗口：即使 query 参数缺失，也隐藏自绘控件条，保证系统原生标题栏独占。
    document.body.classList.add('meeting-shell');
  }
  meetingPerfMark('meeting-window-url-ready');
  loadFrameUrl(url || currentServerUrl);
  meetingPerfMark('remote-frame-load-requested');
});
