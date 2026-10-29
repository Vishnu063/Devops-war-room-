# Security rules for NovaCart

- No API keys, passwords, payment credentials, signing secrets, or production customer data in Git.
- Browser localStorage in the current demo stores **only illustrative cart product IDs/quantities and wishlist IDs**. Never store authentication tokens or personal data there.
- Do not enable checkout until authenticated order creation, transactional stock reservations, verified payment webhooks, COD eligibility, and idempotent reconciliation are implemented.
- Authorization is server-side and deny-by-default; OWNER and staff permissions must be checked on each admin API action.
- Enforce input validation, parameterized database operations, CSRF protection where applicable, rate limiting, audit trails and least privilege.
- Use secure session cookies, password hashing, MFA for admins, recovery workflows and session revocation.
- Treat all images, HTML and customer-generated content as untrusted.
- Define applicable Indian consumer protection, privacy, tax/GST and invoice requirements with the business owner before launch.
- Threat-model payment, refunds, coupon stacking, gift-card balance, inventory overselling and privilege escalation.
- The existing prototype is **not** safe for real orders, payments or customer accounts.
