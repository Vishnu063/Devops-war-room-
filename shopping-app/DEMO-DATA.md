# NovaCart fictional development data

Seed data is fictional: eight original example products across Home, Lifestyle and Tech, with illustrative INR prices/SKUs/stock. Original local SVG illustrations are labelled as illustrations. They are not photographs of verified merchandise. Owner-created integration/browser fixture products are also fictional.

Database mode persists actual **development records**, including orders, inventory reservations, customer accounts, support and audit rows. A recorded development order does not establish real payment, shipment or fulfillment. Never enter real personal/payment data in a test environment.

## Provisional development rules

- Integer INR paise. Shipping ₹79 below merchandise subtotal ₹999, free at/above that threshold; tax is provisional zero.
- COD requires `COD_ENABLED=true`; default cap is ₹50,000 unless explicitly configured. Owner-recorded collection/payout is an assertion, not bank settlement proof.
- PIN syntax is checked; optional `DELIVERY_PIN_PREFIXES` restricts eligible prefixes. Absence of prefixes is a development convenience, not a claim of nationwide delivery.
- Unpaid online orders reserve stock for 15 minutes. COD reservations persist until dispatch/cancel; stock is consumed on shipment.
- Return window defaults to 14 days in development and zero in production unless configured. `.env.example` illustrates a 7-day override; neither is an approved business policy.
- Returned merchandise refunds exclude delivery charges. Split returns allocate merchandise discounts/credit and reverse loyalty points cumulatively; the shipping amount can leave payment status PARTIALLY_REFUNDED even after all merchandise is returned.
- Loyalty earns one development point per ₹100 of delivered merchandise after discounts, reverses cumulative returned amounts and has no approved cash redemption value. Gift codes represent owner-issued credit, not purchased payment instruments.
- PDF files are development receipts, not GST invoices or proof of settlement.

Razorpay and SMTP responses in tests are mocked. No sandbox account, real inbox or courier service was verified. The old standalone `checkout-demo.html` explicitly simulates outcomes and is separate from persistent checkout; it is not linked as the real shopping checkout.

Replace fixture catalog/imagery and approve seller identity, contact information, GST, shipping, return, payment, loyalty/credit and privacy terms before any real commerce. No business metrics, customer reviews, photos or successful external transactions are invented as real facts.
