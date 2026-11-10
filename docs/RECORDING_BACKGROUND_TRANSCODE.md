# 录屏后台转码方案实现文档

## 问题描述

当前录屏功能存在严重缺陷：
- 用户录制20分钟视频后，停止录制会触发 FFmpeg 转码（需要30-90秒）
- 如果用户在转码完成前关闭应用，FFmpeg 进程被强制杀死
- 导致 MP4 文件损坏或缺失，WebM 源文件可能已被删除
- 用户完全丢失录制内容

## 解决方案：后台转码

### 核心改动

#### 1. 添加转码任务跟踪

```javascript
// 在 line 42 之后添加
const activeTranscodes = new Map(); // Map<sessionId, { ffmpeg, inputPath, outputPath, startTime }>
```

#### 2. 修改 transcodeWebmToMp4 函数（line 297-320）

```javascript
function transcodeWebmToMp4(sessionId, inputPath, outputPath) {
  const executablePath = getFfmpegExecutablePath();
  if (!executablePath) return Promise.reject(new Error('FFmpeg 不可用'));

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(executablePath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath,
    ], { windowsHide: true });
    
    // 保存进程引用
    activeTranscodes.set(sessionId, {
      ffmpeg,
      inputPath,
      outputPath,
      startTime: Date.now(),
    });
    
    let stderr = '';
    ffmpeg.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    
    ffmpeg.once('error', (err) => {
      activeTranscodes.delete(sessionId);
      reject(err);
    });
    
    ffmpeg.once('close', (code) => {
      activeTranscodes.delete(sessionId);
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `FFmpeg 退出码 ${code}`));
    });
  });
}
```

#### 3. 修改 recording-session-finish 处理器（line 1152-1181）

```javascript
ipcMain.handle('recording-session-finish', async (_event, rawSessionId) => {
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

  // 立即返回 WebM 文件，转码在后台进行
  const immediateResult = {
    ok: true,
    videoFilePath: session.videoFilePath,
    videoFormat: 'webm',
    converting: true, // 标记正在后台转码
    ...(session.audioFilePath ? { audioFilePath: session.audioFilePath } : {}),
  };

  // 后台异步转码，不阻塞返回
  transcodeWebmToMp4(sessionId, session.videoFilePath, session.mp4FilePath)
    .then(() => {
      console.log(`[recording] 转码完成: ${session.mp4FilePath}`);
      
      // 转码成功后删除 WebM 源文件
      try {
        fs.unlinkSync(session.videoFilePath);
      } catch (error) {
        console.warn('[recording] 删除 WebM 源文件失败:', error?.message);
      }

      // 通知所有窗口转码完成
      for (const win of BrowserWindow.getAllWindows()) {
        sendToWindow(win, 'recording-transcode-complete', {
          sessionId,
          videoFilePath: session.mp4FilePath,
          videoFormat: 'mp4',
        });
      }
    })
    .catch((error) => {
      console.warn('[recording] 后台转码失败，保留 WebM 文件:', error?.message || error);
      
      // 清理失败的部分 MP4 文件
      try {
        fs.unlinkSync(session.mp4FilePath);
      } catch {}

      // 通知所有窗口转码失败
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
});
```

#### 4. 修改 before-quit 事件处理（line 1476-1482）

```javascript
app.on('before-quit', (event) => {
  shareController?.shutdown();
  
  // 清理未完成的录制会话（仅清理正在写入的会话）
  for (const [sessionId, session] of recordingSessions.entries()) {
    recordingSessions.delete(sessionId);
    destroyRecordingSession(session);
  }

  // 如果有正在进行的转码任务，阻止立即退出
  if (activeTranscodes.size > 0) {
    event.preventDefault(); // 阻止立即退出
    
    console.log(`[recording] 等待 ${activeTranscodes.size} 个转码任务完成...`);
    
    // 创建等待提示窗口
    const waitWindow = new BrowserWindow({
      width: 450,
      height: 220,
      frame: false,
      alwaysOnTop: true,
      center: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      backgroundColor: '#ffffff',
    });

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 30px;
    }
    h2 {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      opacity: 0.95;
      margin-bottom: 8px;
    }
    #status {
      font-weight: 600;
      font-size: 16px;
      margin-top: 20px;
      padding: 12px 24px;
      background: rgba(255,255,255,0.2);
      border-radius: 20px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      margin: 20px auto 0;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <h2>🎬 正在处理录制文件</h2>
  <p>视频转码进行中，请稍候...</p>
  <p style="opacity: 0.8; font-size: 13px;">转码完成后将自动关闭应用</p>
  <div class="spinner"></div>
  <div id="status">${activeTranscodes.size} 个任务待完成</div>
</body>
</html>`;

    waitWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    waitWindow.once('ready-to-show', () => {
      waitWindow.show();
    });

    // 设置超时保护（最多等待 10 分钟）
    const forceQuitTimeout = setTimeout(() => {
      console.warn('[recording] 转码超时（10分钟），强制退出应用');
      
      // 强制终止所有 FFmpeg 进程
      for (const [sid, { ffmpeg }] of activeTranscodes) {
        try {
          ffmpeg.kill('SIGTERM');
          console.log(`[recording] 强制终止转码任务: ${sid}`);
        } catch (error) {
          console.warn(`[recording] 终止转码失败:`, error?.message);
        }
      }
      activeTranscodes.clear();
      
      if (!waitWindow.isDestroyed()) {
        waitWindow.close();
      }
      app.quit();
    }, 10 * 60 * 1000); // 10 分钟超时

    // 定期检查转码进度
    const progressCheckInterval = setInterval(() => {
      if (activeTranscodes.size === 0) {
        // 所有转码任务完成
        clearInterval(progressCheckInterval);
        clearTimeout(forceQuitTimeout);
        
        console.log('[recording] 所有转码任务已完成，准备退出应用');
        
        if (!waitWindow.isDestroyed()) {
          waitWindow.close();
        }
        
        // 真正退出应用
        app.quit();
      } else {
        // 更新等待窗口状态
        if (!waitWindow.isDestroyed()) {
          waitWindow.webContents.executeJavaScript(
            `document.getElementById('status').textContent = '${activeTranscodes.size} 个任务待完成'`
          ).catch(() => {
            /* ignore if window is being destroyed */
          });
        }
      }
    }, 500); // 每 500ms 检查一次
  }
});
```

## 工作流程

### 用户操作流程

1. **用户点击停止录制**
   - WebM 文件立即关闭并可用
   - 返回 `{ ok: true, videoFormat: 'webm', converting: true }`
   - 用户可以立即预览 WebM 文件

2. **后台转码开始**
   - FFmpeg 进程在后台运行
   - `activeTranscodes` Map 记录转码任务

3. **转码完成**
   - 删除 WebM 源文件
   - 发送 `recording-transcode-complete` 事件到所有窗口
   - 前端更新文件路径为 MP4

4. **用户关闭应用**
   - 如果转码未完成，显示等待窗口
   - 最多等待 10 分钟
   - 转码完成后自动退出

### 异常处理

- **转码失败**：保留 WebM 文件，通知前端
- **应用强制关闭**：10分钟超时后强制退出
- **FFmpeg 崩溃**：捕获错误，保留 WebM

## 优势

✅ **用户体验**
- 停止录制后立即返回，无需等待
- 可以立即关闭应用，转码在后台进行
- WebM 文件始终可用作备份

✅ **数据安全**
- 即使转码失败，用户仍有 WebM 文件
- 应用退出前确保转码完成或超时保护

✅ **性能**
- 不阻塞主线程
- 支持多个转码任务并行

## 前端适配（可选）

监听转码完成事件：

```javascript
window.cloudmeet.onTranscodeComplete((event, data) => {
  console.log('转码完成:', data.videoFilePath);
  // 更新UI显示MP4文件
});

window.cloudmeet.onTranscodeFailed((event, data) => {
  console.log('转码失败:', data.error);
  // 显示WebM文件，提示用户
});
```

## 测试场景

1. **正常场景**：录制 → 停止 → 等待转码完成 → 关闭应用
2. **快速关闭**：录制 → 停止 → 立即关闭应用（应显示等待窗口）
3. **长时间录制**：录制20分钟 → 停止 → 转码90秒 → 关闭应用
4. **转码失败**：模拟FFmpeg失败，确认WebM文件保留
5. **超时保护**：模拟超长转码，确认10分钟后强制退出

## 部署检查清单

- [ ] 添加 `activeTranscodes` 全局变量
- [ ] 修改 `transcodeWebmToMp4` 函数签名（添加sessionId参数）
- [ ] 修改 `recording-session-finish` 为后台转码
- [ ] 修改 `app.on('before-quit')` 添加等待逻辑
- [ ] 测试所有场景
- [ ] 更新用户文档
