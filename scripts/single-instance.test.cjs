const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('src/main.js', 'utf8');
function acquire(isPackaged, lockResult, mode = 'release') {
  let calls = 0;
  const statement = source.match(/const gotSingleInstanceLock = [^;]+;/)[0];
  const result = vm.runInNewContext(`${statement}\ngotSingleInstanceLock`, {
    buildPolicy: { singleInstance: isPackaged && mode !== 'debug' },
    app: { isPackaged, requestSingleInstanceLock: () => { calls++; return lockResult; } }
  });
  return { result, calls };
}
test('development skips the single instance lock', () => {
  assert.deepEqual(acquire(false, false), { result: true, calls: 0 });
});
test('packaged debug skips the single instance lock', () => {
  assert.deepEqual(acquire(true, false, 'debug'), { result: true, calls: 0 });
});
test('packaged release still acquires and honors the single instance lock', () => {
  assert.deepEqual(acquire(true, false), { result: false, calls: 1 });
  assert.deepEqual(acquire(true, true), { result: true, calls: 1 });
});
