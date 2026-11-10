const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function mount(api = {}) {
  const nodes = new Map();
  for (const id of ['vpnProfile', 'vpnStatus', 'vpnError', 'vpnConnect', 'vpnDisconnect', 'vpnRefresh', 'vpnSettings']) {
    nodes.set(id, { value: '', hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; },
    });
  }
  const listeners = {};
  const calls = [];
  const window = { cloudmeet: {
    listVpn: async () => [{ id: 'user:test', name: 'test', scope: 'user', status: 'disconnected' }],
    connectVpn: async id => { calls.push(id); return { status: 'disconnected' }; },
    disconnectVpn: async () => {}, openVpnSettings: async () => {}, ...api,
  } };
  const document = { getElementById: id => nodes.get(id), createElement: () => ({}),
    addEventListener: (event, handler) => { listeners[event] = handler; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/vpn-panel.js'), 'utf8'),
    { window, document, setInterval: () => 1, clearInterval() {} });
  return { nodes, calls, show: () => listeners['vpn-panel-visibility']({ detail: true }) };
}
test('loads profiles on showing panel and never reports cancelled native dial as connected', async () => {
  const { nodes, calls, show } = mount();
  await show();
  assert.equal(nodes.get('vpnConnect').disabled, false);
  await nodes.get('vpnConnect').listeners.click();
  assert.deepEqual(calls, ['user:test']);
  assert.match(nodes.get('vpnError').textContent, /未建立/);
  assert.equal(nodes.get('vpnStatus').textContent, '未连接');
});
test('empty configuration gives guidance and disables mutations', async () => {
  const { nodes, show } = mount({ listVpn: async () => [] });
  await show();
  assert.match(nodes.get('vpnStatus').textContent, /Windows VPN 设置/);
  assert.equal(nodes.get('vpnConnect').disabled, true);
  assert.equal(nodes.get('vpnDisconnect').disabled, true);
});
test('query failures invalidate stale connected state', async () => {
  let fail = false;
  const { nodes, show } = mount({ listVpn: async () => {
    if (fail) throw new Error('query failed');
    return [{ id: 'user:test', name: 'test', scope: 'user', status: 'connected' }];
  } });
  await show();
  assert.equal(nodes.get('vpnDisconnect').disabled, false);
  fail = true;
  await nodes.get('vpnRefresh').listeners.click();
  assert.equal(nodes.get('vpnStatus').textContent, '状态未知');
  assert.equal(nodes.get('vpnDisconnect').disabled, true);
  assert.match(nodes.get('vpnError').textContent, /query failed/);
});
