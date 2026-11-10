# Installer visual polish implementation plan

**Goal:** Approved compact, light CloudMeet-branded installer with Chinese-first disclosure, one folder selector and no path/service summaries.

**Architecture:** Retain WiX Standard BA and existing package chain/security checks. Update native theme, reuse brand icon, generate Unicode RTF from maintained Chinese text; keep all built-in control names unchanged.

**Tech Stack:** WiX 3 theme XML, Unicode RTF, node:test.

1. Add regression assertions in `scripts/openvpn-installer.test.cjs` for brand icon, Chinese disclosure, title, and safe client-area bounds; observe failure.
2. Update `vendor/openvpn/installer-theme.xml`, add Chinese disclosure source and RTF generator, set bundle icon and generate theme asset references at build time.
3. Run VPN regression suite and build integrated EXE. Open installer without installing; inspect welcome/options screenshots and control bounds. Leave multi-DPI, installation and upgrade acceptance explicit.

Scope excludes changes to native service, routing, installation location policy, live deployment and actual installation. Existing uncommitted work must be preserved.
