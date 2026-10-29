# NovaCart development API

This is a **demo-only**, dependency-free Node.js HTTP service for validating catalog and quote logic. It is not the production backend and does not persist orders, process payments, authenticate users or reserve inventory.

## Run locally
Requires Node.js 20+. Run `npm install` inside `shopping-app/backend` before starting; the PostgreSQL driver is required even in demo mode.

```sh
$ node --test shopping-app/backend/catalog.test.mjs
$ node shopping-app/backend/server.mjs
```

API binds to 127.0.0.1:3100 by default, not a public interface.

## PostgreSQL development mode

The API uses fictional in-memory products when `DATABASE_URL` is unset. When `DATABASE_URL` is configured, catalog listing and cart quotes use parameterized PostgreSQL queries. No database-backed order creation or authentication exists yet.

To initialize a **disposable development database only**, review `../data-model.sql`, set `DATABASE_URL`, then set `CONFIRM_DEMO_SCHEMA=yes` and run `npm run db:migrate`. The SQL draft is not a production-ready versioned migration. Never apply it to an existing production database.

Database mode quotes use `variantId` rather than demo `id`. The browser demo checkout is separate and does not communicate with this API.

## Endpoints
- GET /api/health
- GET /api/products?search=&category=&sort=&page=&limit=
- GET /api/products/:id
- POST /api/checkout/quote with JSON `{"items":[{"id":"p1","quantity":1}]}`

All prices are calculated from server-side demo data in integer paise. Invalid quantity, duplicate lines and insufficient stock are rejected. Administrative, order-creation and payment routes return 403.

**Do not deploy this demo API publicly or use it for actual orders.** Persistent PostgreSQL implementation, authentication, stock reservations, payment provider adapters and tests are still required.
