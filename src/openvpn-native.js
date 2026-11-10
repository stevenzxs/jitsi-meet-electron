const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
async function ps(script, args = []) {
  return run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'), ...args],
  { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
}
async function protect(directory) {
  // Base64 avoids treating a path as executable PowerShell text.
  const encoded = Buffer.from(directory, 'utf8').toString('base64');
  await ps(`$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
([IO.DirectoryInfo]::new($p)).SetAccessControl($acl)`);
}
async function preflight() {
  if (process.platform !== 'win32') return { available: false };
  try {
    const { stdout } = await ps(`$ErrorActionPreference='Stop'
$p=(Get-ItemProperty -LiteralPath 'HKLM:\\Software\\OpenVPN-CloudMeet' -Name exe_path).exe_path
$s=Get-Service -Name CloudMeetVPN -ErrorAction Stop
$version=if(Test-Path -LiteralPath $p){(Get-Item -LiteralPath $p).VersionInfo.ProductVersion}else{''}
@{available=($s.Status -eq 'Running' -and (Test-Path -LiteralPath $p));runtimePath=$p;version=$version}|ConvertTo-Json -Compress`);
    return JSON.parse(stdout.trim());
  } catch { return { available: false }; }
}
async function launch({ directory, config, secret, auth }) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const bridge = await fs.readFile(path.join(__dirname, 'openvpn-service.ps1'), 'utf8');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(bridge, 'utf16le').toString('base64')],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let socket;
  let pid;
  let output = '';
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('OpenVPN 服务启动超时。')), 20000);
    async function ready() {
      if (!socket || !pid || settled) return;
      try {
        // Do not hand credentials to a different local process impersonating OpenVPN.
        const { stdout } = await ps(`$ErrorActionPreference='Stop'
$c=Get-NetTCPConnection -State Established -LocalPort ${Number(socket.remotePort)} -RemotePort ${port} -ErrorAction Stop
if(@($c | Where-Object OwningProcess -eq ${pid}).Count -eq 0){exit 3}
Write-Output 'verified'`);
        if (stdout.trim() !== 'verified') throw new Error('identity');
        if (!settled) { settled = true; clearTimeout(timer); server.close(); resolve({ child, socket }); }
      } catch { finish(new Error('无法验证 OpenVPN 控制连接身份。')); }
    }
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); server.close(); socket?.destroy(); child.stdin.end(); reject(error);
    }
    server.on('connection', incoming => {
      if (socket || settled) { incoming.destroy(); return; }
      socket = incoming; socket.pause(); void ready();
    });
    server.on('error', () => finish(new Error('无法建立本地 VPN 控制接口。')));
    child.stdout.on('data', data => {
      output += data.toString();
      if (output.length > 4096) { finish(new Error('OpenVPN 服务响应异常。')); return; }
      const match = /READY:(\d+)/.exec(output);
      if (match) { pid = Number(match[1]); void ready(); }
    });
    child.on('error', () => finish(new Error('无法启动 OpenVPN 服务桥。')));
    child.on('exit', () => finish(new Error('OpenVPN 服务拒绝启动，请检查组件和用户权限。')));
    child.stdin.on('error', () => finish(new Error('OpenVPN 服务通信失败。')));
    child.stdin.write(JSON.stringify({ directory, config, port, secret, auth }) + '\n');
  });
}
module.exports = { protect, preflight, launch };
