const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createManagement, quoteCredential } = require('../src/openvpn-management');
class Socket extends EventEmitter {
  writes = [];
  write(value) { this.writes.push(value); }
  destroy() { this.destroyed = true; }
}
test('authenticates before releasing hold and reports real state', () => {
  const socket = new Socket();
  const states = [];
  const management = createManagement(socket, { secret: 'random-secret', credentials: {}, onState: value => states.push(value), onError: assert.fail });
  socket.emit('data', Buffer.from('ENTER PASS'));
  socket.emit('data', Buffer.from('WORD:\nSUCCESS: password is correct\r\n'));
  assert.equal(socket.writes[0], 'random-secret\n');
  assert.match(socket.writes.join(''), /state on\nhold release/);
  socket.emit('data', Buffer.from('>STATE:1,CONNECTED,SUCCESS,10.0.0.1\n>STATE:2,RECONNECTING,tls-error\n'));
  assert.deepEqual(states, ['connected', 'connecting']);
  management.disconnect();
  assert.equal(socket.writes.at(-1), 'signal SIGTERM\n');
});
test('sends credentials only on authenticated Auth challenge, never on another challenge', () => {
  const socket = new Socket();
  const errors = [];
  createManagement(socket, { secret: 'secret', credentials: { username: 'u"ser', password: 'p\\ass' }, onState() {}, onError: e => errors.push(e) });
  socket.emit('data', Buffer.from('SUCCESS: password is correct\n>PASSWORD:Need \'Auth\' username/password\n'));
  assert.match(socket.writes.join(''), /username "Auth" "u\\"ser"/);
  assert.match(socket.writes.join(''), /password "Auth" "p\\\\ass"/);
  socket.emit('data', Buffer.from('>PASSWORD:Need \'Private Key\' password\n'));
  assert.match(errors[0], /加密私钥/);
});
test('rejects management command injection and unbounded responses', () => {
  assert.throws(() => quoteCredential('bad\nsignal SIGTERM'), /认证/);
  assert.throws(() => quoteCredential('x'.repeat(4097)), /认证/);
  const socket = new Socket();
  const errors = [];
  createManagement(socket, { secret: 's', credentials: {}, onState() {}, onError: e => errors.push(e) });
  socket.emit('data', Buffer.from('x'.repeat(65537)));
  assert.equal(socket.destroyed, true);
  assert.ok(errors.length);
});
test('releases hold again after reconnect without forgetting credentials', () => {
  const socket = new Socket();
  createManagement(socket, { secret: 's', credentials: {}, onState() {}, onError: assert.fail });
  socket.emit('data', Buffer.from('SUCCESS: password is correct\n>HOLD:Waiting for hold release:1\n'));
  assert.equal(socket.writes.at(-1), 'hold release\n');
});
