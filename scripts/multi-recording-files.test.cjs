const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('each output creates a distinct named video and optional audio session', () => {
  const source = fs.readFileSync(require.resolve('../src/main.js'), 'utf8');
  const code = source.slice(source.indexOf("ipcMain.handle('recording-session-start'"), source.indexOf("ipcMain.handle('recording-session-write'"));
  let start, id = 0;
  const sessions = new Map();
  vm.runInNewContext(code, {
    ipcMain: { handle: (_name, fn) => { start = fn; } },
    readStoredSettings: () => ({ recording: { directory: 'recordings' } }),
    fs: { mkdirSync() {}, createWriteStream: name => ({ name }) },
    crypto: { randomUUID: () => String(++id) },
    formatRecordingTimestamp: () => '20261027-120000',
    sanitizeFileNamePart: value => value,
    uniqueRecordingPath: (directory, name) => `${directory}/${name}`,
    recordingSessions: sessions, broadcastDesktopSettings() {},
  });
  const modes = ['host-camera', 'shared-screen', 'composite'];
  const results = modes.map(mode => start(null, { mode, subject: '会议', recordAudioFile: true }));
  assert.equal(sessions.size, 3);
  assert.equal(new Set(results.map(result => result.videoFilePath)).size, 3);
  results.forEach((result, index) => {
    assert.match(result.videoFilePath, new RegExp(['主持人', '共享屏幕', '合成'][index]));
    assert.match(result.audioFilePath, /audio\.webm$/);
  });
});
