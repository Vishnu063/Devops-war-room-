# NovaCart website audit and launch preparation

Assessment:30 October2026 (India). Branch:`feat/novacart-deployment`, baseline:`d03e897`. **Locally verified fictional preview candidate; not production-ready. No public HTTPS URL verified.** Scope: frontend components/routes, backend service and HTTP boundaries, existing SQL/API scenarios, expanded browser journeys, container/HTTPS/backup/recovery acceptance and all4 candidate image scans. Coverage is listed explicitly; passing automation does not verify every possible interaction or external integration.

## Major feature audit

| Feature | Status | Changes / observed implementation | Executed tests | Remaining work |
| --- | --- | --- | --- | --- |
| Homepage, navigation and categories | VERIFIED LOCAL | Preserved design; mobile navigation available;3 distinct original category SVGs with truthful alt text | Guest journeys320/390/768/1280px, no overflow; image checks; mobile screenshot inspected | Owner content and licensed real catalog |
| Search/filter/sort/pagination | VERIFIED LOCAL | Stale responses/errors ignored; failed grid cleared; aria-busy, retry and clear filters; existing server search/pricing/pagination | Real SQL discovery plus browser failure/empty/retry | Representative large-catalog UX/load |
| Product detail and variants | VERIFIED LOCAL | Sold-out options disabled, first available selected, add button follows selection; explicit accessible label | Browser mixed/all-sold-out variant fixtures; SQL variant/inventory tests | Thumbnail gallery implemented and browser-tested; real media approval |
| Product URLs/SEO | VERIFIED LOCAL | Existing deep link preserved; server metadata/canonical/escaping/noindex | New direct slug URL browser regression; SQL SEO escaping | Crawl acceptance and final public origin |
| Images/cards/touch targets | VERIFIED LOCAL | Safe illustration fallback on broken product images; aligned card controls; larger44px wishlist/action targets | Browser broken-image fixture;4 viewport no-overflow and axe-tested views | Product illustrations remain placeholders; not real photographs |
| Cart and wishlist | VERIFIED LOCAL | Persistent guest/customer/merge; quotation failure retains removal controls; rejected quantity restored | SQL persistence/merge; reload/wishlist and new quote-conflict recovery browser test | Wider manual UX acceptance |
| Comparison/reviews/Q&A | VERIFIED LOCAL | Existing comparison and delivered-purchase moderation preserved; no fabricated live reviews | SQL and customer browser submit/owner moderation/compare | Real moderation operations and content |
| Registration/login/account | VERIFIED LOCAL | Capture submitted form before awaits, safely reset after sign-in; role/session boundaries preserved | Browser reset regression, SQL roles/revocation/expiry | Independent review/recovery operations |
| Reset/verification/MFA | VERIFIED CONTRACTS | Hashed one-use identity tokens, revocation, owner TOTP/replay/freshness | SQL reset/verify/owner MFA and unit tests | Actual email delivery and controlled owner recovery; not all flows browser-tested |
| Checkout and pricing | VERIFIED LOCAL | Shared release policy reports ordersEnabled; submit disabled until capability load; clear preview-unavailable message; server enforcement unchanged | Unit policy matrix, real SQL integer-paise/idempotency/discounts; browser disabled checkout; production-style HTTP503 gate | Approved tax/COD/payment policies and launch approval |
| Saved addresses | VERIFIED LOCAL | Encrypted account address book, ownership guards and selectable checkout addresses with manual-entry fallback | SQL ciphertext/ownership plus browser saved-address selection and field population | Actual address/delivery policy |
| Orders/history/cancellation | VERIFIED LOCAL | Atomic inventory reservation, immutable snapshot, idempotency, owner-only operations |9 SQL scenarios include last-unit concurrency, duplicate requests, ownership/cancel; customer/guest browser | Real commerce authorization and reconciliation |
| Shipping/tracking | VERIFIED MANUAL CONTRACTS | Owner PACKING/SHIPPED/DELIVERED, carrier/reference and customer timeline | SQL and customer browser shipment lifecycle | Courier account, dispatch and actual deliveries |
| Returns/refunds | VERIFIED LOCAL CONTRACTS | Partial returns, review/restock, credit/refund intents and state safety | SQL duplicate/partial/cash/provider-mock cases; browser request | Real provider refunds/settlement and approved policy |
| Payments | MOCK VERIFIED/BLOCKED | Signed webhook/provider abstraction; live payment activation remains separately guarded | Unit and SQL mocked signed/replayed/late/amount/refund cases | Authorized sandbox account and actual UPI/cards/netbanking evidence |
| Owner products/inventory/pricing | VERIFIED LOCAL | CRUD/publication/variants/scheduled prices/images/bulk and audit preserved | SQL owner-denial/reservation guards and desktop owner browser | Broader mobile owner-panel/manual coverage; actual business data |
| Coupons/credit/analytics/CMS | VERIFIED LOCAL CONTRACTS | Quotas/credit redemption/consent/reporting/owner content | SQL promos/privacy/CMS/reporting and owner analytics browser | Financial/legal rules and real campaign data |
| Notifications/support/privacy | VERIFIED LOCAL CONTRACTS | In-app support/notifications, preferences, encrypted mail outbox, privacy export/erase | SQL ownership/consent/erasure; customer support browser; mocked SMTP | Actual SMTP/inbox, optional SMS/push, retention/legal policy |
| Security/reliability | VERIFIED LOCAL CONTROLS | Same-origin mutations, parameterized queries, safe DOM, secure cookies/MFA, DB throttle, private DB, caps/headers preserved |70 unit/API,9 SQL scenarios,10 browser journeys,17 container checks; all4 scans0 findings | Independent security review, broader abuse/load, actual host controls |
| Deployment/backup/rollback | VERIFIED LOCAL/BLOCKED EXTERNAL | Current app/operations freshly built; all4 image IDs match scans; local HTTPS access restriction, encrypted restore, monitoring and distinct prior-image rollback |17 checks passed; all candidate image scans0 vulnerabilities | AWS connection, public TLS/renewal, real offserver storage/alerts and target rollback |

## Issues fixed

1. Async sign-in used event.currentTarget after awaiting (null after dispatch); retain the form reference so successful sign-in resets it without a hidden error.
2. Catalog failures left stale purchasable-looking cards; clear them, disable paging, expose a retry and loading state, and ignore stale failures/responses including the search debounce window.
3. No direct empty/filter reset action; add Clear filters without changing server filters/sort.
4. A sold-out first variant stayed selected even when others were available; disable unavailable options and select an available variant, with an explicit accessible label and matching add state.
5. Broken product image URLs had no fallback; use the existing local illustration with loop protection.
6. Failed cart quotes replaced the item list and prevented removal; retain items/removal and show the quotation error in the footer. Restore rejected quantity input to the server-backed value.
7. Preview checkout appeared actionable despite disabled server commerce; expose a shared ordersEnabled policy, keep submit disabled until capabilities load, and explain the unavailable state. Server-side enforcement remains authoritative.
8. Mobile navigation was hidden; expose touch-friendly links while preserving actions and responsive layout. Card controls gain consistent spacing/targets.
9. Category tiles reused the same interior illustration with mismatched descriptions; replace with3 original category illustrations. Product photos are still explicitly fictional placeholders, not invented real merchandise.

Product deep links were initially suspected during the audit but were already implemented at the end of startup. No speculative route rewrite was made; a direct URL regression now verifies the existing behavior.

10. Complete the identified checkout-address gap: load the signed-in account address book, populate validated address fields on selection, preserve manual entry and pending-request protection.
11. Complete the detail-gallery gap: accessible thumbnail controls switch the main image and expose selected state; browser fixtures verify the interaction without inventing real product photography.

## Executed evidence and failures

Fresh application run: **70 unit/API passed,9 PostgreSQL scenarios passed,10 Chromium journeys passed;0 final failures/skips**. Static HTML/ESLint and dependency audit passed. axe found0 violations on tested storefront/account-support/product/owner views; it is not exhaustive accessibility certification. Guest purchase/cancel runs at320,390,768 and1280px; owner workflow is desktop. Additional journeys cover recovery/error/empty states, variants/gallery selection, shared product URL, saved checkout addresses and cart quotation conflict. Variant states and preview capabilities in dedicated browser negatives are mocked responses; checkout/inventory/ownership paths also have real SQL/API coverage.

The first expanded run failed an exact implicit-label lookup; an explicit accessible label fixed it. The next failed because the framework's disabled-state matcher treated an option with its native disabled property set as enabled; the regression now checks the actual DOM disabled property. Final full application rerun passed10 browser tests. These failed attempts are not counted as passing results.

Current candidate deployment: **17 checks passed**, including real production-style order503/capability=false, private ports, nonroot DB, encrypted empty/populated restore/readback, checksum/tamper rejection, actual local monitor firing/resolved, previous-image rollback and candidate roll-forward. All4 exact image scans report **0 CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN** with no severity exceptions. Trivy0.67.2 warns Alpine3.24 is absent from its lifecycle list; analysis completed. External gateways/mail/courier and same-host mock backup are not real integrations. Reports: application-qa-summary.json, deployment-summary.json and image-scans-verified.json. Test resources were cleaned up.

## PR #2 and mergeability

https://github.com/Vishnu063/Devops-war-room-/pull/2

The accessible PR webpage explicitly marks #2 **Draft** (observed before this audit push). Draft status is a confirmed merge blocker. Its fetched head matched local baseline d03e897; current main was already an ancestor, and git merge-tree completed cleanly. No actual branch conflict was found, so no merge/history rewrite was needed. No review was listed on the accessible page. The current proxy blocks api.github.com; the webpage does not expose check/branch-protection details to this session. Additional required checks/approvals remain unverified. Draft status was preserved; no ready-for-review action, merge, force push or protection change was performed. After reviewing this audit, the owner can mark it ready and satisfy repository checks/approvals.

## Preview connection and launch dependencies

Current environment reports no authorized AWS identities, secret bindings or connection entries. No EC2 address/domain was guessed or contacted. Attach the AWS connection through environment settings with read-only STS/EC2 discovery and approved SSH/SSM access to the discovered instance. ENVIRONMENT.md has exact discovery/host commands; DEPLOYMENT.md has private Compose/migration instructions. Username ubuntu must be confirmed from the actual AMI/configuration. Keep existing applications intact. No public URL is verified.

Before a public preview: inspect actual EC2 OS/capacity/ports/containers/Nginx, use a verified owned NovaCart subdomain or propose a restricted secure temporary tunnel, and configure real certificate/renewal, offserver backup/readback/restore and external monitoring. Stop for explicit approval before changing public DNS/firewall/existing routing or incurring charges. No credentials are requested in chat.

Before real customers: approved catalog/media, seller/legal/privacy/retention/contact/return rules, GST/statutory invoices, gateway sandbox and live activation approval, actual mail/courier, reconciliation, broader owner/browser/manual accessibility/load acceptance and independent security review. Saved-address selection and the multi-image detail gallery were completed during this audit and browser-verified; production readiness is not claimed. Real orders/payments remain disabled in the preview configuration.

## Local commands and final operator state

```bash
$ cd /workspace/Devops-war-room-/shopping-app/backend
$ npm run check
$ npm test
$ npm run test:all
$ npm run test:deployment -- --reuse-images --rollback-image=sha256:8b45869999d8be6d528e9cdc68cede2a66372dec022d1ae8188229a870538bb5
```

The last command was executed after freshly building the current app/operations source; unchanged database/proxy IDs were also rescanned. Image IDs, actual rollback pair,17 passing checks and cleanup are recorded in deployment-summary.json. A fresh machine must build the exact current images first (DEPLOYMENT.md); do not assume that retained prior fixture image exists. Default full-build runner requires12GiB free with VFS, versus3GiB for explicit image reuse. About3.9GiB remained after final cleanup; a new all-in-one VFS rebuild would need about8.1GiB additional free space. All owned test containers were removed. Tracked credential-pattern scanning found0 matches, with no values printed; this is limited detection. No source reset, force push, production data deletion or unrelated resource cleanup occurred.
