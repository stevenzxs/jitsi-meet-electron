# Private OpenVPN runtime implementation plan

Approved: CloudMeet-owned headless runtime, no independent OpenVPN GUI, icons, file associations or shared OpenVPN installation. Installer first; portable elevation workflow remains a separate, unverified deliverable.

## Architecture decision

OpenVPN 2.7.8 already supports an alternate Interactive Service instance: `-instance interactive -CloudMeet`, registry `HKLM\Software\OpenVPN-CloudMeet`, pipe `openvpn-CloudMeet\service`. Reuse the vendor-signed service and its established privilege separation instead of inventing a privileged command broker. SCM service is CloudMeetVPN. No dependency on OpenVPNServiceInteractive or the shared OpenVPN registry. Current-user profile access remains governed by the service's administrator/group policy; do not grant Everyone administrative VPN access.

Use the official signed Wintun DLL to deploy the adapter on demand through OpenVPN/service. This avoids redistributing TAP installer custom actions. Wintun still deploys a Windows driver; this is not driverless or elevation-free. Exact tunnel/driver behavior needs native acceptance.

## Steps and validation

1. Add failing tests for private MSI XML: only allowlisted runtime binaries, isolated registry/service/pipe, no GUI/shortcuts/shared product MSI, remove service on uninstall, no user-writable privileged paths.
2. Verify vendor MSI and Wintun archive pin/signature; extract build-only files using WiX dark (not msiexec); build a CloudMeet-owned runtime MSI under Program Files. Never execute vendor MSI. Preserve license files and document source obligations.
3. Change runtime preflight and named pipe to private instance; switch generated configuration to Wintun. Retain existing UI, encryption, routing and management tests.
4. Update Forge bundle to chain private runtime MSI then app MSI; build and run tests. Inspect resulting MSI tables to confirm no OpenVPN GUI/shortcut and isolated service values. Do not install or connect on developer host.
5. Update docs to explicitly supersede previous shared-MSI behavior; report packaging vs real-install gates independently. Do not remove an existing shared OpenVPN install automatically.

## Security/release gates

Privileged binaries must live under Program Files, not the portable/user profile directory. MSI is per-machine; service runs SYSTEM and accepts only vendor-validated requests. No auto-enrollment in privileged groups. Test authorized standard user, coexistence, reboot/upgrade/uninstall, driver creation and removal, DNS and selected/nonselected TCP/UDP paths. Sign final CloudMeet installers before external release. Existing shared OpenVPN installations/icons from earlier builds are not automatically removed.
