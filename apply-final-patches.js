const fs = require('fs');
const path = require('path');

const mainJsPath = path.join(__dirname, 'src', 'main.js');

console.log('正在应用录屏后台转码补丁...\n');

let content = fs.readFileSync(mainJsPath, 'utf8');
let modified = false;

// 修改2: transcodeWebmToMp4 函数签名
if (content.includes('function transcodeWebmToMp4(inputPath, outputPath)')) {
  console.log('[2/4] 修改 transcodeWebmToMp4 函数签名...');
  content = content.replace(
    'function transcodeWebmToMp4(inputPath, outputPath) {',
    'function transcodeWebmToMp4(sessionId, inputPath, outputPath) {'
  );
  modified = true;
  console.log('  ✓ 函数签名已修改');
}

// 修改2b: 添加进程跟踪
if (content.includes('], { windowsHide: true });') && !content.includes('activeTranscodes.set(sessionId')) {
  console.log('[2/4] 添加转码进程跟踪...');
  content = content.replace(
    '], { windowsHide: true });\n    let stderr = \'\';',
    `], { windowsHide: true });
    activeTranscodes.set(sessionId, {
      ffmpeg,
      inputPath,
      outputPath,
      startTime: Date.now(),
    });
    let stderr = '';`
  );
  modified = true;
  console.log('  ✓ 进程跟踪已添加');
}

// 修改2c: error 处理
if (content.includes('ffmpeg.once(\'error\', reject);')) {
  console.log('[2/4] 修改 error 处理...');
  content = content.replace(
    'ffmpeg.once(\'error\', reject);',
    `ffmpeg.once('error', (err) => {
      activeTranscodes.delete(sessionId);
      reject(err);
    });`
  );
  modified = true;
  console.log('  ✓ error 处理已修改');
}

// 修改2d: close 处理
if (content.includes('ffmpeg.once(\'close\', (code) => {') && !content.includes('activeTranscodes.delete(sessionId);\n      if (code === 0')) {
  console.log('[2/4] 修改 close 处理...');
  content = content.replace(
    'ffmpeg.once(\'close\', (code) => {\n      if (code === 0',
    `ffmpeg.once('close', (code) => {
      activeTranscodes.delete(sessionId);
      if (code === 0`
  );
  modified = true;
  console.log('  ✓ close 处理已修改');
}

if (modified) {
  fs.writeFileSync(mainJsPath, content, 'utf8');
  console.log('\n✅ 修改2完成：transcodeWebmToMp4 函数已更新\n');
  console.log('⚠️  还需要手动修改:');
  console.log('   3. recording-session-finish 处理器 (line 1152-1181)');
  console.log('   4. app.on(\'before-quit\') 事件 (line 1476-1482)');
  console.log('\n请查看: 录屏后台转码方案-简化版.md\n');
} else {
  console.log('⚠️  修改2已存在或未找到匹配模式\n');
}
