# FRP pinned HTTPS implementation plan

**Goal:** Move the official public entry from 104 to https://118.193.36.35:8443, using user-approved self-signed HTTPS with exact Electron certificate trust. No VPN dependency.

**Architecture:** FRP TCP transparently carries TLS to a dedicated 202 nginx loopback listener (9443), avoiding IP/SNI ambiguity without replacing the legacy certificate. Electron accepts the exact leaf DER SHA-256 only at the official hostname/port while valid; normal PKI remains for other hosts. The portless session hook only rejects substituted certificates, never grants trust; the URL-aware app callback grants HTTPS/WSS exceptions. Never add a global bypass. Preserve custom stored URLs; migrate only the old official desktop URL.

**Threat model:** Assets are meeting credentials/media and stored client identity. Network attackers must not substitute certificates or reuse the pinned certificate at unrelated origins. Trust boundary is Chromium TLS verification; session verification must cover nested frames/WebSockets and app callback must fail closed. Private key stays on 202. Residual risks: manual pin rotation, browser users need explicit trust, private-key compromise requires new package/pin, FRP UDP needs measured media acceptance.

1. Add failing tests for URL migration and exact host/port/fingerprint/validity trust; inspect removal of global switches/callback. Run node --test scripts/server-trust.test.cjs.
2. Generate new SAN IP certificate and key under a dedicated root-only directory on 202; fetch public certificate only and record fingerprint. Create pure server-trust module, install session verifier before window creation and strict app callback; update default URL and migrate official saved URL only.
3. Add a dedicated 118 nginx server using the existing gateway location routes; test nginx before reload. Preserve old virtual host and backup configs. Verify correct certificate over FRP. No TCP 80 or ACME.
4. Back up Jitsi .env, inspect current bridge conference count, set PUBLIC_URL and JVB_ADVERTISE_IPS to new entry, recreate only necessary web/JVB services when idle. Preserve independent VPN.
5. Update Web .env and same-origin selection with explicit new-origin authorization, run build, deploy backed-up static assets, verify actual served assets/origin. Update outdated workspace topology documentation.
6. Run regression/security tests and real Electron fresh/saved-config HTTPS probes, including a negative certificate case. Rebuild installer. Report remaining multi-party media/ICE limitations without claiming successful acceptance.

Rollback: restore nginx configuration and .env backups/recreate affected Jitsi services; retain old Web assets and installer. Do not discard unrelated repository changes. This plan executes directly in the current session; no subagents or automatic unrelated commits.
