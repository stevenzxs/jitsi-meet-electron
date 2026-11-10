// Bundled startup UI: never depends on the remote server or its error-page load event.
window.createOfflineEntry = ({ frame, openSettings, reload }) => {
  const panel = document.getElementById('offlineEntry');
  const message = document.getElementById('offlineMessage');
  const spinner = document.getElementById('offlineSpinner');
  const failure = document.getElementById('offlineFailure');
  let origin = '';
  let ready = false;
  let timer;
  let vpnState;
  document.getElementById('offlineVpn').addEventListener('click', () => openSettings('vpn'));
  document.getElementById('offlineRetry').addEventListener('click', reload);
  document.addEventListener('openvpn-state', event => {
    const previous = vpnState;
    vpnState = event.detail;
    if (vpnState === 'connected' && previous !== 'connected' && !ready && origin) reload();
  });
  return {
    start(url) {
      origin = new URL(url).origin;
      ready = false;
      panel.hidden = false;
      spinner.hidden = false;
      failure.hidden = true;
      message.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!ready) {
          spinner.hidden = true;
          failure.hidden = false;
          message.textContent = '会议服务暂不可达，请检查网络后重试；内网环境可先连接 VPN。';
        }
      }, 10000);
    },
    message(event) {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      if (!['cloudmeet-user-get', 'cloudmeet-server-get', 'cloudmeet-desktop-settings-get'].includes(event.data?.type)) return;
      ready = true;
      clearTimeout(timer);
      panel.hidden = true;
    },
  };
};
