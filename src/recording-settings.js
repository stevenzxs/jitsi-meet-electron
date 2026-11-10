'use strict';

/**
 * 录制/桌面设置的共享规范化（main.js 与 renderer.js 同一实现，避免边界漂移）。
 * modes: 主持人 / 共享屏幕 / 合成输出数组；mode 保留用于旧版配置兼容。
 * 浏览器渲染层经 <script> 引入（window.RecordingSettings）；主进程经 require 引入。
 */

(function bootstrap(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('node:path'));
  } else {
    root.RecordingSettings = factory({ resolve: (...parts) => parts.join('/') });
  }
})(typeof self !== 'undefined' ? self : globalThis, function createRecordingSettings(path) {
  const DEFAULT_TILE_POLLING_SECONDS = 60;
  const TILE_POLLING_MIN = 15;
  const TILE_POLLING_MAX = 7200;

  function normalizeRecordingMode(mode) {
    return mode === 'shared-screen' ? 'shared-screen' : 'host-camera';
  }

  function normalizeRecordingModes(modes, legacyMode) {
    if (!Array.isArray(modes)) return [normalizeRecordingMode(legacyMode)];
    return ['host-camera', 'shared-screen', 'composite'].filter(mode => modes.includes(mode));
  }

  function normalizeTilePollingSeconds(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_TILE_POLLING_SECONDS;
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return DEFAULT_TILE_POLLING_SECONDS;
    const rounded = Math.round(seconds);
    if (rounded <= 0) return 0;
    return Math.min(TILE_POLLING_MAX, Math.max(TILE_POLLING_MIN, rounded));
  }

  /**
   * @param {unknown} settings 原始设置对象
   * @param {object} options
   * @param {string} [options.defaultDirectory] 目录为空时的回退值（主进程传默认录制目录；渲染层传 ''）
   * @param {boolean} [options.resolveDirectory] 主进程风格：trim 后 path.resolve；渲染层保持原字符串
   */
  function normalizeDesktopSettings(settings = {}, options = {}) {
    const { defaultDirectory = '', resolveDirectory = false } = options || {};
    const recording = (settings && settings.recording) || {};
    const video = (settings && settings.video) || {};
    // 旧版配置是分钟字段（tilePollingMinutes），读取时按 ×60 兼容换算为秒。
    const legacyMinutes = Number(video.tilePollingMinutes);
    const seconds = video.tilePollingSeconds !== undefined && video.tilePollingSeconds !== null
      ? video.tilePollingSeconds
      : (Number.isFinite(legacyMinutes) ? legacyMinutes * 60 : undefined);
    const directory = typeof recording.directory === 'string' && recording.directory.trim()
      ? (resolveDirectory ? path.resolve(recording.directory.trim()) : recording.directory)
      : defaultDirectory;
    return {
      recording: {
        directory,
        recordAudioFile: Boolean(recording.recordAudioFile),
        mode: normalizeRecordingMode(recording.mode),
        modes: normalizeRecordingModes(recording.modes, recording.mode),
      },
      video: {
        tilePollingSeconds: normalizeTilePollingSeconds(seconds),
      },
    };
  }

  /**
   * 录制会话级模式锁：任何录制会话存在期间拒绝 modes 集合变更，其余设置照常可改。
   */
  function applyRecordingModeLock(currentSettings, incomingSettings, modeLocked) {
    const incoming = (incomingSettings && incomingSettings.recording) || {};
    if (!modeLocked) return { settings: incomingSettings, modeRejected: false };
    const currentMode = normalizeRecordingMode(((currentSettings || {}).recording || {}).mode);
    const incomingMode = normalizeRecordingMode(incoming.mode);
    const currentModes = normalizeRecordingModes(currentSettings?.recording?.modes, currentMode);
    const incomingModes = normalizeRecordingModes(incoming.modes, incomingMode);
    if (JSON.stringify(currentModes) === JSON.stringify(incomingModes)) return { settings: incomingSettings, modeRejected: false };
    return {
      settings: {
        ...incomingSettings,
        recording: { ...incoming, mode: currentMode, modes: currentModes },
      },
      modeRejected: true,
    };
  }

  return {
    normalizeRecordingMode,
    normalizeRecordingModes,
    normalizeTilePollingSeconds,
    normalizeDesktopSettings,
    applyRecordingModeLock,
  };
});
