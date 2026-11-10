const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function mount(overrides = {}) {
  const nodes = new Map(['ovpnName', 'ovpnRoutes', 'ovpnUsername', 'ovpnPassword', 'ovpnImport',
    'ovpnConnect', 'ovpnDisconnect', 'ovpnRefresh', 'ovpnStatus', 'ovpnError', 'ovpnTestAddress', 'ovpnTest', 'ovpnTestResult'].map(id => [id,
    { value: '', textContent: '', dataset: {}, hidden: true, disabled: false, listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; } }]));
  const calls = [];
  let state = { name: 'company.ovpn', routes: ['10.0.0.1/32'], available: true, status: 'disconnected', auth: true, error: '' };
  const listeners = {};
  const api = { openVpnStatus: async () => state, openVpnImport: async () => state,
    openVpnSaveRoutes: async value => { calls.push(value); return state; },
    openVpnConnect: async value => { calls.push(value); return state = { ...state, status: 'connecting' }; },
    openVpnDisconnect: async () => state, ...overrides };
  const window = { cloudmeet: api };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/openvpn-panel.js'), 'utf8'), {
    window, document: { getElementById: id => nodes.get(id), addEventListener: (event, cb) => listeners[event] = cb, dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setInterval: () => 1, clearInterval() {},
  });
  return { nodes, calls, save: () => window.cloudmeetVpnPanel.savePending(), show: () => listeners['vpn-panel-visibility']({ detail: true }) };
}
test('loads route editor, saves explicit input and clears password after connection request', async () => {
  const { nodes, calls, show } = mount();
  await show();
  assert.equal(nodes.get('ovpnRoutes').value, '10.0.0.1/32');
  assert.equal(nodes.get('ovpnConnect').disabled, false);
  nodes.get('ovpnRoutes').value = '10.0.0.2';
  await nodes.get('ovpnRoutes').listeners.input();
  assert.equal(nodes.get('ovpnConnect').disabled, false);
  nodes.get('ovpnUsername').value = 'user'; nodes.get('ovpnPassword').value = 'secret';
  await nodes.get('ovpnConnect').listeners.click();
  assert.equal(calls[0], '10.0.0.2');
  assert.equal(calls[1].password, 'secret');
  assert.equal(nodes.get('ovpnPassword').value, '');
  assert.equal(nodes.get('ovpnRoutes').disabled, true);
  assert.match(nodes.get('ovpnStatus').textContent, /连接中/);
});
test('missing components prevents connection but permits profile preparation', async () => {
  const { nodes, show } = mount({ openVpnStatus: async () => ({ name: '', routes: [], status: 'disconnected', available: false }) });
  await show();
  assert.equal(nodes.get('ovpnConnect').disabled, true);
  assert.equal(nodes.get('ovpnImport').disabled, false);
  assert.match(nodes.get('ovpnError').textContent, /修复/);
});
test('does not display runtime details', async () => {
  const { nodes, show } = mount({ openVpnStatus: async () => ({ name: '', routes: [], status: 'disconnected', available: true,
    runtimePath: 'C:\\Program Files\\CloudMeet VPN Runtime\\openvpn.exe' }) });
  await show();
  assert.equal(nodes.has('ovpnComponent'), false);
});
test('tests only saved addresses while connected and clears result on disconnect', async () => {
  let state = { name: 'x.ovpn', routes: ['10.8.0.1/32'], available: true, status: 'connected', testAddress: 'http://10.8.0.1' };
  const { nodes, show } = mount({ openVpnStatus: async () => state, openVpnTest: async () => ({ ok: true, elapsedMs: 12 }) });
  await show();
  assert.equal(nodes.get('ovpnTest').disabled, false);
  await nodes.get('ovpnTest').listeners.click();
  assert.match(nodes.get('ovpnTestResult').textContent, /测试通过.*12 ms/);
  state = { ...state, status: 'disconnected' };
  await nodes.get('ovpnRefresh').listeners.click();
  assert.equal(nodes.get('ovpnTestResult').textContent, '');
  assert.equal(nodes.get('ovpnTest').disabled, true);
});
test('query failure invalidates controls instead of leaving stale connected state', async () => {
  let fail = false;
  const { nodes, show } = mount({ openVpnStatus: async () => {
    if (fail) throw new Error('service unavailable');
    return { name: 'x.ovpn', routes: [], available: true, status: 'connected' };
  } });
  await show(); fail = true;
  await nodes.get('ovpnRefresh').listeners.click();
  assert.equal(nodes.get('ovpnDisconnect').disabled, true);
  assert.match(nodes.get('ovpnError').textContent, /service unavailable/);
});
test('closing flush saves pending routes and test address once; polling keeps edits', async () => {
  const writes = [];
  const state = { name: 'x.ovpn', routes: ['10.8.0.1/32'], available: true, status: 'disconnected' };
  const { nodes, show, save } = mount({ openVpnStatus: async () => state,
    openVpnSaveRoutes: async value => { writes.push(['routes', value]); return { ...state, routes: [value] }; },
    openVpnSaveTestAddress: async value => { writes.push(['test', value]); return { ...state, testAddress: value }; } });
  await show();
  nodes.get('ovpnRoutes').value = '10.8.0.2/32'; nodes.get('ovpnRoutes').listeners.input();
  nodes.get('ovpnTestAddress').value = 'http://10.8.0.2/probe'; nodes.get('ovpnTestAddress').listeners.input();
  await nodes.get('ovpnRefresh').listeners.click();
  assert.equal(nodes.get('ovpnRoutes').value, '10.8.0.2/32');
  await save(); await save();
  assert.deepEqual(writes, [['routes', '10.8.0.2/32'], ['test', 'http://10.8.0.2/probe']]);
});
test('failed autosave retains edits for retry and prevents connect', async () => {
  let fail = true;
  const { nodes, calls, show, save } = mount({ openVpnSaveRoutes: async () => {
    if (fail) throw new Error('invalid route');
    return { routes: ['10.8.0.1/32'], status: 'disconnected', available: true };
  } });
  await show(); nodes.get('ovpnRoutes').value = 'bad'; nodes.get('ovpnRoutes').listeners.input();
  await assert.rejects(save(), /invalid route/);
  assert.equal(nodes.get('ovpnRoutes').value, 'bad');
  await nodes.get('ovpnConnect').listeners.click();
  assert.equal(calls.length, 0);
  assert.match(nodes.get('ovpnError').textContent, /invalid route/);
  fail = false; await save();
});
