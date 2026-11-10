# Default-directory installation

User approved removing directory selection entirely because the VPN service requires protected files. Both packages use `[ProgramFiles64Folder]CloudMeet`, with VPN in `vpn`. Remove options UI, persisted Burn path and registry-based custom path restoration; disable internal application MSI directory chooser. Preserve previous-root detection solely to reject unsupported relocation, not silently migrate. Do not modify D: or any shared parent ACL.

Verification: update regression tests and observe failures, implement fixed path/UI removal, run VPN suite, build full installer, inspect actual welcome controls without clicking install. Native install/upgrade/uninstall remain separate acceptance gates.
