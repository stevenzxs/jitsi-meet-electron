const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { Writable } = require('node:stream');
const { Console } = require('node:console');
const { spawn } = require('node:child_process');
const modulePath = path.join(__dirname, '../src/stdio-guard.js');
const install = (...args) => require(modulePath).installStdioGuard(...args);
const pipeError = () => Object.assign(new Error('broken pipe'), { code: 'EPIPE' });

test('stdio guard is installed before main-process dependencies can log', () => {
  assert.ok(existsSync(modulePath), 'A dedicated stdio guard must exist');
  const main = readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main.split('\n')[0], /require\('\.\/stdio-guard'\)\.installStdioGuard\(\)/);
});

test('synchronous EPIPE disables only the broken stream and preserves write callbacks', async () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let writes = 0;
  stdout.write = () => { writes++; throw pipeError(); };
  stderr.write = () => true;
  install({ stdout, stderr });
  install({ stdout, stderr });
  assert.equal(stdout.listenerCount('error'), 1, 'Installation is idempotent');
  assert.doesNotThrow(() => stdout.write('first'));
  await new Promise(resolve => stdout.write('later', 'utf8', resolve));
  assert.equal(writes, 1, 'Do not write into the broken pipe again');
  assert.equal(stderr.write('still usable'), true);
});

test('asynchronous Writable EPIPE does not escape and later console output is dropped', async () => {
  let writes = 0;
  const stdout = new Writable({ write(_chunk, _encoding, callback) {
    writes++;
    process.nextTick(() => callback(pipeError()));
  } });
  const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  install({ stdout, stderr });
  const logger = new Console({ stdout, stderr, ignoreErrors: false });
  logger.log('capture runtime installed');
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotThrow(() => logger.log('next frame navigation'));
  assert.equal(writes, 1);
});

test('non-EPIPE errors are not swallowed', () => {
  const stdout = new EventEmitter();
  const failure = Object.assign(new Error('unexpected I/O failure'), { code: 'EIO' });
  stdout.write = () => { throw failure; };
  install({ stdout });
  assert.throws(() => stdout.write('test'), error => error === failure);
  assert.throws(() => stdout.emit('error', failure), error => error === failure);
});

test('child survives real parent-side stdout/stderr pipe closure', async () => {
  const child = spawn(process.execPath, ['-e', `
    require(${JSON.stringify(modulePath)}).installStdioGuard();
    process.on('message', () => {
      console.log('capture runtime installed');
      console.warn('another frame');
      setTimeout(() => {
        console.log('later navigation');
        console.warn('later warning');
        process.send('alive', () => process.disconnect());
      }, 100);
    });
    process.send('ready');
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Child timed out')); }, 5000);
    child.on('error', reject);
    child.on('message', message => {
      messages.push(message);
      if (message === 'ready') {
        child.stdout.destroy();
        child.stderr.destroy();
        child.send('write');
      }
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      try { assert.equal(code, 0); assert.deepEqual(messages, ['ready', 'alive']); resolve(); }
      catch (error) { reject(error); }
    });
  });
});
