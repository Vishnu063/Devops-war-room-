# NovaCart deployment audit

Assessment: 30 October 2026 (India). Base: integrated commerce branch `5d9d760` plus current main `d0e8450`, reconciled in `2b5fed8` on `feat/novacart-deployment`. This handover's description of main was accurate for main but omitted the substantial separately published commerce branch. No uncommitted user work was present before reconciliation.

## Feature matrix

| Area | Observed implementation | Remaining acceptance |
| --- | --- | --- |
| Catalog/discovery | PostgreSQL pagination, variants, images, indexed search, detail, Q&A/reviews/comparison | Real licensed catalog and wider UX/crawl acceptance |
| Identity | Scrypt, hashed revocable sessions, verification/reset, owner TOTP and role gates | Actual mail, controlled production owner recovery and independent review |
| Cart/checkout | Guest/account persistence/merge, encrypted addresses, integer paise and idempotent orders | Approved PIN/COD/tax/invoice policies; live orders disabled in deployment |
| Inventory/orders | Transaction locks, reservation/expiry, history, manual fulfillment and return/refund | Courier account, physical operations, real settlement/reconciliation |
| Payments | Optional pre-existing Razorpay adapter, signed duplicate-safe callbacks and mocks | Owner provider selection and actual sandbox verification; no provider enabled |
| Operations/privacy | Support, notifications, consent, exports/erasure, CMS, credit/audit/reporting | Legal retention, content and financial policy; real SMTP/SMS |
| Deployment | Previously no container/Compose/HTTPS/CI artifacts | New configurations and local acceptance described in DEPLOYMENT.md |

## Defects found and addressed

Main and commerce diverged with conflicts in app.js/server.mjs. Keeping the integrated implementation and delegating main's `findProductById` compatibility entry to the existing detail service preserved both behavior and identifier-validation tests. The automatic merge's extra implementation referenced a removed `baseSelect`; that broken duplicate was replaced.

Loopback-only binding prevented private container networking: explicit validated `BIND_HOST` now permits container binding while local default stays loopback. Production-style preview has explicit disabled order acceptance, and preview cannot enable live payments. Mounted secret files load before module configuration. Release migrations are separate from startup and reject absent/stale/unverified backup receipts or changed checksums.

Test setup exposed sandboxed OpenSSL/socket restrictions and VFS disk pressure from repeated image builds. Fixture TLS generation requires the normal execution environment; exact obsolete NovaCart image/cache records were reclaimed without pruning unrelated projects. A backup fixture initially inherited the app health check; it now has a dedicated listener readiness check. Docker-injected HTTP proxy settings redirected a loopback wget health probe; that owned loopback probe explicitly uses a local connection while external proxy settings stay unchanged. Cross-UID secret/init permissions and an export command that masked password-read errors were corrected; initialization now fails closed. Node fetch ignored custom Host headers, so internal health/monitor requests use explicit HTTP/HTTPS request APIs. Failed attempts are not counted as passing evidence.

## Runtime and host facts

This executor is Debian13/x86_64 with Node24.19.0, Docker28.4.0 and Compose2.40.3. Initial visible resources were about33GiB memory, five CPUs and14GiB free on a32GiB filesystem. These are managed-workspace observations, not EC2 capacity measurements. No deployment server, domain, DNS account, SSH identity, production secrets, registry authorization or off-server backup account is configured. Ports80/443 and existing websites on the eventual server have not been inspected.

## Deployment blockers and recommended order

1. Review/reconcile application and run existing acceptance before exposing a preview.
2. Verify containers, separate migrations, encrypted restore, HTTPS cookies and disabled-commerce gates locally.
3. Owner chooses server/access, origin/certificate process, approved registry, off-server backup transport and alert destination. Inspect that host read-only first.
4. Owner configures protected GitHub environments/reviewers and least-privilege credentials; actual Actions execution must succeed.
5. Deploy an access-restricted fictional preview with no real transactions. Validate real certificate renewal, external backups, alerts and prior-version rollback.
6. Production requires the separate business, security, payment, tax/legal and explicit launch gates in RELEASE_CHECKLIST.md.

Detailed application statuses remain in PROGRESS.md. A passing local configuration/test is not a public deployment or production acceptance. See deployment-summary.json and application-qa-summary.json for the recorded final evidence when present.

## Container scan finding

The initial Debian12 runtime scan reported5 CRITICAL and77 HIGH findings (OS packages and bundled npm dependencies). This differs from npm audit of application dependencies, which previously reported zero. See image-scan-initial.json. The runtime was changed to a digest-pinned official Alpine Node24 image, unused npm/yarn removed, and operations/database moved to a pinned PostgreSQL16 Alpine image. Final scanner evidence must be recorded separately; no finding is waived and the CI gate still blocks HIGH/CRITICAL, including unfixed findings.

## Final evidence and remaining blockers

The application suite passed68 unit/API tests,9 PostgreSQL scenarios and4 Chromium journeys, plus static/audit/outage checks. Baseline container acceptance completed16 checks (including encrypted populated restore, GCM rejection, canonical HTTPS, cookies, disabled orders, private ports, actual monitor and outage/recovery). See application-qa-summary.json and deployment-summary.json. The baseline used the prior Node24.19 candidate; it is not labelled as final security-candidate acceptance.

The final Node24.22.2 app/operations/proxy images built successfully. The final app scan reports zero vulnerabilities at all reported severities (image-scan-final.json), after the original5 CRITICAL/77 HIGH Debian findings and the intermediate two OpenSSL HIGH findings. The final operations scan failed while exporting its layer due to disk exhaustion; proxy/database scans were not reached. CI gates all four images with no HIGH/CRITICAL exceptions. No overall security-clean claim is made.

Full final-candidate container retesting reached empty encrypted backup/restore, then PostgreSQL reported disk exhaustion during migration. This32GiB VFS workspace has insufficient free space. The runner now preflights space and includes all optional profiles during cleanup; an orphan test monitor was removed after verifying its exact ownership. Broad build-cache cleanup was rejected automatically because generic selectors could affect unrelated projects; those records were preserved. Only positive NovaCart ownership evidence and task-owned public scanner cache were used for cleanup. Additional free verification storage or approved removal of other unused build cache is required.

AWS access is independently blocked: this task has no configured AWS identity or secrets and its connection manifest is empty. No EC2 host/IP/domain was invented or reached. No public preview, DNS/firewall/routing change, production migration, live payment or additional cloud spend occurred.
