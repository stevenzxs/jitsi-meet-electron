(() => {
  const el = id => document.getElementById(id);
  const ids = ['Name', 'Routes', 'Username', 'Password', 'Import', 'Connect', 'Disconnect', 'Refresh', 'Status', 'Error', 'TestAddress', 'Test', 'TestResult'];
  const ui = Object.fromEntries(ids.map(id => [id, el(`ovpn${id}`)]));
  const labels = { disconnected: '未连接', connecting: '连接中…', connected: '已连接', disconnecting: '正在断开…' };
  let state;
  let busy = false;
  let dirty = false;
  let visible = false;
  let timer;
  let testDirty = false;
  let testing = false;
  let testGeneration = 0;
  function clearTest() { testGeneration++; ui.TestResult.textContent = ''; }
  function error(message = '') { ui.Error.textContent = message; ui.Error.hidden = !message; }
  function render() {
    const locked = busy || !state || state.status !== 'disconnected';
    ui.Import.disabled = locked;
    ui.Routes.disabled = locked;
    ui.Username.disabled = locked;
    ui.Password.disabled = locked;
    ui.Connect.disabled = locked || !state?.available || !state?.name || !(dirty ? ui.Routes.value.trim() : state?.routes?.length);
    ui.Disconnect.disabled = busy || !state || !['connected', 'connecting'].includes(state.status);
    ui.Refresh.disabled = busy;
    ui.TestAddress.disabled = locked;
    ui.Test.disabled = busy || testing || testDirty || !state?.testAddress || state?.status !== 'connected';
    ui.Test.textContent = testing ? '测试中…' : '测试 VPN';
    ui.Status.textContent = state ? labels[state.status] || '状态未知' : '状态未知';
    ui.Status.dataset.state = state?.status || 'unknown';
    ui.Name.textContent = state?.name || '尚未导入配置';
    const credentials = el('ovpnCredentials');
    if (credentials) credentials.hidden = !state?.auth;
  }
  function apply(next, replaceRoutes = false) {
    if (next.status !== state?.status) document.dispatchEvent(new CustomEvent('openvpn-state', { detail: next.status }));
    if (next.status !== state?.status || next.testAddress !== state?.testAddress || replaceRoutes) clearTest();
    state = next;
    if (!testDirty) ui.TestAddress.value = next.testAddress || '';
    if (replaceRoutes || !dirty) ui.Routes.value = (next.routes || []).join('\n');
    if (replaceRoutes) dirty = false;
    error(next.error || (!next.available ? 'VPN 组件未就绪，请安装或修复客户端。' : ''));
  }
  async function load() {
    if (busy) return;
    busy = true; render();
    try { apply(await window.cloudmeet.openVpnStatus()); }
    catch (cause) { state = undefined; clearTest(); error(cause.message || '读取 OpenVPN 状态失败'); }
    finally { busy = false; render(); }
  }
  async function act(action) {
    if (busy) return;
    busy = true; error(); render();
    try {
      let next;
      if (action === 'import') next = await window.cloudmeet.openVpnImport();
      if (action === 'connect') {
        await flushEdits();
        next = await window.cloudmeet.openVpnConnect({ username: ui.Username.value, password: ui.Password.value });
      }
      if (action === 'disconnect') next = await window.cloudmeet.openVpnDisconnect();
      if (next) apply(next, action === 'import');
    } catch (cause) { error(cause.message || 'OpenVPN 操作失败'); }
    finally { if (action === 'connect') ui.Password.value = ''; busy = false; render(); }
  }
  async function flushEdits() {
    if (dirty) {
      const next = await window.cloudmeet.openVpnSaveRoutes(ui.Routes.value);
      apply(next, true);
    }
    if (testDirty) {
      const next = await window.cloudmeet.openVpnSaveTestAddress(ui.TestAddress.value);
      testDirty = false;
      apply(next);
    }
  }
  window.cloudmeetVpnPanel = { async savePending() {
    if (!dirty && !testDirty) return;
    if (busy) throw new Error('VPN 正在处理，请稍候再关闭设置。');
    busy = true; render();
    try { await flushEdits(); }
    catch (cause) { error(cause.message || '保存 VPN 设置失败'); throw cause; }
    finally { busy = false; render(); }
  } };
  ui.Routes.addEventListener('input', () => { dirty = true; render(); });
  ui.TestAddress.addEventListener('input', () => { testDirty = true; clearTest(); render(); });
  ui.Test.addEventListener('click', async () => {
    if (ui.Test.disabled) return;
    testing = true; clearTest(); const generation = testGeneration; render();
    try {
      await flushEdits();
      const result = await window.cloudmeet.openVpnTest();
      if (generation === testGeneration) ui.TestResult.textContent = result.ok
        ? `测试通过 · ${result.elapsedMs} ms`
        : `测试失败${result.statusCode ? ` · HTTP ${result.statusCode}` : ` · ${result.message || '无法访问'}`}`;
    } catch (cause) { if (generation === testGeneration) ui.TestResult.textContent = `测试失败 · ${cause.message || '无法访问'}`; }
    finally { testing = false; render(); }
  });
  for (const [id, action] of [['Import', 'import'], ['Connect', 'connect'], ['Disconnect', 'disconnect']]) {
    ui[id].addEventListener('click', () => act(action));
  }
  ui.Refresh.addEventListener('click', load);
  document.addEventListener('vpn-panel-visibility', async event => {
    visible = Boolean(event.detail);
    if (timer) clearInterval(timer);
    if (!visible) { ui.Password.value = ''; clearTest(); return; }
    await load();
    if (visible) timer = setInterval(() => { if (!busy) void load(); }, 5000);
  });
  render();
})();
