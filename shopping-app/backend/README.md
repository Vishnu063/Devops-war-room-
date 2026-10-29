# NovaCart development API

This is a **demo-only**, dependency-free Node.js HTTP service for validating catalog and quote logic. It is not the production backend and does not persist orders, process payments, authenticate users or reserve inventory.

## Run locally
Requires Node.js 20+.

```sh
$ node --test shopping-app/backend/catalog.test.mjs
$ node shopping-app/backend/server.mjs
```

API binds to 127.0.0.1:3100 by default, not a public interface.

## Endpoints
- GET /api/health
- GET /api/products?search=&category=&sort=&page=&limit=
- GET /api/products/:id
- POST /api/checkout/quote with JSON `{"items":[{"id":"p1","quantity":1}]}`

All prices are calculated from server-side demo data in integer paise. Invalid quantity, duplicate lines and insufficient stock are rejected. Administrative, order-creation and payment routes return 403.

**Do not deploy this demo API publicly or use it for actual orders.** Persistent PostgreSQL implementation, authentication, stock reservations, payment provider adapters and tests are still required.
