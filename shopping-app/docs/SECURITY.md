# Deployment threat model and security gates

Assets: session/identity/MFA tokens, customer delivery/support data, inventory, financial records, encryption/backup keys and operator access. Boundaries: browser→TLS/auth proxy→app→database; privileged migrations; backup endpoint; GitHub artifacts/approvals. Primary threats include account takeover, cross-account access, request forgery/injection, inventory/payment replay, secret leakage, untrusted CI, data loss and accidental live activation.

| Threat | Controls present | Remaining validation |
| --- | --- | --- |
| Public preview misuse | Nginx authentication, loopback publication, demo notices, disabled orders/payments/COD | Real host/domain access policy, no customer data |
| Identity/privilege escalation | Scrypt, hashed cookies, revocation, one-use identity tokens, server OWNER+TOTP | Actual HTTPS/email/recovery operator review |
| Request forgery/injection | Canonical Host/Origin, JSON guards, parameterized SQL, bounded bodies, safe DOM/CSP | Independent penetration/abuse review |
| Proxy/header spoofing | Proxy overwrites forwarded headers, strips preview auth, app ignores forwarded IP | Edge/actual trusted-client-IP plan for scale |
| Financial/inventory replay | Transaction locks, idempotency, signed webhooks/refunds, reservation expiry | Owner-selected provider sandbox and real settlement |
| Container compromise | Non-root app/proxy/database, capabilities dropped, read-only roots, resource caps | Current image scan, patch cadence, host hardening |
| Database privilege misuse | App lacks DDL; separate migrator and read-only backup roles; no public port | Actual deployment grants, private DB TLS/host controls |
| Data loss/exposure | Separate GCM backup key, authenticated TLS upload/readback, empty-target restore gate | Real off-server account, retention/key escrow, restore/RPO tests |
| Supply chain/deployment | Lockfile, pinned images/actions, PR tests, required-reviewer precheck and manual release | Actual GitHub run/protection settings, approved registry and host access |

The database is private but local Compose PostgreSQL transport itself is not TLS-configured; host/network administrators are trusted in this single-host preview. Managed/separated production PostgreSQL must use verified TLS and least-privilege access. File secret mounts and receipts trust the approved operator/Docker host. They are not an independent approval-signature system.

Nginx logs request ID/method/status/duration without paths/query/body/cookies/auth. App errors log safe request IDs/codes. Rate limits exist at proxy and shared DB; proxied clients share the app's socket-IP bucket. Do not trust arbitrary forwarded IP headers to bypass that limit. TLS fixtures keep verification enabled; real certificate issuance/renewal is still unverified. No uploads, card storage or default owner password are added.

Owner must approve statutory retention/erasure/legal-hold, key rotation, MFA recovery, real catalog/tax/returns policies, incident response and independent security assessment before production. The full checklist is in RELEASE_CHECKLIST.md. Passing automated tests or npm audit is not a security warranty.

## Verified candidate scan remediation

All four freshly built images report zero vulnerabilities at every reported severity in image-scans-verified.json. Initial verification found1 CRITICAL/25 HIGH in the PostgreSQL base's Go-based gosu binary (also inherited by operations); the database now starts directly as UID70 and the unused helper is removed. Operations stays UID1000. The proxy had1 CRITICAL/2 HIGH in Brotli/curl; unused dynamic modules and curl were removed using offline apk dependency removal. Core TLS/HTTP remains. This removes unneeded runtime components rather than excluding findings. Trivy0.67.2 warns Alpine3.24 is absent from its lifecycle list; analysis completed, but independent review and ongoing scanning remain required. No real public-host security acceptance is implied.
