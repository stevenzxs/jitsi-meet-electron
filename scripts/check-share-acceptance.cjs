// Reproducible logic acceptance entry point. Native integration is a separate
// Electron script because it must run with the renderer and Windows APIs.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test',
  path.join(__dirname, 'share-controller.test.cjs'),
  path.join(__dirname, 'share-capture.test.cjs'),
], { stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
