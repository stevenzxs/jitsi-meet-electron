# Unified local preferences

Approved: desktop Web client preferences is icon-only, with title/aria-label 客户端偏好. In Electron it navigates directly to the single local settings panel (profile/server/recording/video/VPN); no second Web form is opened. Keep browser-only personal information editing and existing stored identity semantics. Preserve legacy VPN navigation protocol for old Web deployments; new navigation requires exact configured origin and iframe source with correlated acknowledgement.

VPN stays on one long page, connection controls first, credentials conditional on profile auth, system VPN last. Bound the dialog height, allow the main flex child to shrink, and scroll only the content below its fixed heading. Test short-window scroll geometry in real Electron, navigation validation, profile save and server read-only display, regression suites and builds. Web changes need publication separately; do not change configured origins.
