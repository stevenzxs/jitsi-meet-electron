const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const schema = require('../src/recording-settings');

test('multi-output selection survives normalization with canonical order and no duplicates', () => {
  const settings = schema.normalizeDesktopSettings({ recording: { modes: ['composite', 'shared-screen', 'host-camera', 'composite', 'junk'] } });
  assert.deepEqual(settings.recording.modes, ['host-camera', 'shared-screen', 'composite']);
});
test('legacy single choice migrates while explicit empty selection is not silently replaced', () => {
  assert.deepEqual(schema.normalizeDesktopSettings({ recording: { mode: 'shared-screen' } }).recording.modes, ['shared-screen']);
  assert.deepEqual(schema.normalizeDesktopSettings({ recording: { modes: [] } }).recording.modes, []);
});
test('recording locks the full selection, not just the first mode', () => {
  const current = { recording: { modes: ['host-camera', 'shared-screen'] } };
  const incoming = { recording: { modes: ['host-camera', 'composite'] } };
  const result = schema.applyRecordingModeLock(current, incoming, true);
  assert.equal(result.modeRejected, true);
  assert.deepEqual(result.settings.recording.modes, current.recording.modes);
  assert.equal(schema.applyRecordingModeLock(current, { recording: { modes: ['shared-screen', 'host-camera'] } }, true).modeRejected, false);
});
test('local settings use three checkboxes rather than radio buttons', () => {
  const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
  assert.equal((html.match(/type="checkbox" name="recordingMode"/g) || []).length, 3);
  assert.doesNotMatch(html, /role="radiogroup"/);
});
