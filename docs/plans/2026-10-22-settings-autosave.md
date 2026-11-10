# Settings close autosave implementation plan

Goal: Remove manual username/routes/test-address save buttons. Save changed values before closing settings, preserving validation and showing failures without closing. No packaging requested.

Architecture: The VPN panel exposes an async pending-edit save hook. The renderer awaits it and username persistence from every existing close path, with a duplicate-close guard. Connection actions flush pending VPN edits first. Passwords remain transient.

1. Update panel regression tests for implicit save on connect, pending-edit flush and failures; run failing tests.
2. Remove HTML save controls, implement panel flush and renderer guarded close; keep current recording/video behavior.
3. Run VPN/settings tests and syntax/diff checks; do not build an installer or commit unrelated work.
