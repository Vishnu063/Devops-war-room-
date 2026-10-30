# NovaCart application architecture

NovaCart currently implements a single-seller India/INR development store. Business structure, GST, fulfillment coverage, return terms and production content need owner approval. No real transactions or deliveries have been verified.

## Implemented stack and boundaries

Node.js 24 ES modules serve a same-origin vanilla JavaScript storefront and owner console, plus JSON HTTP APIs. PostgreSQL 16 holds catalog, identity, sessions, commerce and operational records. Keeping this working stack avoids a framework rewrite. Business functions are separate from HTTP routing. `ui.js` and `forms.js` share safe DOM rendering, errors and validation. No frontend authentication tokens are stored in localStorage.

- `server.mjs`, `http.mjs`, `*-routes.mjs`: bounded requests, origin and cookie checks, headers, static allowlist, safe errors, request IDs and HTTP timeouts.
- `auth.mjs`, `sessions.mjs`, `identity.mjs`: scrypt hashes, hashed session/identity tokens, one-use verification/reset, session revocation, encrypted owner TOTP and replay prevention. Production privileged actions require recent MFA.
- `repository.mjs`, `catalog-admin.mjs`: parameterized catalog reads, variants, availability, scheduled pricing, categories, local/allowlisted image references and explicit bulk-row outcomes. No upload endpoint.
- `shopping.mjs`, `pricing.mjs`, `commerce.mjs`: customer/guest ownership, merge, integer paise, server prices, sorted row locks, per-principal idempotency, reservation/cancel/expiry and encrypted address snapshots.
- `payments.mjs`, `fulfillment.mjs`: explicit state transitions, signed raw-body Razorpay events, uncertain external intents, bounded refunds, manual fulfillment and cash-payment assertions. No card data enters this app.
- `customer.mjs`, `business.mjs`: moderated delivered-purchase reviews, Q&A, consent, support, store credit, CMS and real database reporting.
- `jobs.mjs`, `mail.mjs`: bounded maintenance and encrypted outbox. Unknown sends require investigation; they are not blindly retried. SMTP absent means BLOCKED, never SENT.
- `seo.mjs`: escaped product-specific metadata, sitemap and opt-in indexing. Product data still requires JavaScript for the full interactive page.

## Data and transaction rules

All money uses integer paise. Browsers supply variant IDs and quantities, never authoritative prices. Checkout locks the principal, then sorted variants; inventory cannot be overreserved. Idempotency binds the same key to the same payload and actor. Reservations expire after the configured application window; captured late payments create refund intents instead of releasing goods. Online payment is PAID only after a verified provider event. COD delivery requires an explicit owner cash reference.

Addresses, order delivery snapshots, MFA secrets and mail payloads use AES-256-GCM with purpose-specific associated data. Losing the private encryption key loses access to those records; key rotation and backup controls require an owner-approved production procedure. Financial and audit rows remain pseudonymous after customer erasure; this does not settle statutory retention obligations.

Migrations 1–4 are tracked and transactional under an advisory lock. Scripts are development guarded and were exercised only on new disposable databases. Applied migrations must remain immutable; add forward migrations for corrections. See `docs/HANDOFF.md` before any production migration proposal.

## Deliberate limits

The in-memory catalog/rate limiter is compatibility/demo mode only. Database mode uses shared PostgreSQL limits; the application does not trust forwarded client-IP headers. A reverse proxy therefore needs a deliberate trusted-client-address design and independent edge limits before public exposure. Image hosting, SMTP, payment settlement, courier dispatch, tax and production backup operations are external boundaries. No external account, legal policy or production SLO is inferred from local tests.
