# NovaCart release and operations handoff

## Verdict

**Do not deploy for real commerce yet.** The integrated development shopping journey and automated local acceptance are verified. Production policy, live service accounts, settlement, courier integration, statutory invoices/retention, operational controls and environment validation remain outstanding. No production database, deployment, cloud resources, DNS or CI/CD was modified.

## Reproduce local evidence

Use Node 24 and the committed npm lockfile. From `shopping-app/backend`, run `npm ci`, `npm run check`, `npm test`, then `npm run test:all`. The latter owns its fresh Docker PostgreSQL 16 databases and app listener, executes integration/browser/audit/recovery checks and cleans them up. See the backend README for explicit `$` shell commands and interactive development setup. Do not use real data or an existing database for these commands.

`docs/qa-summary.json` is the sanitized recorded run. Raw TAP, browser JSON, logs and screenshots stay ignored in `backend/test-artifacts/`. Test counts are broad scenarios with many assertions, not the number of individual features. axe covers selected active screens; it is not a complete accessibility certification. Chromium desktop/mobile emulation is not real iOS Safari/Firefox testing. Local navigation/resource measurements are unthrottled loopback samples, not production Core Web Vitals or capacity claims.

## Security review and remaining operational requirements

Implemented: server ownership/OWNER gates, production owner MFA freshness and TOTP replay prevention; scrypt; hashed revocable sessions/tokens; one-use verification/reset; same-origin cookie mutation guards; shared PostgreSQL abuse counters; parameterized SQL; bounded requests; safe text rendering/CSP/headers; encryption of delivery/MFA/mail payloads; audit records; idempotent stock/payment/refund intents; least-data error logging and dependency audit.

Open requirements before public exposure:

- Approve seller structure, GST/tax/rounding, invoice numbering and mandatory fields. Current zero-tax pricing and development PDF receipts are not statutory invoices.
- Approve PIN coverage, cash limits, shipment provider, return/refund windows, loyalty and credit rules. Manual tracking and cash references are owner assertions, not independently confirmed money movement/delivery. Purchased gift instruments and redeemable loyalty economics are not approved.
- Approve real catalog, licensed product photography, business identity/contact, terms/privacy/cookie/returns policies. Demo SVGs and fictional products must not become real claims.
- Configure secrets through owner infrastructure, strict database TLS/access control, HTTPS termination and canonical Host/Origin. Test Secure `__Host-` cookies on that actual HTTPS origin. The app binds loopback deliberately; expose it only through an owner-reviewed arrangement.
- Add deliberate trusted proxy addressing and edge abuse controls. PostgreSQL limits are shared; untrusted forwarding headers are ignored. Verify scrypt resource/capacity behavior and expensive public reads under realistic load.
- Approve financial/audit/backup retention and erasure/legal-hold policy; implement the resulting cleanup schedules. Current maintenance removes old expired identity/session/counter rows only. Guest capabilities expire but guest financial records are retained. No statutory retention period is invented.
- Establish key versioning/rotation and restore tests. Single application encryption key is a development baseline. Do not rotate by replacing the key without a reviewed re-encryption/multi-key migration.
- Decide owner MFA recovery/provisioning with controlled identity verification. No insecure public MFA bypass or public owner registration exists. Dev provisioning is explicitly blocked in production.
- Run independent security review, platform/browser/accessibility acceptance, representative load and backup/restore validation. `npm audit` is a dated dependency check, not a penetration test or security warranty.

## Payment sandbox validation (owner account required)

Inject `RAZORPAY_KEY_ID` starting `rzp_test_`, its secret and an independently configured webhook secret through a private environment binding. Online payments require configured keys; the client loads the official hosted SDK lazily. Set sandbox webhook URL to `/api/webhooks/razorpay` on an owner-controlled HTTPS test origin. Enable required capture/failure/refund events and preserve the event ID header. Never paste secrets into chat/logs.

Use provider-issued sandbox test instructions for UPI, cards and netbanking. Verify pending/failure/capture, delayed and duplicate webhook delivery, amount/currency mismatch rejection, stock expiry followed by late capture, cancellation, partial/full refunds and settlement reconciliation. Store provider evidence without sensitive payment data. A client callback only requests status polling; signed events establish payment state. No card numbers/CVV are stored here.

A provider request with an uncertain result becomes UNKNOWN. **Do not reset/retry it blindly**: inspect provider records and bind the exact order/receipt/currency/amount through the reconciliation operation. Unknown refund creation requires provider investigation; there is no button that fabricates success. Confirm current Razorpay account/API semantics in sandbox, especially hosted checkout permissions and event shapes. Mocks verify local contracts, not account integration. Live activation needs separate explicit authorization after all gates pass.

## Mail and fulfillment

Configure TLS SMTP and approved `MAIL_FROM`, then verify real inbox delivery of verification/reset and opted-in recovery. Outbox PENDING is not delivery; SENDING/UNKNOWN after a crash or ambiguous provider response needs investigation before a manual retry. Consent is checked again at send time. In-app notifications work independently. No SMS/push or independent courier API adapter has been verified or implemented; selecting a courier is a genuine remaining integration decision.

Owner workflow: inspect order → PACKING → SHIPPED with actual provider/tracking → DELIVERED with explicit cash collection if COD. Inventory is consumed at shipping; repeated/illegal transitions fail. Review returns before approval; receive/restock only after physical inspection. Initiated refunds are not completed refunds. Confirm cash payouts externally and record a reference; provider refunds finish from verified events. Compare recorded payment/refund IDs to provider settlements; operational dashboard totals are not audited revenue.

## Database and recovery

Migrations 1–4 were applied and repeated safely on new disposable PostgreSQL 16 databases. v3 adds commerce/security tables; v4 adds operational fields/indexes and consent aggregates. Demo migrate/seed/provision scripts refuse production mode. They are not a production migration runner. Do not disable those guards to deploy.

Owner release proposal must include a reviewed least-privilege migration role, restore-tested backup, extension availability (`pgcrypto`, `pg_trgm`), production migration plan, data/constraint validation, encrypted-field backfill where required, lock/statement timeout analysis and forward-fix rollback plan. Some additive actor constraints are NOT VALID for legacy compatibility; validate actual legacy rows before promoting them. No destructive down migration/reset is provided. An existing database must be assessed separately; tests prove fresh databases only.

Runtime `/api/health` checks PostgreSQL and returns 503 during loss. SQL connection/statement/query timeouts bound failures; idle pool errors log sanitized codes. A read-only pause/resume fault of the owned test database verified 503 then 200. This is not a backup recovery test. Follow real provider/db restore procedures owned by infrastructure. Graceful SIGTERM stops listener/jobs and closes the pool. Do not delete/reseed data to repair an outage.

## Release gates and ownership

Application delivery: review this branch/PR, source, tests, API and acceptance ledger. Owner: approve business decisions, supply sandbox accounts privately, commission legal/security acceptance and arrange infrastructure/CI/CD/domain/backup/monitoring. No automatic deployment is included. Required final gate is evidence from the intended HTTPS deployment and provider sandboxes, followed by separate live activation authorization. Open items remain visible in PROGRESS.md; no percentage substitutes for these gates.
