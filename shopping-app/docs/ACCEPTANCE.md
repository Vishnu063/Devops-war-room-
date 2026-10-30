# Screen and feature acceptance map

Development baseline: single-seller India/INR, mobile-first, customers and one privileged OWNER role. No multi-vendor settlement. Owner approval of business/legal/financial rules remains pending. A screen may be a modal or owner tab; these are not 20 independently server-rendered pages.

## Information architecture: 20 screen groups

| # | Screen | Actual entry / navigation |
| --- | --- | --- |
| 1 | Home | `/`, editable homepage and campaign text |
| 2 | Categories | `/categories`, actual category navigation |
| 3 | Search | `/search`, debounced query, filtering, sort, page controls |
| 4 | Product | `/products/:slug`, details/variants dialog; product metadata on server |
| 5 | Cart | `/cart`, persistent drawer |
| 6 | Checkout | `/checkout`, validated development order form |
| 7 | Login/register | `/account`, shared auth dialog |
| 8 | Account/security | `/account`, identity, reset, MFA and session controls |
| 9 | Orders | `/orders`, actor-owned drawer |
| 10 | Tracking | Orders → View order, actual stored shipment |
| 11 | Wishlist | `/wishlist`, persistent drawer |
| 12 | Returns | `/returns`, delivered-order detail/request flow |
| 13 | Support | `/support`, private tickets and replies |
| 14 | Offers | `/offers`, current coupons; credit in account |
| 15 | Reviews/Q&A | Product dialog, moderated verified-purchase reviews/questions |
| 16 | Policies/privacy | `/policies`, explicit unapproved policy preview; account privacy controls |
| 17 | Owner dashboard | `/admin`, role-protected workspace and analytics tab |
| 18 | Product control | Owner catalog, categories, variants/sales/images/bulk JSON |
| 19 | Order operations | Owner Orders, Returns/refunds and Support tabs |
| 20 | Owner settings | Owner CMS/promotions; Account → Security and MFA |

Comparisons use explicit product checkboxes (2–4) and a comparison dialog. Account panels include notifications, addresses, consent, recent products, store credit and privacy. Route aliases open the same reusable components rather than duplicating state.

## Forty acceptance criteria

V = exercised by current local SQL/API/browser automation; I = implementation present with partial coverage; B = external approval/integration needed. V does not imply production readiness. Exact test files and remaining gaps are in PROGRESS.md.

| # | Criterion | Evidence / limit |
| --- | --- | --- |
| 1 | INR integer-paise server pricing | V: pricing tests, SQL checkout |
| 2 | Persistent active-only catalog | V: SQL and browser catalog |
| 3 | Categories and unpublished-product isolation | V: owner publication/API negatives |
| 4 | Search/filter/sort/pagination | V: database search, scheduled-price and page tests |
| 5 | Variant selection and stock guards | V: owner browser create, SQL reserved stock rejection |
| 6 | Safe image references and alt text | I: local illustrations, allowlisted HTTPS validation; production media B |
| 7 | Product details and server metadata | V: HTTP/SQL detail; escaped metadata implementation |
| 8 | Delivered-purchase reviews/moderation | V: SQL delivered review and moderation |
| 9 | Q&A and comparisons | V: submitted question/approved answer and comparison in browser and SQL |
| 10 | Persistent guest/customer cart | V: API, reload and browser purchase |
| 11 | Persistent wishlist | V: browser registration/reload |
| 12 | Guest-to-customer merge | V: real SQL merge and ownership |
| 13 | Consent-based recent and category suggestions | V: recent recording/clearing and category suggestion API; no invented AI/popularity |
| 14 | Registration with no role escalation | V: HTTP/SQL negatives |
| 15 | Login, expiry, revoke/logout | V: SQL session tests |
| 16 | Verification/reset one-use tokens | V locally; real SMTP delivery B |
| 17 | Owner backend role separation | V: customer/guest owner denial |
| 18 | Owner TOTP/replay/freshness | V: SQL MFA, missing/replayed code rejection |
| 19 | India address/PIN/guest checkout | V: SQL/browser; actual delivery area B |
| 20 | Idempotent order/changed-payload conflict | V: SQL duplicate and ownership checks |
| 21 | Last-unit concurrency and atomic rollback | V: two-principal race, no overreservation |
| 22 | Reservation expiration/cancellation | V: SQL expiry/release once and browser cancel |
| 23 | COD limits and recorded collection | V: explicit owner assertion; cash settlement B |
| 24 | Hosted Indian gateway session | I: official Razorpay abstraction/UI; sandbox UPI/cards/netbanking B |
| 25 | Signed event binding/duplicate rejection | V: mocked provider/raw HMAC + real DB |
| 26 | Partial refund/late capture safety | V: local provider mocks and SQL; provider settlement B |
| 27 | Shipment/tracking/delivery transitions | V: SQL and customer browser; courier dispatch B |
| 28 | Return quantities/window/explicit restock | V: SQL partial return and browser request |
| 29 | Order history and PDF receipt | V: ownership, PDF signature; statutory GST invoice B |
| 30 | Coupons/date windows/quotas | V: SQL discount, cancel-release and pricing tests |
| 31 | Gift credit/loyalty/scheduled sales | V: one-use, spend/restore, sale window; economic policy B |
| 32 | In-app notifications and consent | V: SQL/private UI; private notification list; no SMS/push |
| 33 | Opted-in recovery/outbox | V with mock transport; real inbox B |
| 34 | Private support and owner replies | V: SQL ownership + browser form |
| 35 | CMS/campaign plain-text edits | I: implemented owner/public surfaces; content approval B |
| 36 | Actual analytics/low stock/audit/CSV | V: owner browser and CSV formula test; audited finances B |
| 37 | Consent/export/erasure | V: SQL rejection and success; retention/legal policy B |
| 38 | CSRF/SQL/XSS/abuse/error controls | V: static/unit/SQL negative cases; independent security review B |
| 39 | Responsive/accessibility/performance | V for selected Chromium screens/axe and loopback samples; other browsers/load B |
| 40 | Repeatable QA and accurate handoff | V: owned disposable runner, migrations and outage recovery; production acceptance B |

Production catalog/photography, policy text and business metrics must come from the owner. Fixtures, mocked providers and owner assertions must never be presented as independently verified live business facts.
