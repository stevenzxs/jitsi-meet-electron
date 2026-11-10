# CloudMeet bundled OpenVPN design

Approved scope: Windows installer includes OpenVPN Community as an offline prerequisite; the local shell imports a self-contained .ovpn profile and manages IPv4 host/CIDR routes. No meeting endpoint changes, application-specific interception, global proxy, global DNS, or default-route takeover.

## Boundaries

- Preserve the existing Windows system VPN controls as a separate section.
- An allowlisted profile parser accepts inline certificates/keys only. Reject scripts, plugins, external files, management options, DNS/interface policy, embedded routes and unknown directives. Enforce server identity validation.
- Encrypt imported profiles using Electron safeStorage. Do not persist usernames/passwords. Never return profile contents or raw OpenVPN logs to renderers.
- Generate runtime config from parsed profile plus validated explicit IPv4 routes. Use route-nopull and pull filters to reject unwanted server route/DNS policy. IPv6 tunnel setup is rejected in v1.
- Main-frame, exact local-shell IPC only. The renderer cannot supply executable paths, commands or arbitrary configuration paths.
- Use the official OpenVPN Interactive Service startup protocol through a fixed PowerShell named-pipe bridge. The official service launches OpenVPN as the caller and handles privileged network operations; Electron stays unprivileged.
- A loopback management listener uses a random password and management hold, sends in-memory credentials, and tracks actual CONNECTED state. No credentials in argv or disk. Disconnect signals only this instance.
- Runtime config is created in a private current-user directory, removed after the process exits; OpenVPN service owns route cleanup. App shutdown requests disconnect. Crash cleanup/driver behavior requires native acceptance testing.
- Bootstrapper chains the vendor-signed OpenVPN MSI and CloudMeet MSI, with license/version/hash metadata. Build fails if prerequisite payload is absent or unverified. Never silently publish a Windows installer without its VPN prerequisite.

## First-version UX

Import .ovpn; profile name; multiline IPv4/CIDR list; save; transient username/password; connect/disconnect/refresh; explicit missing service and authentication errors. Configuration cannot change while a connection is starting/running/stopping. Route edits require disconnect then save/reconnect.

## Security and residual risk

Untrusted files cannot execute commands or install arbitrary routes. Profile secrets are encrypted at rest; a short-lived generated plaintext profile is needed by OpenVPN. Disk ACLs must be restricted before writing it. Management is authenticated and loopback-only. Existing company VPN products/settings are not modified. The shared official OpenVPN installation must not be removed automatically on CloudMeet uninstall. Component license/source obligations require release review. Standard users must have permission under the official Interactive Service policy; report denial instead of elevating Electron.

## Validation gate

Unit/VM tests cover parsing, route policy, IPC, management authentication/state/credentials, timeout and disconnect. Read-only native checks may inspect installed prerequisites. Do not install drivers, dial or change host routes without separate permission. Final release requires a Windows test machine and real .ovpn: TCP/UDP selected paths, unchanged public route/DNS, restart/failure cleanup, install/upgrade/uninstall and coexistence. Mock tests do not prove a real tunnel.
