const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8');
function mount({ vpnSave = async () => {}, userSave = async name => ({ name, userId: 'same-id' }) } = {}) {
  const nodes = Object.fromEntries(['preferencesUserResult', 'preferencesName', 'preferencesUserId'].map(id =>
    [id, { value: 'Alice', textContent: '', focus() {} }]));
  const events = [];
  const context = vm.createContext({ settingsModal: { hidden: false }, currentUser: { name: 'Alice', userId: 'same-id' },
    document: { getElementById: id => nodes[id], dispatchEvent: event => events.push(event) },
    window: { cloudmeetVpnPanel: { savePending: vpnSave }, cloudmeet: { saveUser: userSave } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setSettingsTab: tab => events.push(tab), setSettingsError: error => events.push(error), sendUserToFrame: () => events.push('user-sync') });
  vm.runInContext(source.slice(source.indexOf('let closingSettings = false;'), source.indexOf('function saveDesktopSettings()')), context);
  return { nodes, events, context, close: () => context.closeSettings() };
}
test('manual save buttons removed; close handlers share async autosave', () => {
  const html = fs.readFileSync(require.resolve('../src/index.html'), 'utf8');
  assert.doesNotMatch(html, /id="(?:preferencesSaveUser|ovpnSave|ovpnSaveTest)"/);
  assert.match(source, /closeSettingsBtn.addEventListener\('click', closeSettings\)/);
});
test('close saves username and VPN edits before hiding; repeated close is guarded', async () => {
  let release;
  let saves = 0;
  const app = mount({ vpnSave: () => new Promise(resolve => { release = resolve; }), userSave: async name => { saves++; return { name, userId: 'same-id' }; } });
  app.nodes.preferencesName.value = 'Bob';
  const closing = app.close(); await app.close();
  assert.equal(app.context.settingsModal.hidden, false);
  release(); await closing;
  assert.equal(saves, 1);
  assert.equal(app.context.currentUser.userId, 'same-id');
  assert.equal(app.context.settingsModal.hidden, true);
});
test('invalid names and persistence failures keep settings open', async () => {
  const invalid = mount(); invalid.nodes.preferencesName.value = ' ';
  await invalid.close(); assert.equal(invalid.context.settingsModal.hidden, false);
  assert.ok(invalid.events.includes('profile'));
  const vpn = mount({ vpnSave: async () => { throw new Error('invalid route'); } });
  await vpn.close(); assert.equal(vpn.context.settingsModal.hidden, false);
  assert.ok(vpn.events.includes('vpn')); assert.ok(vpn.events.includes('invalid route'));
  const user = mount({ userSave: async () => { throw new Error('disk full'); } });
  user.nodes.preferencesName.value = 'Bob'; await user.close();
  assert.equal(user.context.settingsModal.hidden, false);
  assert.match(user.nodes.preferencesUserResult.textContent, /失败/);
});
test('unchanged empty initial name does not block close or create an identity', async () => {
  const app = mount({ userSave: async () => { throw new Error('must not save'); } });
  app.context.currentUser = null; app.nodes.preferencesName.value = '';
  await app.close(); assert.equal(app.context.settingsModal.hidden, true);
});
