const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtimeXml, runtimeFiles } = require('./private-openvpn.cjs');
test('user VPN directory protection writes only DACL without privileged Set-Acl provider', () => {
  const native = fs.readFileSync(require.resolve('../src/openvpn-native.js'), 'utf8');
  const protect = native.slice(native.indexOf('async function protect('), native.indexOf('async function preflight('));
  assert.doesNotMatch(protect, /Set-Acl|SetOwner|Audit|SeSecurityPrivilege/);
  assert.match(protect, /SetAccessRuleProtection\(\$true,\$false\)/);
  assert.match(protect, /SetAccessControl\(\$acl\)/);
  assert.match(protect, /FileSystemAccessRule\(\$sid,'FullControl'/);
});
test('private machine runtime owns isolated service and registry without GUI or shortcuts', () => {
  const xml = runtimeXml('1.0.0', 'C:\\stage&files');
  assert.match(xml, /InstallScope="perMachine"/);
  assert.match(xml, /ProgramFiles64Folder/);
  assert.match(xml, /Name="CloudMeetVPN"/);
  assert.match(xml, /Arguments="-instance interactive -CloudMeet"/);
  assert.match(xml, /Key="Software\\OpenVPN-CloudMeet"/);
  assert.match(xml, /Remove="uninstall"/);
  assert.match(xml, /stage&amp;files/);
  assert.doesNotMatch(xml, /Shortcut|OpenVPNServiceInteractive|openvpn-gui|OpenVPN\.GUI|HKCU/);
  assert.ok(runtimeFiles.includes('wintun.dll'));
  assert.ok(runtimeFiles.includes('openvpn.exe'));
  assert.ok(!runtimeFiles.includes('openvpnserv2.exe'));
});
test('native bridge never falls back to shared OpenVPN', () => {
  const native = fs.readFileSync(require.resolve('../src/openvpn-native.js'), 'utf8');
  const bridge = fs.readFileSync(require.resolve('../src/openvpn-service.ps1'), 'utf8');
  assert.match(native, /CloudMeetVPN/);
  assert.doesNotMatch(native, /Name OpenVPNServiceInteractive/);
  assert.match(bridge, /openvpn-CloudMeet\\service/);
});
test('runtime uses a protected shared root and validates before installing files', () => {
  const xml = runtimeXml('1.0.1', 'stage');
  assert.match(xml, /Directory Id="CLOUDMEETROOT" Name="CloudMeet"/);
  assert.match(xml, /Directory Id="RuntimeDir" Name="vpn"/);
  assert.match(xml, /Custom Action="ProtectInstallRoot" Before="CreateFolders"/);
  assert.match(xml, /Execute="deferred" Impersonate="no"/);
  assert.match(xml, /RegistrySearch[^>]*Name="InstallRoot"/);
  assert.match(xml, /Secure="yes"/);
});
