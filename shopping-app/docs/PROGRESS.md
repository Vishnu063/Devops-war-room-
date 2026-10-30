# NovaCart delivery ledger

Branch: `feat/novacart-commerce`. Base audited: `174f1ea`. Follow the repository's exact ROADMAP.md; the handover's shorter descriptions do not replace its additional acceptance criteria. Milestones are recorded by descriptive commit in `git log`; this ledger is updated with implementation evidence rather than speculative percentages.

## Audited foundation — 2026-10-30

- Node 24.19.0, PostgreSQL 16 (new disposable labelled database only).
- Existing unit/HTTP tests: **59 passed**, zero skips/failures.
- New real PostgreSQL acceptance: **1 passed**. Executed migrations twice, fictional seed, customer registration (no privilege escalation), owner registration/provisioning/login, draft/publish/price/stock changes, server-side quote, audit records and logout/revocation.
- No production database, infrastructure or deployment changed. Lockfile now records actual dependency resolution; use npm ci for subsequent installs.
- No provider credentials or mail transport are configured. Live payment/email/shipping verification will remain BLOCKED unless supplied securely; adapter and local workflow work can continue.

| Step | Status | Scope / acceptance still required | Relevant files / evidence |
| --- | --- | --- | --- |
| 01 | IN PROGRESS | Single-seller India/INR baseline exists; owner must approve tax, return, fulfillment and legal rules | ARCHITECTURE.md; production policy decisions remain open |
| 02 | IN PROGRESS | Reconcile 20 screens and exact 40-feature acceptance; document journeys | ARCHITECTURE.md |
| 03 | IN PROGRESS | Keep Node/PostgreSQL working architecture; clarify provider boundaries | backend/server.mjs, db.mjs |
| 04 | IN PROGRESS | Existing NovaCart tokens; distinguish fictional data and actual imagery | styles.css, DEMO-DATA.md |
| 05 | IN PROGRESS | Existing responsive prototype; integrated browser/a11y checks pending | index.html, app.js |
| 06 | IN PROGRESS | Existing modules tested; frontend integration/configuration still needed | backend/*.mjs; 59 tests |
| 07 | IN PROGRESS | Base/auth migrations executed and repeatable; additive commerce migrations pending | migrate.mjs, data-model.sql; PostgreSQL acceptance |
| 08 | IN PROGRESS | Prototype DOM components exist; shared API/loading/forms needed | app.js, admin.js |
| 09 | IN PROGRESS | Registration/login/session verified; verification/reset/revocation hardening pending | auth.mjs, sessions.mjs; PostgreSQL acceptance |
| 10 | IN PROGRESS | Owner catalog verified; MFA and broader administration pending | admin*.mjs; PostgreSQL acceptance |
| 11 | NOT STARTED | Persistent editable homepage/banners/content | Existing homepage is demo-only |
| 12 | IN PROGRESS | Database catalog/variants exist; detail, media and bulk operations pending | repository.mjs, admin.mjs |
| 13 | IN PROGRESS | Database search/sort/pagination exist; integrated UX and index checks pending | repository.mjs |
| 14 | NOT STARTED | Persistent details/reviews/moderation/Q&A/comparisons | Prototype modal only |
| 15 | NOT STARTED | Account-linked cart/wishlist/recent/recommendations | Browser storage only |
| 16 | NOT STARTED | Validated addresses, delivery policy, secure guest checkout | Quotes only |
| 17 | NOT STARTED | Provider abstraction, signed callbacks, COD and idempotency | Provider credentials absent; live activation BLOCKED |
| 18 | NOT STARTED | Atomic orders/reservations/state machine and invoices | Schema only |
| 19 | NOT STARTED | Manual/provider shipping workflow and notifications | Schema only; provider account absent |
| 20 | NOT STARTED | Cancellation/returns/refunds/reconciliation | Schema only |
| 21 | NOT STARTED | Coupons/credit/gift cards/loyalty/scheduled sales | Schema only |
| 22 | NOT STARTED | Consent/outbox/in-app notifications and optional email/recovery | Transport absent |
| 23 | NOT STARTED | Persisted support conversations and owner handling | Schema only |
| 24 | NOT STARTED | Actual analytics/exports/stock alerts/audit views | Basic audit rows exist |
| 25 | NOT STARTED | Product SEO, sitemap, CMS controls | Static metadata only |
| 26 | IN PROGRESS | Existing protections tested; shared rate limiting/MFA/security audit pending | security.mjs; 59 tests |
| 27 | NOT STARTED | Privacy export/deletion/consent/retention controls | No workflows yet |
| 28 | NOT STARTED | Browser responsive, accessibility and performance acceptance | Not executed yet |
| 29 | IN PROGRESS | Unit/HTTP + PostgreSQL foundation verified; commerce/concurrency/browser tests pending | backend/test/integration.test.mjs |
| 30 | NOT STARTED | Accurate API/run/recovery/release handoff | Existing docs correctly deny production readiness |

Roadmap checkboxes remain unchecked until each item's full acceptance is verified. IMPLEMENTED describes code present; VERIFIED requires executed acceptance including meaningful negative cases. External integrations are never inferred from mocks.
