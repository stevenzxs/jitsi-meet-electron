const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function isTrustedVpnSender(event, shellUrl) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    url.search = '';
    url.hash = '';
    return url.href === shellUrl;
  } catch {
    return false;
  }
}

function createWindowsVpn({
  platform = process.platform,
  windowsDir = process.env.SystemRoot || 'C:\\Windows',
  appData = process.env.APPDATA,
  programData = process.env.ProgramData,
  run = execFileAsync,
} = {}) {
  let busy = false;
  const systemFile = name => path.win32.join(windowsDir, 'System32', name);
  function requireWindows() {
    if (platform !== 'win32') throw new Error('VPN 拨号仅支持 Windows。');
  }
  async function list() {
    requireWindows();
    let stdout;
    try {
      ({ stdout } = await run(systemFile('WindowsPowerShell\\v1.0\\powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-EncodedCommand', Buffer.from(fs.readFileSync(path.join(__dirname, 'windows-vpn-list.ps1'), 'utf8'), 'utf16le').toString('base64')],
        { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }));
    } catch {
      throw new Error('无法读取 Windows VPN 配置，请检查系统 VPN 服务及 PowerShell 权限。');
    }
    let profiles;
    try {
      profiles = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim() || '[]');
      if (!Array.isArray(profiles)) profiles = [profiles];
      return profiles.filter(p => p && typeof p.Name === 'string' && p.Name && !/[\x00-\x1f]/.test(p.Name))
        .map(p => ({
          id: `${p.AllUserConnection ? 'all' : 'user'}:${p.Name}`,
          name: p.Name,
          scope: p.AllUserConnection ? 'all' : 'user',
          status: ({ Connected: 'connected', Disconnected: 'disconnected', Connecting: 'connecting',
            Disconnecting: 'disconnecting' })[p.ConnectionStatus] || 'unknown',
        }));
    } catch {
      throw new Error('Windows VPN 状态数据无法解析，请刷新重试。');
    }
  }
  async function change(id, action) {
    requireWindows();
    if (typeof id !== 'string' || !id || id.length > 300 || /[\x00-\x1f]/.test(id)) {
      throw new Error('请选择有效的 VPN 配置。');
    }
    if (busy) throw new Error('正在处理 VPN 操作，请等待完成。');
    busy = true;
    try {
      const profile = (await list()).find(item => item.id === id);
      if (!profile) throw new Error('VPN 配置不存在，请刷新列表。');
      const root = profile.scope === 'all' ? programData : appData;
      if (!root) throw new Error('无法定位 Windows VPN 配置目录。');
      const phonebook = path.win32.join(root, 'Microsoft', 'Network', 'Connections', 'Pbk', 'rasphone.pbk');
      const args = action === 'connect'
        ? ['-f', phonebook, '-d', profile.name]
        : [profile.name, '/disconnect', `/phonebook:${phonebook}`];
      try {
        await run(systemFile(action === 'connect' ? 'rasphone.exe' : 'rasdial.exe'), args,
          { windowsHide: action !== 'connect', encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (error.killed) throw new Error('VPN 操作等待超时，请检查系统拨号窗口并刷新状态。');
        const code = Number.isInteger(error.code) ? `（系统错误 ${error.code}）` : '';
        throw new Error(`VPN ${action === 'connect' ? '连接未完成' : '断开失败'}${code}，请检查 Windows VPN 设置。`);
      }
      // Closing/cancelling the native dialog is not proof that a tunnel was established.
      return (await list()).find(item => item.id === id) || { ...profile, status: 'unknown' };
    } finally {
      busy = false;
    }
  }
  return { list, connect: id => change(id, 'connect'), disconnect: id => change(id, 'disconnect') };
}

module.exports = { createWindowsVpn, isTrustedVpnSender };
