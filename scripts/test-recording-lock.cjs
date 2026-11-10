// Task 5 (electron): recording-mode lock across windows, enforced at the main-process boundary.
// Run: node scripts/test-recording-lock.cjs
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const { applyRecordingModeLock, normalizeDesktopSettings, normalizeRecordingMode } = require('../src/recording-settings')
assert.equal(typeof applyRecordingModeLock, 'function', 'shared schema must export applyRecordingModeLock')

const current = normalizeDesktopSettings({ recording: { mode: 'host-camera', directory: 'D:/rec', recordAudioFile: true } })

// --- unlocked: everything passes through ---
{
  const { settings, modeRejected } = applyRecordingModeLock(current, {
    recording: { mode: 'shared-screen', directory: 'D:/rec2', recordAudioFile: false },
  }, false)
  assert.equal(modeRejected, false)
  assert.equal(settings.recording.mode, 'shared-screen')
  assert.equal(settings.recording.directory, 'D:/rec2')
}

// --- locked, same mode: allowed; unrelated settings still mutable ---
{
  const { settings, modeRejected } = applyRecordingModeLock(current, {
    recording: { mode: 'host-camera', directory: 'D:/rec2', recordAudioFile: false },
  }, true)
  assert.equal(modeRejected, false)
  assert.equal(settings.recording.mode, 'host-camera')
  assert.equal(settings.recording.directory, 'D:/rec2', 'directory still mutable while recording')
  assert.equal(settings.recording.recordAudioFile, false, 'audio flag still mutable while recording')
}

// --- locked, mode mutation: rejected, old mode forced, everything else kept ---
{
  const { settings, modeRejected } = applyRecordingModeLock(current, {
    recording: { mode: 'shared-screen', directory: 'D:/rec2', recordAudioFile: false },
  }, true)
  assert.equal(modeRejected, true)
  assert.equal(settings.recording.mode, 'host-camera', 'locked mode must keep the active value')
  assert.equal(settings.recording.directory, 'D:/rec2', 'non-mode changes still apply')
}

// --- locked, junk incoming mode counts as host-camera (= current) → not a mutation ---
{
  const { settings, modeRejected } = applyRecordingModeLock(current, {
    recording: { mode: 'garbage', directory: 'D:/rec2' },
  }, true)
  assert.equal(modeRejected, false)
  assert.equal(settings.recording.mode, 'garbage', 'raw value preserved for normalization downstream')
}

// --- normalizeRecordingMode sanity used by the lock ---
assert.equal(normalizeRecordingMode('garbage'), 'host-camera')

// --- wiring: main.js must enforce the lock at the settings-save boundary and broadcast active state ---
const mainSource = readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
const vm = require('node:vm')
const sendStart = mainSource.indexOf('function sendToWindow(')
const sendEnd = mainSource.indexOf('\n}', sendStart) + 2
const forwarded = []
const sendContext = { win: { isDestroyed: () => false, webContents: { send: (...args) => forwarded.push(args) } } }
vm.createContext(sendContext)
vm.runInContext(mainSource.slice(sendStart, sendEnd) + "\nsendToWindow(win, 'desktop-settings-changed', { recording: {} }, { recordingActive: true });", sendContext)
assert.equal(forwarded[0][2]?.recordingActive, true, 'IPC helper must preserve recording state metadata')
assert.ok(mainSource.includes('applyRecordingModeLock'), 'main.js settings-save must use applyRecordingModeLock')
assert.ok(/recordingSessions\.size > 0/.test(mainSource), 'lock must key off active recording sessions')
const sessionStart = mainSource.indexOf("ipcMain.handle('recording-session-start'")
const sessionFinish = mainSource.indexOf("ipcMain.handle('recording-session-finish'")
const sessionCancel = mainSource.indexOf("ipcMain.handle('recording-session-cancel'")
for (const [name, index] of [['start', sessionStart], ['finish', sessionFinish], ['cancel', sessionCancel]]) {
  assert.ok(index >= 0, `recording-session-${name} handler exists`)
  const slice = mainSource.slice(index, index + 1600)
  assert.ok(slice.includes('broadcastDesktopSettings'), `session ${name} must broadcast settings (recordingActive flip)`)
}
const broadcastIndex = mainSource.indexOf('function broadcastDesktopSettings')
assert.ok(mainSource.slice(broadcastIndex, broadcastIndex + 300).includes('recordingActive'),
  'broadcast must carry recordingActive')

// --- wiring: renderer must disable mode radios while active ---
const rendererSource = readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8')
assert.ok(rendererSource.includes('recordingActive'), 'renderer.js must handle recordingActive')

console.log('PASS electron recording lock (main-process boundary + broadcast)')
