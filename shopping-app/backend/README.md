# NovaCart development service

Requires Node.js 24 (application suite tested24.19.0; patched container base24.22.2), npm and a **new disposable PostgreSQL 16+ database**. The service binds to `127.0.0.1:3100`; it is not a production deployment configuration.

## Repeatable verification

```bash
$ cd shopping-app/backend
$ npm ci
$ npm run check
$ npm test
$ npm run test:all
$ npm run test:deployment
```

`test:all` requires access to the local Docker socket and Chromium. It creates its own random database credentials, labelled PostgreSQL 16 container and browser database; it ignores caller payment/mail/database secrets, runs real SQL and browser acceptance, pauses/resumes only that database to verify health recovery, audits dependencies and removes only owned resources. It never uses an existing database. Results are under ignored `test-artifacts/`; raw logs/screenshots may contain fictional personal fixture data and must not be published indiscriminately.

If no system Chromium is installed, install the matching Playwright browser with `npx playwright install chromium` where network policy permits, or set `CHROMIUM_EXECUTABLE` to an installed Chromium. This environment uses `/usr/bin/chromium`; the Playwright download CDN was blocked. Do not bypass TLS or network controls.

## Local interactive development

Create a fresh empty disposable database yourself, then set its private `DATABASE_URL` in your shell. Do not paste it into chat or commit it. The following `$` prefixes indicate shell commands; omit the prefix when copying.

```bash
$ cd shopping-app/backend
$ npm ci
$ export NODE_ENV=development
$ export DATA_ENCRYPTION_KEY="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
$ export COD_ENABLED=true
$ export APP_ORIGIN=http://127.0.0.1:3100
$ CONFIRM_DEMO_SCHEMA=yes npm run db:migrate
$ CONFIRM_DEMO_SEED=yes npm run db:seed-demo
$ npm start
```

`DATABASE_URL` must already point to the new disposable database. Preserve its encryption key privately for subsequent restarts. Changing it makes previously encrypted records unreadable. Open the local service in your browser and register a fictional account. In a second shell with the same private environment, promote only that already-registered fixture:

```bash
$ NODE_ENV=development OWNER_EMAIL=owner@example.test CONFIRM_OWNER_PROVISION=yes npm run db:provision-owner
```

Sign out/in after promotion, open `/admin`, and enroll owner TOTP from the account security panel. Scripts reject production mode and require explicit confirmation. Never run demo seed/provision against a live database. Without `DATABASE_URL`, only the original in-memory catalog/quotation compatibility mode works; persistence APIs are unavailable.

## Configuration

See `.env.example` for names, not credentials. Node does not automatically load `.env`; use shell environment bindings or `node --env-file=/private/path/dev.env server.mjs` with an appropriately protected file. `DATABASE_URL`, `DATA_ENCRYPTION_KEY` and, for production validation, canonical HTTPS `APP_ORIGIN` are mandatory. COD is disabled unless explicitly enabled. Delivery prefixes and COD caps are development rules awaiting owner approval. Tax remains provisional zero, and generated PDFs are labelled development receipts, not GST invoices.

Razorpay requires test keys and a separately configured webhook secret. SMTP needs a TLS-verified `smtp:`/`smtps:` URL and approved sender. None was available here. Do not set `ALLOW_LIVE_PAYMENTS=true` without separate authorization and release gates. `RUN_JOBS=false` disables the 30-second local maintenance loop for controlled QA. Production provisioning, migrations, key rotation and deployment need separately reviewed procedures.

See [API](../docs/API.md), [architecture](../ARCHITECTURE.md), [acceptance](../docs/ACCEPTANCE.md) and [handoff](../docs/HANDOFF.md).
