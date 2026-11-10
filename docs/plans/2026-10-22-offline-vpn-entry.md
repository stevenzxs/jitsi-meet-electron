# Offline VPN bootstrap

Approved: always expose the bundled settings button; show a local connection card with VPN settings and retry before the configured remote page is ready; retry only an unready page after VPN connects. Do not change server URLs, server configuration, or automatically dial VPN.

Readiness uses the existing user/server/settings startup IPC postMessage requests from the exact current iframe and configured target origin. An iframe load/error-page event is not success. A ten-second timer changes the hint but does not block local controls. Reload retains the exact requested target, including meeting deep links; a ready page is never automatically refreshed on a VPN transition.

Regression: blocked remote iframe still exposes local controls; trusted vs forged readiness; VPN retry before readiness and no retry after readiness. Run unit suite and real Electron blocked-network smoke before packaging. Existing authorization and IPC sender checks stay unchanged.
