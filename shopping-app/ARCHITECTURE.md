# NovaCart application architecture (design baseline)

## Product decisions
India-first, single-seller general shopping catalog for initial release. Multi-vendor settlement is explicitly out of scope until requested. Premium design. INR only. COD and online payment will be selectable only after business-rule and provider integration validation.

## Recommended production application stack
- Web: Next.js App Router + TypeScript, accessible server-rendered catalog pages
- API: Next.js route handlers or separately deployable TypeScript service; shared Zod validation
- Database: PostgreSQL with migrations and parameterized queries/ORM
- Sessions: secure HttpOnly/SameSite cookies, short-lived sessions, password hashing with Argon2id, rotating session identifiers
- Storage: private object storage for originals, generated optimized images and expiring upload URLs
- External services: payment provider (signed webhooks), shipment aggregator, transactional email/SMS. All behind adapter interfaces
- Logging: structured audit events with PII redaction, stable request IDs

## Domain rules
1. Never trust browser prices or stock; server recalculates totals from active SKU variants.
2. Use paise integers for money and record tax, discount and shipping separately.
3. Reserve stock within a database transaction and release reservations on timeout/cancellation.
4. Use a unique idempotency key per checkout and refund attempt; verify webhook signatures on raw payload.
5. Enforce owner/staff authorization on every privileged API route, not just the UI.
6. Store immutable address and product-price snapshots on orders.
7. Use explicit legal order-state transitions and append-only audit events.
8. Encrypt/limit personal data, implement export/deletion and retention policies.
9. Never collect card numbers directly; redirect or use hosted gateway components.
10. No real orders, payments, or account registration from the static demo.

## Routes (20 planned screens)
Home /; Categories /categories; Product /products/[slug]; Search /search; Cart /cart; Checkout /checkout; Login/Register /account/auth; Account /account; Orders /account/orders; Tracking /account/orders/[id]; Wishlist /account/wishlist; Returns /account/returns; Support /support; Offers /offers; Reviews /products/[slug]/reviews; Policies /policies; Admin Dashboard /admin; Master Product Control /admin/products; Order & Shipping /admin/orders; Admin Settings /admin/settings.

## API surface (planned, not implemented)
GET /api/products; GET /api/products/:slug; POST /api/auth/register; POST /api/auth/login; POST /api/auth/logout; GET/PUT /api/cart; POST /api/checkout/quote; POST /api/orders; POST /api/payments/session; POST /api/webhooks/payment; GET /api/me/orders; POST /api/returns; GET/POST /api/admin/products; PATCH /api/admin/variants/:id; GET /api/admin/audit.

## Acceptance strategy
Each route must have authenticated/unauthenticated, invalid-input, accessibility and responsive checks. Payment and stock flows additionally require race-condition, duplicate-webhook, partial-failure, refund and retry tests. Real integrations remain disabled until validated with provider sandbox accounts.

## Current state
The root index redirects to a standalone frontend prototype in shopping-app/. This architecture is a target design, not an implemented backend. The SQL schema is a first draft, not an applied migration.
