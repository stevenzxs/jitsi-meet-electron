// Task 2 (electron): recording mode normalization shared by main.js and renderer.js.
// Run: node scripts/test-recording-settings.cjs
const assert = require('node:assert/strict')

const settingsSchema = require('../src/recording-settings')
const fs = require('node:fs')
const vm = require('node:vm')
const renderer = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8')
// Execute real startup through its first settings normalization, including hoisted helpers.
const helpersStart = renderer.indexOf('function normalizeDesktopSettings(')
const helpersEnd = renderer.indexOf('\n}', renderer.indexOf('function normalizeTilePollingSeconds(')) + 2
const boot = renderer.slice(0, renderer.indexOf('let currentLayoutMode ='))
assert.doesNotThrow(() => vm.runInNewContext(boot + '\n' + renderer.slice(helpersStart, helpersEnd), {
  document: { querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {} } } },
  window: { location: { search: '' }, RecordingSettings: settingsSchema, createOfflineEntry: () => ({}) }, URLSearchParams,
  openSettings() {},
}), 'renderer must normalize initial settings without accessing uninitialized bindings')

const { normalizeRecordingMode, normalizeDesktopSettings } = settingsSchema
assert.equal(typeof normalizeRecordingMode, 'function', 'shared schema must export normalizeRecordingMode')
assert.equal(typeof normalizeDesktopSettings, 'function', 'shared schema must export normalizeDesktopSettings')

// --- mode boundary ---
assert.equal(normalizeRecordingMode('host-camera'), 'host-camera')
assert.equal(normalizeRecordingMode('shared-screen'), 'shared-screen')
for (const junk of [undefined, null, '', 'nonsense', 'shared', 'HOST-CAMERA', 0]) {
  assert.equal(normalizeRecordingMode(junk), 'host-camera', `unknown mode ${JSON.stringify(junk)} must fall back`)
}

// --- main-process style: directory default resolved ---
const mainDefault = 'C:/Videos/CloudMeet Recordings'
const mainNormalized = normalizeDesktopSettings({
  recording: { mode: 'shared-screen', recordAudioFile: true },
}, { defaultDirectory: mainDefault, resolveDirectory: true })
assert.equal(mainNormalized.recording.mode, 'shared-screen', 'valid mode survives main normalization')
assert.equal(mainNormalized.recording.directory, mainDefault, 'blank directory falls back to default')
assert.equal(mainNormalized.recording.recordAudioFile, true)

const junkMain = normalizeDesktopSettings({ recording: { mode: 'x', directory: '  ' } },
  { defaultDirectory: mainDefault, resolveDirectory: true })
assert.equal(junkMain.recording.mode, 'host-camera')
assert.equal(junkMain.recording.directory, mainDefault)

// --- renderer style: directory kept raw, no default ---
const rendererNormalized = normalizeDesktopSettings({
  recording: { mode: 'shared-screen', directory: 'D:/rec', recordAudioFile: false },
  video: { tilePollingSeconds: 45 },
})
assert.equal(rendererNormalized.recording.mode, 'shared-screen')
assert.equal(rendererNormalized.recording.directory, 'D:/rec', 'renderer keeps raw directory')
assert.equal(rendererNormalized.video.tilePollingSeconds, 45)

// --- legacy/regression: tilePollingMinutes and clamping ---
assert.equal(normalizeDesktopSettings({ video: { tilePollingMinutes: 2 } }).video.tilePollingSeconds, 120)
assert.equal(normalizeDesktopSettings({ video: { tilePollingSeconds: 5 } }).video.tilePollingSeconds, 15)
assert.equal(normalizeDesktopSettings({ video: { tilePollingSeconds: 99999 } }).video.tilePollingSeconds, 7200)
assert.equal(normalizeDesktopSettings({ video: { tilePollingSeconds: 0 } }).video.tilePollingSeconds, 0)

console.log('PASS electron recording settings (shared normalization incl. mode)')
