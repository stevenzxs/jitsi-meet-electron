const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('47 deployment uses its own authority with explicit 8443 origin', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  assert.match(main, /deploymentConfig\.origin === 'https:\/\/47\.110\.84\.166:8443'/);
  assert.match(main, /certs\/cloudmeet-47-root\.crt/);
  assert.ok(fs.existsSync('src/certs/cloudmeet-47-root.crt'));
});
