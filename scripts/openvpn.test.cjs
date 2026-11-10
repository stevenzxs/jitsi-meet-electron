const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createOpenVpn } = require('../src/openvpn');
const profile = 'client\ndev tun\nremote vpn.example.org 1194\nremote-cert-tls server\n<ca>\ncertificate\n</ca>\nauth-user-pass\n';
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudmeet-ovpn-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const launched = [];
  const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')),
    decryptString: buffer => buffer.toString().split('').reverse().join('') };
  const manager = createOpenVpn({ directory, secure, platform: 'win32', protect: async () => {},
    preflight: async () => ({ available: true }),
    launch: async options => {
      const child = new EventEmitter();
      const socket = new EventEmitter();
      socket.write = value => socket.writes.push(value); socket.writes = [];
      socket.destroy = () => { socket.destroyed = true; child.emit('exit', 0); };
      launched.push({ options, child, socket });
      return { socket, child };
    }, ...overrides });
  return { manager, directory, launched };
}
test('imports encrypted profile, stores canonical routes and never returns profile secrets', async t => {
  const { manager, directory } = await fixture(t);
  await manager.importProfile('company.ovpn', profile);
  const saved = await manager.saveRoutes('10.0.0.4\n10.2.3.4/16');
  assert.deepEqual(saved.routes, ['10.0.0.4/32', '10.2.0.0/16']);
  assert.equal(saved.name, 'company.ovpn');
  assert.doesNotMatch(JSON.stringify(saved), /certificate/);
  assert.doesNotMatch(await fs.readFile(path.join(directory, 'profile.bin'), 'utf8'), /certificate|remote-cert/);
});
test('test address persists across profile import and testing fails closed before connection', async t => {
  const { manager } = await fixture(t);
  await manager.saveRoutes('10.8.0.1');
  await manager.saveTestAddress('http://10.8.0.1/vpn-probe');
  await manager.importProfile('company.ovpn', profile);
  assert.equal((await manager.snapshot()).testAddress, 'http://10.8.0.1/vpn-probe');
  await assert.rejects(manager.saveTestAddress('http://10.8.0.2'), /分流/);
  await assert.rejects(manager.testConnection(), /先连接/);
  await manager.saveTestAddress('');
  assert.equal((await manager.snapshot()).testAddress, '');
});
test('connection authenticates and cannot mutate routes while active; disconnect removes runtime', async t => {
  const { manager, launched } = await fixture(t);
  await manager.importProfile('company.ovpn', profile);
  await manager.saveRoutes('10.0.0.4');
  assert.equal((await manager.connect({ username: 'user', password: 'secret' })).status, 'connecting');
  const { child, socket, options } = launched[0];
  assert.equal(Object.values(options).includes('secret'), false);
  assert.match(await fs.readFile(options.config, 'utf8'), /route 10\.0\.0\.4/);
  await assert.rejects(manager.saveRoutes('10.0.0.5'), /断开/);
  socket.emit('data', Buffer.from('ENTER PASSWORD:\nSUCCESS: password is correct\n>STATE:1,CONNECTED,SUCCESS\n'));
  assert.equal((await manager.snapshot()).status, 'connected');
  await manager.disconnect();
  assert.equal((await manager.snapshot()).status, 'disconnecting');
  child.emit('exit', 0);
  await new Promise(resolve => setImmediate(resolve));
  await manager.waitForIdle();
  assert.equal((await manager.snapshot()).status, 'disconnected');
  await assert.rejects(fs.stat(options.config), /ENOENT/);
});
test('missing service and unavailable encryption fail closed', async t => {
  const { manager } = await fixture(t, { preflight: async () => ({ available: false }) });
  await manager.importProfile('company.ovpn', profile);
  await manager.saveRoutes('10.0.0.4');
  await assert.rejects(manager.connect({}), /OpenVPN/);
  const other = await fixture(t, { secure: { isEncryptionAvailable: () => false } });
  await assert.rejects(other.manager.importProfile('company.ovpn', profile), /加密/);
});
test('rejects credential injection before creating runtime files or launching', async t => {
  const { manager, launched } = await fixture(t);
  await manager.importProfile('company.ovpn', profile);
  await manager.saveRoutes('10.0.0.4');
  await assert.rejects(manager.connect({ username: 'u\nsignal SIGTERM', password: 'p' }), /认证/);
  assert.equal(launched.length, 0);
});
test('profile with no routes never starts and launch failure cleans runtime', async t => {
  const { manager, directory } = await fixture(t, { launch: async () => { throw new Error('native bridge failed'); } });
  await manager.importProfile('company.ovpn', profile);
  await assert.rejects(manager.connect({ username: 'u', password: 'p' }), /至少/);
  await manager.saveRoutes('10.0.0.4');
  await assert.rejects(manager.connect({ username: 'u', password: 'p' }), /启动/);
  assert.equal((await manager.snapshot()).status, 'disconnected');
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith('run-')), false);
});
test('connection timeout closes only its management connection and waits for process exit', async t => {
  const { manager, launched } = await fixture(t, { connectTimeout: 5 });
  await manager.importProfile('company.ovpn', profile);
  await manager.saveRoutes('10.0.0.4');
  await manager.connect({ username: 'u', password: 'p' });
  await new Promise(resolve => setTimeout(resolve, 30));
  await manager.waitForIdle();
  assert.equal(launched[0].socket.destroyed, true);
  assert.match((await manager.snapshot()).error, /超时/);
  assert.equal((await manager.snapshot()).status, 'disconnected');
});
test('shutdown during launch never leaves an active connection', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const socket = new EventEmitter(); socket.write = () => {}; socket.destroy = () => { socket.destroyed = true; }; socket.resume = () => {};
  const child = new EventEmitter(); child.stdin = { end() {} };
  const { manager } = await fixture(t, { launch: async () => { await gate; return { socket, child }; } });
  await manager.importProfile('company.ovpn', profile);
  await manager.saveRoutes('10.0.0.4');
  const connecting = manager.connect({ username: 'u', password: 'p' });
  await new Promise(resolve => setTimeout(resolve, 20));
  manager.dispose(); release();
  await connecting;
  assert.equal(socket.destroyed, true);
  child.emit('exit', 0); await manager.waitForIdle();
});
