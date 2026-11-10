# VPN settings test and status

Approved: configurable local test URL and an independent VPN status badge; remove verbose Web/native headings, explanations and runtime path/version text. Keep operational errors visible.

The local shell alone may save/test via sender-validated IPC. Persist the address with local settings, not the profile credentials. Only canonical IPv4 HTTP/HTTPS destinations inside saved split routes are accepted. Test only while connected, one request at a time, bounded to five seconds, no redirects, no body reading, no TLS bypass. A 2xx HTTP response passes; other responses or connection failures fail independently of tunnel state. Clear stale results when state/address changes. This is reachability, not proof of a particular network path for every server.

Verify URL rejection and timeout/redirect tests, panel tests, VPN regression suite, live 118 probe through actual panel, route/DNS cleanup, then build integrated package. Web source text changes require a separate Web publication to appear on the server.
