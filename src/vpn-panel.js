(() => {
  const element = id => document.getElementById(id);
  const select = element('vpnProfile');
  const status = element('vpnStatus');
  const error = element('vpnError');
  const connect = element('vpnConnect');
  const disconnect = element('vpnDisconnect');
  const refresh = element('vpnRefresh');
  const settings = element('vpnSettings');
  const labels = { connected: '已连接', disconnected: '未连接', connecting: '连接中',
    disconnecting: '断开中', unknown: '状态未知' };
  let profiles = [];
  let busy = false;
  let querying = false;
  let timer;
  let valid = false;

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }
  function render() {
    const profile = profiles.find(item => item.id === select.value);
    select.disabled = busy || querying;
    refresh.disabled = busy || querying;
    settings.disabled = busy;
    connect.disabled = busy || querying || !valid || !profile || profile.status !== 'disconnected';
    disconnect.disabled = busy || querying || !valid || !profile || profile.status !== 'connected';
    if (busy) return;
    status.textContent = !valid ? '状态未知' : profile
      ? labels[profile.status] || labels.unknown
      : '没有系统 VPN 配置，请先打开 Windows VPN 设置添加连接。';
  }
  async function load({ clearError = true } = {}) {
    if (querying) return;
    querying = true;
    if (clearError) showError();
    render();
    try {
      const selected = select.value;
      profiles = await window.cloudmeet.listVpn();
      const options = profiles.map(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name}（${profile.scope === 'all' ? '所有用户' : '当前用户'}）`;
        return option;
      });
      select.replaceChildren(...options);
      if (profiles.some(item => item.id === selected)) select.value = selected;
      valid = true;
    } catch (cause) {
      valid = false;
      showError(cause.message || '读取 VPN 状态失败');
    } finally {
      querying = false;
      render();
    }
  }
  async function change(action) {
    if (busy || !valid || !select.value) return;
    if (timer) clearInterval(timer);
    busy = true;
    showError();
    status.textContent = action === 'connect' ? '连接中，请在 Windows 拨号窗口完成认证…' : '正在断开…';
    render();
    try {
      const result = await window.cloudmeet[action === 'connect' ? 'connectVpn' : 'disconnectVpn'](select.value);
      if (action === 'connect' && result.status !== 'connected') {
        showError('VPN 尚未建立连接。可能已取消拨号，请检查系统拨号窗口或刷新状态。');
      } else if (action === 'disconnect' && result.status !== 'disconnected') {
        showError('系统尚未确认断开，请刷新状态。');
      }
    } catch (cause) {
      showError(cause.message || 'VPN 操作失败');
    } finally {
      busy = false;
      await load({ clearError: false });
      if (visible) startPolling();
    }
  }
  let visible = false;
  function startPolling() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (!busy) void load({ clearError: false }); }, 5000);
  }
  select.addEventListener('change', render);
  refresh.addEventListener('click', () => load());
  connect.addEventListener('click', () => change('connect'));
  disconnect.addEventListener('click', () => change('disconnect'));
  settings.addEventListener('click', async () => {
    try { await window.cloudmeet.openVpnSettings(); }
    catch (cause) { showError(cause.message || '无法打开 Windows VPN 设置'); }
  });
  document.addEventListener('vpn-panel-visibility', async (event) => {
    visible = Boolean(event.detail);
    if (timer) clearInterval(timer);
    if (visible) {
      await load();
      if (visible) startPolling();
    }
  });
})();
