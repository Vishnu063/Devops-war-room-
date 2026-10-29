# NovaCart development API

This is a **demo-only**, Node.js HTTP service for validating catalog and quote logic. It is not the production backend and does not persist orders, process payments, or reserve inventory. Database-backed development authentication is available but unverified.

## Run locally
Requires Node.js 20+. Run `npm install` inside `shopping-app/backend` before starting; the PostgreSQL driver is required even in demo mode.

```sh
$ node --test shopping-app/backend/catalog.test.mjs
$ node shopping-app/backend/server.mjs
```

API binds to 127.0.0.1:3100 by default, not a public interface.

## PostgreSQL development mode

The API uses fictional in-memory products when `DATABASE_URL` is unset. When `DATABASE_URL` is configured, catalog listing and cart quotes use parameterized PostgreSQL queries. Database-backed development authentication exists; order creation is not implemented.

To initialize a **disposable development database only**, review `../data-model.sql`, set `DATABASE_URL`, then set `CONFIRM_DEMO_SCHEMA=yes` and run `npm run db:migrate`. Development schema migrations are version-tracked, but are not production-ready. Never apply it to an existing production database.

Database mode quotes use `variantId` rather than demo `id`. The browser demo checkout is separate and does not communicate with this API.

## Endpoints
- GET /api/health
- GET /api/products?search=&category=&sort=&page=&limit=
- GET /api/products/:id
- POST /api/checkout/quote with JSON `{"items":[{"id":"p1","quantity":1}]}`

All prices are calculated from server-side demo data in integer paise. Invalid quantity, duplicate lines and insufficient stock are rejected. Administrative, order-creation and payment routes return 403.

**Do not deploy this demo API publicly or use it for actual orders.** Production-grade PostgreSQL integration, stock reservations, payment provider adapters and executed tests are still required.

## Authentication development endpoints

Database mode adds `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. Registration accepts `{"email":"demo@example.com","password":"at-least-12-characters","name":"Demo User"}` and always creates a CUSTOMER account; callers cannot set OWNER roles. Login and registration create a database-backed session using a hashed token and an HttpOnly cookie. The development migration command applies the base and authentication schemas on a fresh disposable database.

**Not production-ready:** no account verification, password recovery, shared-store login throttling, comprehensive CSRF protection, production owner provisioning, security review or integration tests against PostgreSQL. Do not expose this API to the public internet. The static storefront has not been connected to authentication.

## Owner-only catalog API (development)

With PostgreSQL and authentication configured, OWNER sessions may use `GET /api/admin/products`, `POST /api/admin/products`, and `PATCH /api/admin/products/:id`. Mutations require same-origin JSON requests and record audit events. Creation requires `name`, `slug`, `categorySlug`, `sku`, `pricePaise` and `stock`. New products default to draft; an OWNER can explicitly set `active: true` during creation. Product edits reject products with multiple variants and therefore are **not ready for multi-variant products**. No public owner registration is supported. Do not use these endpoints for real commerce until database integration tests, owner provisioning and security review are complete.

## Verification checklist (not yet completed)

Run on a machine with Node.js 20+, network access to install `pg`, and a **disposable** PostgreSQL 16+ database:

```sh
$ cd shopping-app/backend
$ npm install
$ npm test
$ CONFIRM_DEMO_SCHEMA=yes npm run db:migrate
$ CONFIRM_DEMO_SEED=yes npm run db:seed-demo
$ npm start
```

Migration tracking now records schema versions 1 and 2; use a fresh database for first verification. Existing databases created before tracking require manual reconciliation. The admin page is at `http://127.0.0.1:3100/admin`. Verify OWNER login, draft creation, price/stock edits, publication changes, rejection of CUSTOMER sessions, and logout. No production payment or order processing is implemented. Development-only owner provisioning is available but unverified.

### Development owner account

Register a customer through the same-origin API first. On a disposable development database, explicitly promote that existing account:

```sh
$ NODE_ENV=development OWNER_EMAIL=owner@example.test CONFIRM_OWNER_PROVISION=yes npm run db:provision-owner
```

Replace the example email with your actual test account. This command requires `NODE_ENV=development`; it does not create a password or expose a public owner-registration endpoint. Sign in at `/admin` after provisioning.
