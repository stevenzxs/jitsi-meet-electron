const fs = require('fs');
const path = require('path');

const mainJsPath = path.join(__dirname, 'src', 'main.js');
const backupPath = path.join(__dirname, 'src', 'main.js.backup');

console.log('开始应用录屏后台转码补丁...\n');

if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(mainJsPath, backupPath);
  console.log('已备份到:', backupPath);
}

let content = fs.readFileSync(mainJsPath, 'utf8');

console.log('[1/4] 添加转码任务跟踪...');
if (!content.includes('const activeTranscodes')) {
  content = content.replace(
    'const recordingSessions = new Map();',
    'const recordingSessions = new Map();\nconst activeTranscodes = new Map();'
  );
  console.log('  完成');
}

console.log('[2/4] 修改转码函数...');
content = content.replace(
  'function transcodeWebmToMp4(inputPath, outputPath) {',
  'function transcodeWebmToMp4(sessionId, inputPath, outputPath) {'
);
content = content.replace(
  '], { windowsHide: true });\n    let stderr = \'\';',
  '], { windowsHide: true });\n    activeTranscodes.set(sessionId, { ffmpeg, inputPath, outputPath, startTime: Date.now() });\n    let stderr = \'\';'
);
content = content.replace(
  'ffmpeg.once(\'error\', reject);',
  'ffmpeg.once(\'error\', (err) => { activeTranscodes.delete(sessionId); reject(err); });'
);
content = content.replace(
  'ffmpeg.once(\'close\', (code) => {',
  'ffmpeg.once(\'close\', (code) => {\n      activeTranscodes.delete(sessionId);'
);
console.log('  完成');

fs.writeFileSync(mainJsPath, content, 'utf8');
console.log('\n基础补丁应用完成！');
console.log('请手动完成剩余修改，参考: docs/RECORDING_BACKGROUND_TRANSCODE.md\n');
