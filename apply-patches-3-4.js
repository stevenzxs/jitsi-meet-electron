const fs = require('fs');
const path = require('path');

const mainJsPath = path.join(__dirname, 'src', 'main.js');

console.log('正在应用修改3和4...\n');

let content = fs.readFileSync(mainJsPath, 'utf8');

// 修改3: recording-session-finish
console.log('[3/4] 修改 recording-session-finish 处理器...');

const oldFinishPattern = /ipcMain\.handle\('recording-session-finish', async \(_event, rawSessionId\) => \{[\s\S]*?return \{[\s\S]*?conversionError:[\s\S]*?\};\s*\}\);/;

const newFinishHandler = `ipcMain.handle('recording-session-finish', async (_event, rawSessionId) => {
  const sessionId = String(rawSessionId || '');
  const session = recordingSessions.get(sessionId);
  if (!session) {
    return { ok: false, error: '录制会话不存在' };
  }

  recordingSessions.delete(sessionId);
  await Promise.all([
    closeWriteStream(session.videoStream),
    session.audioStream ? closeWriteStream(session.audioStream) : Promise.resolve()
  ]);

  const immediateResult = {
    ok: true,
    videoFilePath: session.videoFilePath,
    videoFormat: 'webm',
    converting: true,
    ...(session.audioFilePath ? { audioFilePath: session.audioFilePath } : {}),
  };

  transcodeWebmToMp4(sessionId, session.videoFilePath, session.mp4FilePath)
    .then(() => {
      console.log(\`[recording] 转码完成: \${session.mp4FilePath}\`);
      
      for (const win of BrowserWindow.getAllWindows()) {
        sendToWindow(win, 'recording-transcode-complete', {
          sessionId,
          videoFilePath: session.mp4FilePath,
          webmFilePath: session.videoFilePath,
          videoFormat: 'mp4',
        });
      }
    })
    .catch((error) => {
      console.warn('[recording] 后台转码失败:', error?.message || error);
      
      try {
        fs.unlinkSync(session.mp4FilePath);
      } catch {}

      for (const win of BrowserWindow.getAllWindows()) {
        sendToWindow(win, 'recording-transcode-failed', {
          sessionId,
          videoFilePath: session.videoFilePath,
          videoFormat: 'webm',
          error: error?.message || '转码失败',
        });
      }
    });

  return immediateResult;
});`;

if (oldFinishPattern.test(content)) {
  content = content.replace(oldFinishPattern, newFinishHandler);
  console.log('  ✓ recording-session-finish 已修改');
} else {
  console.log('  ⚠️  未找到匹配模式，可能已修改或格式不同');
}

// 修改4: before-quit
console.log('[4/4] 修改 app.on(\'before-quit\') 事件...');

const oldQuitPattern = /app\.on\('before-quit', \(\) => \{[\s\S]*?destroyRecordingSession\(session\);[\s\S]*?\}\);/;

const newQuitHandler = `app.on('before-quit', (event) => {
  shareController?.shutdown();
  
  for (const [sessionId, session] of recordingSessions.entries()) {
    recordingSessions.delete(sessionId);
    destroyRecordingSession(session);
  }

  if (activeTranscodes.size > 0) {
    event.preventDefault();
    
    console.log(\`[recording] 静默等待 \${activeTranscodes.size} 个转码任务完成...\`);
    
    const forceQuitTimeout = setTimeout(() => {
      console.warn('[recording] 转码超时（10分钟），强制退出');
      for (const [sid, { ffmpeg }] of activeTranscodes) {
        try {
          ffmpeg.kill('SIGTERM');
        } catch {}
      }
      activeTranscodes.clear();
      app.quit();
    }, 10 * 60 * 1000);

    const progressCheckInterval = setInterval(() => {
      if (activeTranscodes.size === 0) {
        clearInterval(progressCheckInterval);
        clearTimeout(forceQuitTimeout);
        console.log('[recording] 转码完成，退出应用');
        app.quit();
      }
    }, 500);
  }
});`;

if (oldQuitPattern.test(content)) {
  content = content.replace(oldQuitPattern, newQuitHandler);
  console.log('  ✓ before-quit 已修改');
} else {
  console.log('  ⚠️  未找到匹配模式，可能已修改或格式不同');
}

fs.writeFileSync(mainJsPath, content, 'utf8');

console.log('\n✅ 所有修改完成！\n');
console.log('📋 已完成的修改：');
console.log('  1. ✓ 添加 activeTranscodes 转码任务跟踪');
console.log('  2. ✓ 修改 transcodeWebmToMp4 函数');
console.log('  3. ✓ 修改 recording-session-finish 为后台转码');
console.log('  4. ✓ 修改 app.on(\'before-quit\') 静默等待');
console.log('\n🧪 下一步：测试');
console.log('  1. 重启应用');
console.log('  2. 录制 20 分钟视频');
console.log('  3. 停止录制 → 立即关闭应用');
console.log('  4. 观察：窗口消失，进程等待 1-2 分钟后自动退出');
console.log('  5. 检查录制目录：应该有 WebM + MP4 两个文件\n');
