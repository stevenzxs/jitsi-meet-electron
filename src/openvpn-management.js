function quoteCredential(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('认证信息包含无效字符或过长。');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function createManagement(socket, { secret, credentials, onState, onError }) {
  let buffer = '';
  let authenticated = false;
  let passwordSent = false;
  let failed = false;
  function fail(message) {
    if (failed) return;
    failed = true;
    onError(message);
    socket.destroy();
  }
  socket.on('data', data => {
    if (failed) return;
    buffer += data.toString('utf8');
    if (buffer.length > 65536) { fail('OpenVPN 控制响应过长。'); return; }
    if (!passwordSent && buffer.includes('ENTER PASSWORD:')) {
      passwordSent = true;
      socket.write(`${secret}\n`);
    }
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.includes('SUCCESS: password is correct') && !authenticated) {
        authenticated = true;
        socket.write('state on\nhold release\n');
        continue;
      }
      if (!authenticated) continue;
      if (line.startsWith('>HOLD:')) {
        socket.write('hold release\n');
      } else if (line.startsWith('>STATE:')) {
        const state = line.slice(7).split(',')[1];
        if (state === 'CONNECTED') onState('connected');
        else if (state === 'EXITING') onState('disconnecting');
        else onState('connecting');
      } else if (line.startsWith('>PASSWORD:')) {
        if (line.includes('Verification Failed')) { fail('OpenVPN 认证失败，请检查账号、密码或服务器策略。'); return; }
        if (line.includes("Need 'Auth' username/password")) {
          if (!credentials.username || !credentials.password) { fail('该配置需要用户名和密码。'); return; }
          socket.write(`username "Auth" ${quoteCredential(credentials.username)}\npassword "Auth" ${quoteCredential(credentials.password)}\n`);
        } else { fail('暂不支持加密私钥或交互式多因素认证，请使用兼容的配置。'); return; }
      } else if (line.startsWith('>FATAL:') || line.startsWith('ERROR:')) {
        fail('OpenVPN 启动或网络配置失败，请检查配置、服务权限与服务器状态。'); return;
      }
    }
  });
  socket.on('error', () => fail('OpenVPN 控制连接失败。'));
  return {
    disconnect() { if (authenticated && !failed) socket.write('signal SIGTERM\n'); else socket.destroy(); },
    destroy() { socket.destroy(); },
  };
}

module.exports = { createManagement, quoteCredential };
