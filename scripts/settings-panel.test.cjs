const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
const renderer = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8');

test('settings expose only profile, recording, video and VPN panels', () => {
  const expected = ['profile', 'recording', 'video', 'vpn'];
  for (const attribute of ['data-settings-tab', 'data-settings-panel']) {
    assert.deepEqual([...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map(match => match[1]), expected);
  }
  assert.doesNotMatch(html, /preferencesServer/);
});

test('settings open without a server address element', () => {
  const nodes = new Map(['preferencesName', 'preferencesUserId', 'preferencesUserResult'].map(id => [id, {}]));
  const modal = { hidden: true };
  const context = {
    document: { getElementById: id => nodes.get(id) },
    settingsModal: modal,
    currentUser: { name: '测试用户', userId: 'user-1' },
    currentServerUrl: 'https://example.test/cm/desktop',
    setSettingsTab() {}, setSettingsError() {},
    recordingDirectoryText: null,
    loadDesktopSettings: () => Promise.resolve(),
  };
  const openSettings = renderer.match(/function openSettings\(tab = 'profile'\) \{[\s\S]*?\n\}/)[0];
  vm.runInNewContext(`${openSettings}\nopenSettings();`, context);
  assert.equal(modal.hidden, false);
  assert.equal(nodes.get('preferencesName').value, '测试用户');
  assert.doesNotMatch(openSettings, /preferencesServer/);
});

test('removed server tab uses the existing recording fallback', () => {
  const titles = renderer.match(/const SETTINGS_TAB_TITLES = \{[\s\S]*?\n\};/)[0];
  const setTab = renderer.match(/function setSettingsTab\([^)]*\) \{[\s\S]*?\n\}/)[0];
  const title = {};
  vm.runInNewContext(`${titles}\n${setTab}\nsetSettingsTab('server');`, {
    settingsMenuButtons: [], settingsPanels: [], settingsPanelTitle: title,
    document: { dispatchEvent() {} }, CustomEvent: function () {},
  });
  assert.equal(title.textContent, '录制');
});
