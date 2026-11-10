const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseProfile, normalizeRoutes, buildConfig } = require('./openvpn-config');
const { createManagement, quoteCredential } = require('./openvpn-management');
const native = require('./openvpn-native');
const { validateTestAddress, requestProbe } = require('./openvpn-probe');

function createOpenVpn({ directory, secure, platform = process.platform,
  protect = native.protect, preflight = native.preflight, launch = native.launch,
  connectTimeout = 90000, stopTimeout = 10000 }) {
  let status = 'disconnected';
  let error = '';
  let active;
  let busy = false;
  let disposed = false;
  let testing = false;
  let cleanup = Promise.resolve();
  const store = path.join(directory, 'profile.bin');
  const settings = path.join(directory, 'settings.json');
  function requireWindows() { if (platform !== 'win32') throw new Error('集成 OpenVPN 仅支持 Windows。'); }
  function encryption() { if (!secure.isEncryptionAvailable()) throw new Error('系统安全加密不可用，不能保存 VPN 证书。'); }
  function mutable() { if (disposed || busy || active || status !== 'disconnected') throw new Error('请先断开 OpenVPN，再修改配置。'); }
  async function prepare() { await fs.mkdir(directory, { recursive: true }); await protect(directory); }
  async function readSettings() {
    try { return JSON.parse(await fs.readFile(settings, 'utf8')); }
    catch (cause) { if (cause.code === 'ENOENT') return { name: '', routes: [] }; throw new Error('VPN 设置损坏，请重新导入配置。'); }
  }
  async function snapshot() {
    requireWindows();
    const saved = await readSettings();
    const component = await preflight();
    return { name: saved.name, routes: saved.routes, testAddress: saved.testAddress || '', auth: Boolean(saved.auth), status, error, available: component.available,
      runtimePath: component.runtimePath || '', version: component.version || '' };
  }
  async function importProfile(name, text) {
    requireWindows(); mutable(); busy = true;
    try {
      encryption();
      if (typeof name !== 'string' || !name.toLowerCase().endsWith('.ovpn') || /[\x00-\x1f]/.test(name)) throw new Error('请选择 .ovpn 配置。');
      const parsed = parseProfile(text);
      await prepare();
      const previous = await readSettings();
      await fs.writeFile(store, secure.encryptString(JSON.stringify(parsed)), { mode: 0o600 });
      await fs.writeFile(settings, JSON.stringify({ ...previous, name: path.basename(name), routes: previous.routes, auth: parsed.auth }), { mode: 0o600 });
      error = '';
      return await snapshot();
    } finally { busy = false; }
  }
  async function saveRoutes(input) {
    requireWindows(); mutable(); busy = true;
    try {
      const routes = normalizeRoutes(input);
      await prepare();
      const previous = await readSettings();
      await fs.writeFile(settings, JSON.stringify({ ...previous, routes }), { mode: 0o600 });
      error = '';
      return await snapshot();
    } finally { busy = false; }
  }
  async function finish(instance) {
    if (active !== instance || instance.finished) return;
    instance.finished = true;
    clearTimeout(instance.timer); clearTimeout(instance.stopTimer);
    instance.management?.destroy();
    instance.child?.stdin?.end();
    cleanup = fs.rm(instance.directory, { recursive: true, force: true }).catch(() => { error = '临时 VPN 配置清理失败，请检查目录权限。'; });
    await cleanup;
    if (active === instance) { active = undefined; status = 'disconnected'; }
  }
  function fail(instance, message) {
    if (active !== instance || instance.finished) return;
    error = message;
    status = 'disconnecting';
    instance.management?.disconnect();
    instance.management?.destroy(); // management-client exits when its controller disconnects.
    if (!instance.stopTimer) instance.stopTimer = setTimeout(() => {
      error = 'OpenVPN 未确认退出，请检查系统服务；不能开始新连接。';
      // Do not delete credentials/config or claim disconnected while a process may still use it.
    }, stopTimeout);
    instance.stopTimer?.unref?.();
  }
  async function connect(credentials = {}) {
    requireWindows(); mutable(); busy = true;
    let instance;
    try {
      encryption();
      const username = credentials?.username || '';
      const password = credentials?.password || '';
      quoteCredential(username); quoteCredential(password);
      const saved = await readSettings();
      const routes = normalizeRoutes((saved.routes || []).join('\n'));
      if (!(await preflight()).available) throw new Error('OpenVPN 组件或交互服务未就绪，请使用集成安装包安装或修复。');
      const parsed = JSON.parse(secure.decryptString(await fs.readFile(store)));
      // Revalidate decrypted data rather than trusting persisted config.
      const profile = parseProfile(parsed.config + (parsed.auth ? '\nauth-user-pass\n' : ''));
      if (profile.auth && (!username || !password)) throw new Error('请输入 VPN 用户名和密码。');
      await prepare();
      if (disposed) throw new Error('OpenVPN 已停止。');
      const runtime = await fs.mkdtemp(path.join(directory, 'run-'));
      instance = { directory: runtime, finished: false };
      active = instance; status = 'connecting'; error = '';
      await protect(runtime);
      const config = path.join(runtime, 'client.ovpn');
      await fs.writeFile(config, buildConfig(profile, routes), { mode: 0o600 });
      const secret = randomBytes(32).toString('hex');
      const { socket, child } = await launch({ directory: runtime, config, secret, auth: profile.auth });
      instance.child = child;
      child.once('exit', code => {
        if (status !== 'disconnecting' && !error) error = code ? 'OpenVPN 异常退出，请检查配置或服务。' : 'OpenVPN 连接已结束。';
        void finish(instance);
      });
      child.once('error', () => fail(instance, 'OpenVPN 服务桥异常。'));
      instance.management = createManagement(socket, { secret, credentials: { username, password },
        onState(value) { if (active === instance && status !== 'disconnecting') { status = value; if (value === 'connected') clearTimeout(instance.timer); } },
        onError(message) { fail(instance, message); } });
      socket.once('close', () => { if (!instance.finished && status !== 'disconnecting') fail(instance, 'OpenVPN 控制连接中断。'); });
      instance.timer = setTimeout(() => fail(instance, 'OpenVPN 连接超时，请检查网络、服务器与认证信息。'), connectTimeout);
      instance.timer.unref?.();
      if (disposed) { status = 'disconnecting'; instance.management.destroy(); child.stdin?.end(); }
      socket.resume?.();
      return await snapshot();
    } catch (cause) {
      if (instance && !instance.child) await finish(instance);
      if (instance?.child) fail(instance, 'OpenVPN 启动失败。');
      if (/至少|认证|用户名|OpenVPN|加密/.test(cause.message)) throw cause;
      throw new Error('OpenVPN 启动失败，请重新导入配置并检查服务。');
    } finally { busy = false; }
  }
  async function disconnect() {
    requireWindows();
    if (busy) throw new Error('正在启动 OpenVPN，请等待后重试。');
    if (active) {
      status = 'disconnecting'; active.management?.disconnect();
      const instance = active;
      instance.stopTimer = setTimeout(() => {
        if (active === instance) { instance.management?.destroy(); instance.child?.stdin?.end(); }
      }, stopTimeout);
      instance.stopTimer.unref?.();
    }
    return snapshot();
  }
  async function waitForIdle() { await cleanup; }
  async function saveTestAddress(input) {
    requireWindows(); mutable(); busy = true;
    try {
      const previous = await readSettings();
      const testAddress = input === '' ? '' : validateTestAddress(input, previous.routes);
      await prepare();
      await fs.writeFile(settings, JSON.stringify({ ...previous, testAddress }), { mode: 0o600 });
      return await snapshot();
    } finally { busy = false; }
  }
  async function testConnection() {
    requireWindows();
    if (disposed || status !== 'connected' || !active) throw new Error('请先连接 VPN。');
    if (testing) throw new Error('正在测试，请稍候。');
    testing = true;
    const instance = active;
    try {
      const saved = await readSettings();
      const address = validateTestAddress(saved.testAddress, saved.routes);
      if (status !== 'connected' || active !== instance) throw new Error('VPN 连接已变化，请重新测试。');
      const result = await requestProbe(address);
      if (status !== 'connected' || active !== instance) throw new Error('VPN 连接已变化，请重新测试。');
      return result;
    } finally { testing = false; }
  }
  function dispose() {
    disposed = true;
    if (active) { status = 'disconnecting'; active.management?.disconnect(); active.management?.destroy(); active.child?.stdin?.end(); }
  }
  return { snapshot, importProfile, saveRoutes, saveTestAddress, testConnection, connect, disconnect, waitForIdle, dispose };
}
module.exports = { createOpenVpn };
