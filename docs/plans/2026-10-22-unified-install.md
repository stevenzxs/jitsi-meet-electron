# Unified CloudMeet installation implementation plan

**Goal:** One selectable installation root containing the application and `vpn` runtime, without separate directory/service summaries in installer UI.

**Architecture:** Burn forwards `InstallFolder` to both MSIs. The private runtime MSI owns an elevated DTF custom action that validates local NTFS paths, rejects reparse points and unsafe ancestors, creates/protects a dedicated root before file installation, and records its location. Upgrades reuse the recorded root and reject relocation. Existing unsafe nonempty directories are not silently re-permissioned. Application remains unprivileged; user data stays outside the installation tree.

**Tech Stack:** WiX 3, Burn, C#/.NET Framework DTF custom actions, Electron, node:test.

1. Add failing tests for shared path forwarding, protected runtime directory, custom action sequencing, no duplicated path/service summaries, and bottom button bounds.
2. Implement private MSI directory property, secure-root validation custom action, and build the DTF DLL using the WiX SDK. Reject arbitrary install-root moves until separately tested. Do not recursively clean the shared root on rollback: a newly created empty protected root may remain for administrator cleanup.
3. Forward the root to both packages; persist registry location. Keep app and runtime MSIs separate owners. Correct theme sizing and simplify install/options pages.
4. Run VPN tests, build installer, inspect MSI tables and open UI without installation; document untested native install/upgrade/rollback gates.

No driver/service installation, live deployment, or VPN connections are authorized by this change. Existing unrelated working changes must remain intact. No automatic commits of the mixed working tree.
