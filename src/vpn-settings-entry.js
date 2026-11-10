(() => {
  function handleVpnSettingsRequest(event, frame, serverUrl, openSettings) {
    const preferences = event.data?.type === 'cloudmeet-preferences-open';
    if (!preferences && event.data?.type !== 'cloudmeet-vpn-settings-open') return false;
    let origin;
    try { origin = new URL(serverUrl).origin; } catch { return true; }
    if (origin === 'null' || event.source !== frame.contentWindow || event.origin !== origin) return true;
    const requestId = event.data.requestId;
    if (typeof requestId !== 'string' || requestId.length > 200) return true;
    openSettings(preferences ? 'profile' : 'vpn');
    event.source.postMessage({ type: preferences ? 'cloudmeet-preferences-opened' : 'cloudmeet-vpn-settings-opened', requestId }, origin);
    return true;
  }
  if (typeof module !== 'undefined') module.exports = { handleVpnSettingsRequest };
  else window.VpnSettingsEntry = { handleVpnSettingsRequest };
})();
