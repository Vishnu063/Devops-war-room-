# NovaCart demo business configuration

**DEMO ONLY — NOT REAL BUSINESS INFORMATION.**

This file contains fictional test data for development, QA and UI previews. Never treat these values as verified business information, live payment credentials or actual stock.

## Payment gateway
- Provider: Razorpay (mock adapter; no live account connected)
- Mode: DEMO / simulated checkout only
- Methods shown: UPI, credit/debit card, net banking, Cash on Delivery
- Payment outcomes for testing: success, declined, cancelled, timeout, duplicate callback
- All payment references: `DEMO-PAY-*`; no money moves
- Never enter real card numbers, UPI PINs or banking credentials

## Business identity
- Display name: NovaCart Demo Store
- Email: demo@novacart.example
- Phone: +91 00000 00000 (placeholder; not callable)
- Address: Demo Business Park, Pune, Maharashtra, India (fictional)
- GSTIN: NOT PROVIDED — do not fabricate or display a GST registration number
- Currency: INR

## Illustrative products and stock
All prices and quantities are invented for development.
| SKU | Product | Price (INR) | Demo stock |
| --- | --- | ---: | ---: |
| DEMO-HOME-001 | The Everyday Chair | 8,499 | 15 |
| DEMO-TECH-002 | Studio Headphones | 3,499 | 30 |
| DEMO-LIFE-003 | Everyday Sneakers | 2,999 | 25 |
| DEMO-HOME-004 | Ceramic Accent Vase | 1,299 | 40 |
| DEMO-HOME-005 | Minimal Desk Lamp | 2,199 | 18 |
| DEMO-LIFE-006 | Classic Wristwatch | 4,999 | 12 |
| DEMO-TECH-007 | Wireless Essentials | 1,899 | 35 |
| DEMO-HOME-008 | Everyday Home Decor | 999 | 50 |

Product images in the current prototype are illustrative external photos, not verified merchandise photography.

## Shipping
- Provider: Mock Shiprocket adapter (not connected to Shiprocket)
- Demo service area: Indian six-digit PIN codes for validation tests, **not actual serviceability**
- Standard shipping fee: ₹79 for carts below ₹999; ₹0 for carts at/above ₹999
- Mock estimated delivery: 3–7 business days, not a real promise
- Mock tracking format: `DEMO-SHIP-000001`
- No real pickup, labels, tracking or carrier booking

## Store policies — fictional test copy
- Demo cancellation: before simulated dispatch
- Demo return request window: 7 days after simulated delivery
- Demo refund: simulated only, no funds transferred
- Demo COD: available as a simulated payment choice, subject to mock eligibility
- Demo customer support: demo@novacart.example (non-deliverable example domain)
- All fees, windows, tax and shipping rules must be reviewed and approved before launch

## Safety gates
1. Label all mock payment/order/shipping UI clearly as **DEMO**.
2. Do not expose live checkout or claim any transaction completed.
3. Replace all business, catalog, policy, tax, contact and shipping data with verified real information before production.
4. Live provider credentials must be supplied securely outside source control and never committed.
