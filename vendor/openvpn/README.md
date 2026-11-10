# OpenVPN Community prerequisite

Windows x64 release uses the official MSI only as a verified build input. WiX dark extracts allowlisted headless binaries and license files; no vendor MSI is installed. A CloudMeet-owned per-machine MSI deploys those binaries to Program Files and registers the isolated CloudMeetVPN service using `-instance interactive -CloudMeet`. No GUI, shortcuts, file associations or shared OpenVPN registry/service are installed.

Pinned version: 2.7.8-I001 (2026-10-07). Source: https://swupdate.openvpn.net/community/releases/OpenVPN-2.7.8-I001-amd64.msi

`payload.json` records SHA-256 and the verified Authenticode signer. `npm run verify:openvpn` verifies both before make. Do not substitute a package based on filename alone. Build downloads are explicit maintenance operations, never runtime downloads.

OpenVPN is GPL-licensed; preserve the vendor MSI's license notices. Release distribution must provide the corresponding source and dependency notices as required by their licenses. The bootstrapper includes an acceptance notice, but that does not discharge source-distribution obligations. Release owner must review and publish source availability before external release.

Wintun 0.14.1 archive metadata is in `wintun.json`; build checks its SHA-256 and DLL Authenticode signature. Its license is copied into the private runtime MSI. Wintun installs a signed driver on demand; native validation is still mandatory. Private service binaries must never be deployed to user-writable paths.

Uninstall removes the CloudMeet runtime/service but never another application's OpenVPN or shared driver. Earlier shared installations/icons are not automatically removed. Portable connection-time elevation is not yet implemented. Installer, service authorization and driver cleanup testing on a clean Windows VM are required before release.
