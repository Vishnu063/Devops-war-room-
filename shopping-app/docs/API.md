# NovaCart API contracts

All paths use the same origin as the storefront. Database mode is required except original demo catalog/quote. Prices are integer INR paise. Success/error bodies are JSON unless PDF/CSV/XML is stated. Errors expose a safe `error` message; `X-Request-ID` correlates sanitized server failures. Do not log credentials, cookies, tokens, payment payloads or addresses.

## Common rules

Mutations require `Origin` equal to canonical `APP_ORIGIN` (or the loopback request origin in development), `Content-Type: application/json` and a session/guest cookie when applicable. Missing/cross-origin requests fail 403; wrong media fails 415. Explicit JSON allowlists, bounded bodies and parameterized queries apply. Cross-origin browser access is not enabled. The Razorpay webhook instead requires a valid signature over the original, unencoded request bytes and a provider event ID.

Cookies are HttpOnly, SameSite=Lax and host-only. Production names use `__Host-` and Secure; cookies are never returned in JSON. Guest cookies are bearer capabilities: retain them privately to access guest orders. Owner APIs enforce OWNER and recent TOTP in production; hiding controls does not confer protection. Email verification is implemented but is not currently a checkout gate.

Typical responses: 400 invalid input; 401 missing/expired session or credentials; 403 wrong role/origin; 404 absent or unowned resource; 409 state, stock or idempotency conflict; 429 throttling; 503 unavailable database/provider. Bulk import uses 207 with per-row outcomes. Inspect response data before treating any operation as successful.

## Identity

| Method | Path | Input / result |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email,name,password}`; CUSTOMER only; session and encrypted verification outbox |
| POST | `/api/auth/login` | `{email,password,code?}`; owner TOTP when enrolled |
| GET | `/api/auth/me` | Current safe user metadata |
| POST | `/api/auth/logout`, `/api/auth/revoke-all` | `{}`; current/all sessions revoked |
| POST | `/api/auth/forgot-password`, `/api/auth/resend-verification` | `{email}`; generic 202, no account existence disclosure |
| POST | `/api/auth/verify-email` | `{token}` one-use token |
| POST | `/api/auth/reset-password` | `{token,password}`; one-use, revokes sessions |
| POST | `/api/auth/mfa/setup` | OWNER `{password}`; secret/URI displayed only for private enrollment |
| POST | `/api/auth/mfa/confirm` | OWNER `{code}`; enables TOTP, revokes prior sessions and issues MFA session |

Verification/reset links carry tokens in URL fragments, stripped by the UI; no tokens in access-log query strings. Never share enrollment secrets or mail links.

## Catalog and shopping

| Method | Path | Input / result |
| --- | --- | --- |
| GET | `/api/health` | Actual database health; 503 on outage |
| GET | `/api/config`, `/api/categories` | Capability flags / actual categories |
| GET | `/api/products` | `search`, `category`, `sort`, `page`, `limit`; bounded server pagination |
| GET | `/api/products/:idOrSlug` | Published variants, images, approved reviews/Q&A |
| GET | `/api/products/:id/recommendations` | Available same-category products; no invented popularity |
| GET | `/api/compare?ids=id,id` | 2–4 published products |
| GET | `/api/content`, `/api/offers` | Enabled plain-text CMS/current coupon metadata |
| POST | `/api/guest` | `{}`; creates guest capability if needed |
| GET / PUT | `/api/cart` | PUT `{variantId,quantity}`; zero removes; quantity 0–99 |
| POST | `/api/cart/quote` | `{items?,couponCode?,useStoreCredit?}`; server totals |
| GET | `/api/wishlist`, `/api/addresses` | Current actor records; saved addresses require account |
| PUT / DELETE | `/api/wishlist/:productId` | `{}`; owner-scoped save/remove |
| POST | `/api/addresses` | Validated India delivery fields, encrypted payload |
| DELETE | `/api/addresses/:id` | Removes only current customer's record |

`POST /api/checkout/quote` preserves the original catalog quotation contract; integrated checkout uses `/api/cart/quote` and `/api/orders`.

## Orders, payment and customer operations

`POST /api/orders` requires `Idempotency-Key` (16–100 safe characters) and:

```json
{"items":[{"variantId":"uuid","quantity":1}],"address":{"recipient":"Development Fixture","phone":"9876543210","line1":"12 Test Lane","line2":"","city":"Bengaluru","state":"Karnataka","pincode":"560001"},"paymentMethod":"COD","couponCode":"OPTIONAL","useStoreCredit":false}
```

Same key and payload replays the original result (200); new order returns 201; a changed payload conflicts. Do not generate a new key after an uncertain response. `GET /api/orders/lookup/:key` safely resolves uncertain checkout for the same actor. COD must be explicitly enabled and within its cap/eligible PIN prefixes. Online checkout requires configured test-provider keys and starts PENDING_PAYMENT; browser success is never proof of payment.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/orders`, `/api/orders/:id` | Actor-owned history/details and shipment/return state |
| POST | `/api/orders/:id/cancel` | `{}`; legal pre-shipping states; releases once |
| GET | `/api/orders/:id/receipt` | Private PDF development receipt, not GST invoice |
| POST | `/api/orders/:id/payment-session` | Owned pending order; official hosted gateway session |
| POST | `/api/webhooks/razorpay` | Raw signed provider event; duplicate-safe; amount/currency/order binding |
| POST | `/api/orders/:id/returns` | `{orderItemId,quantity,reason}`, distinct `Idempotency-Key`; delivered items only |
| POST | `/api/products/:id/reviews` | Signed-in delivered purchaser `{rating,body}`; pending moderation |
| POST | `/api/products/:id/questions` | Signed-in `{question}`; pending moderation |
| GET / PUT | `/api/preferences` | PUT all `{marketing,personalization,analytics}` booleans; default false |
| GET / POST | `/api/recent` | POST `{productId}`; only records with personalization consent |
| POST | `/api/analytics/event` | Allowlisted `{event}`; ignored without analytics consent |
| GET | `/api/notifications`, `/api/credit` | Private notifications / balance and development loyalty points |
| POST | `/api/gift-cards/redeem` | `{code}`; hashed one-use owner-issued credit, not purchased instrument |
| GET / POST | `/api/support` | Private tickets; POST `{subject,message,orderId?}` |
| POST | `/api/support/:id` | Private reply `{message}` |
| GET | `/api/privacy/export` | Private JSON download |
| POST | `/api/privacy/delete` | `{password,confirmation:"DELETE"}`; rejects active business obligations/owner accounts |

## Owner operations

| Method | Path | Contract |
| --- | --- | --- |
| GET / POST | `/api/admin/products` | Actual catalog / validated draft-or-explicit-published product |
| PATCH | `/api/admin/products/:id` | Product metadata; use variant route for multi-variant prices/stock |
| POST | `/api/admin/categories` | `{name,slug}` |
| POST | `/api/admin/products/:id/variants` | Validated SKU, attributes, integer price and stock |
| PATCH | `/api/admin/variants/:id` | Price/stock/publication/sale-window edits; cannot reduce below reserved stock |
| PUT | `/api/admin/products/:id/images` | `{images:[{src,alt}]}` local assets/allowlisted HTTPS only |
| POST | `/api/admin/products/bulk` | `{items:[...]}`; explicit independent per-row results, not all-or-nothing |
| GET | `/api/admin/orders`, `/api/admin/orders/:id` | Owner order list/private detail |
| POST | `/api/admin/orders/:id/transition` | PACKING, SHIPPED (provider/tracking), DELIVERED (COD collection assertion) |
| GET / PATCH | `/api/admin/returns`, `/api/admin/returns/:id` | Inspect and approve/reject/receive; explicit restock decision |
| GET | `/api/admin/refunds`, `/api/admin/payments` | Stored provider/cash intents and uncertain states |
| POST | `/api/admin/refunds/:id/submit` | `{}`; submit Razorpay refund once, signed event establishes completion |
| POST | `/api/admin/refunds/:id/manual` | Cash refund with explicit confirmation/reference; owner assertion only |
| POST | `/api/admin/payments/:id/reconcile` | `{providerOrderId}`; provider-bound reconciliation, never invented success |
| GET / POST | `/api/admin/coupons` | Inspect/create-or-update bounded dated coupon |
| POST | `/api/admin/gift-cards` | `{amountPaise,expiresAt?}`; secret code displayed once |
| PUT | `/api/admin/content/:key` | homepage/campaign/policy-preview `{title,body,enabled}`; text only |
| GET / PATCH | `/api/admin/reviews`, `/api/admin/reviews/:id` | Moderation; no fictional review creation |
| GET / PATCH | `/api/admin/questions`, `/api/admin/questions/:id` | Answer/approve moderation |
| GET / POST | `/api/admin/support`, `/api/admin/support/:id` | Private owner support handling |
| GET | `/api/admin/analytics`, `/api/admin/audit?page=1` | Actual DB counts, low stock and bounded audit history |
| GET | `/api/admin/export/orders` | Private CSV, formula escaped, bounded 5000 rows |
| POST | `/api/admin/maintenance` | `{}`; bounded reservation expiry, consent recovery queue and configured mail |

Use the owner forms as field-level examples and source validation as the authoritative contract. Endpoint coverage does not imply externally verified service or policy approval.

## Preview checkout capability

GET /api/config includes ordersEnabled, derived from the same release policy enforced by POST /api/orders. It is false without a database or when the release disables acceptance. The storefront keeps submit disabled until capability loading succeeds and a payment method is enabled; this is presentation only, and the server still rejects disabled orders. Account checkout can select a saved address from the owner-scoped GET /api/addresses result, populating the ordinary server-validated address fields. No browser price or authorization decision is trusted.
