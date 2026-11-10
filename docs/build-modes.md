# Desktop build modes

| Command | Mode | DevTools | Instances | Windows x64 output |
| --- | --- | --- | --- | --- |
| `npm start` | Development | F12 / Ctrl+Shift+I | Multiple | No package |
| `npm run package:debug` | Debug | F12 / Ctrl+Shift+I | Multiple | `out/debug/cloudmeet-win32-x64/` |
| `npm run package` | Release | Disabled | Single | `out/cloudmeet-win32-x64/` |
| `npm run make` | Release installer | Disabled | Single | `out/make/` (existing MSI and OpenVPN bundle) |

Forge writes the build mode into the copied package metadata before ASAR creation.
Launching the packaged executable does not require environment variables. Runtime
`CLOUDMEET_BUILD_MODE` or `NODE_ENV` values cannot change the packaged policy.
Missing/unknown metadata defaults to Release. The source package.json is not stamped.

Release disables DevTools for the main, meeting, source picker and sharing helper
windows. Its F12 handler does not open DevTools and its menu omits the developer item.
Debug uses a separate output directory and does not request the app single-instance
lock. User configuration/storage paths are unchanged; multiple instances are not
isolated user profiles and can share persisted settings.

Do not rebuild an output directory while its executable is running. Quit that client
first, or defer packaging; do not force-stop an active meeting to build.

Tests: `node --test scripts/*.test.cjs`.
