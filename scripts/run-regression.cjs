// Include both naming conventions; never auto-run live VPN/device scripts.
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const root = resolve(__dirname, '..');
const files = readdirSync(__dirname)
  .filter(name => /(?:\.test\.cjs$|^test-.*\.cjs$)/.test(name))
  .sort().map(name => `scripts/${name}`);
console.log(`Regression discovery: ${files.length} test files`);
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
