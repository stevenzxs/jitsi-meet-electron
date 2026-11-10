const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWindowsVpn, isTrustedVpnSender } = require('../src/windows-vpn');

const profiles = [
  { Name: '测试 VPN', ConnectionStatus: 'Disconnected', AllUserConnection: false },
  { Name: '公司 VPN', ConnectionStatus: 'Connected', AllUserConnection: true },
];
function setup(options = {}) {
  const calls = [];
  const run = options.run || (async (file, args) => {
    calls.push({ file, args });
    return { stdout: JSON.stringify(profiles) };
  });
  return { calls, vpn: createWindowsVpn({ platform: 'win32', windowsDir: 'C:\\Windows',
    appData: 'C:\\User\\AppData', programData: 'C:\\ProgramData', run, ...options }) };
}
test('lists both scopes with distinct stable ids and actual system states', async () => {
  const { vpn } = setup();
  const result = await vpn.list();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'user:测试 VPN');
  assert.equal(result[1].id, 'all:公司 VPN');
  assert.equal(result[1].status, 'connected');
});
test('empty PowerShell output means no configured VPN', async () => {
  assert.deepEqual(await setup({ run: async () => ({ stdout: '' }) }).vpn.list(), []);
});
test('unsupported platform never invokes commands', async () => {
  const { vpn, calls } = setup({ platform: 'linux' });
  await assert.rejects(vpn.list(), /Windows/);
  assert.equal(calls.length, 0);
});
test('rejects unconfigured profile and non-string input before dialing', async () => {
  const { vpn, calls } = setup();
  await assert.rejects(vpn.connect('user:injected'), /不存在/);
  await assert.rejects(vpn.connect({}), /配置/);
  assert.equal(calls.filter(c => /rasphone/.test(c.file)).length, 0);
});
test('native dial receives fixed phonebook and separate name, then rechecks state', async () => {
  const { vpn, calls } = setup();
  const result = await vpn.connect('user:测试 VPN');
  const call = calls.find(c => /rasphone\.exe$/.test(c.file));
  assert.deepEqual(call.args, ['-f', 'C:\\User\\AppData\\Microsoft\\Network\\Connections\\Pbk\\rasphone.pbk', '-d', '测试 VPN']);
  assert.equal(result.status, 'disconnected'); // Native UI cancellation is NOT success.
  assert.equal(calls.filter(c => /powershell/.test(c.file)).length, 2);
});
test('disconnect targets selected all-user phonebook only', async () => {
  const { vpn, calls } = setup();
  await vpn.disconnect('all:公司 VPN');
  const call = calls.find(c => /rasdial\.exe$/.test(c.file));
  assert.deepEqual(call.args, ['公司 VPN', '/disconnect', '/phonebook:C:\\ProgramData\\Microsoft\\Network\\Connections\\Pbk\\rasphone.pbk']);
});
test('exposes error code without leaking native command output', async () => {
  const { vpn } = setup({ run: async (file) => {
    if (/powershell/.test(file)) return { stdout: JSON.stringify(profiles) };
    throw Object.assign(new Error('secret command output'), { code: 691 });
  } });
  await assert.rejects(vpn.connect('user:测试 VPN'), error => /691/.test(error.message) && !/secret/.test(error.message));
});
test('serializes mutations across windows but allows status refresh', async () => {
  let release;
  const { vpn } = setup({ run: async (file) => {
    if (/powershell/.test(file)) return { stdout: JSON.stringify(profiles) };
    await new Promise(resolve => { release = resolve; });
    return { stdout: '' };
  } });
  const first = vpn.connect('user:测试 VPN');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(vpn.disconnect('all:公司 VPN'), /正在/);
  assert.equal((await vpn.list()).length, 2);
  release();
  await first;
});
test('only exact local shell main frame may use VPN IPC', () => {
  const url = 'file:///D:/app/src/index.html';
  const mainFrame = { url: `${url}?mode=meeting` };
  assert.equal(isTrustedVpnSender({ sender: { mainFrame }, senderFrame: mainFrame }, url), true);
  for (const otherUrl of ['https://example.com', 'file:///D:/app/src/other.html', `${url}.evil`]) {
    const frame = { url: otherUrl };
    assert.equal(isTrustedVpnSender({ sender: { mainFrame: frame }, senderFrame: frame }, url), false);
  }
  assert.equal(isTrustedVpnSender({ sender: { mainFrame }, senderFrame: { url } }, url), false);
});
