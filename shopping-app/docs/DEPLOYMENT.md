# Internal preview deployment

**No public deployment has been performed.** This is a reviewable configuration for fictional internal use. Real orders/payments, COD and indexing are disabled. Do not enter customer information. A production runtime is used to test secure cookies/MFA behavior; that does not make this a production release.

## Automated isolated verification

```bash
$ cd shopping-app/backend
$ npm ci
$ npm run test:all
$ cd ..
$ node deploy/test-deployment.mjs
```

For a local repeat against already-built images, `node deploy/test-deployment.mjs --reuse-images` skips builds and records that fact; release CI always rebuilds.

The deployment test owns a unique Compose project, private generated passwords/key/certificate, ephemeral loopback HTTPS port, isolated database and HTTPS backup fixture. It builds pinned images, tests backup/restore/migration and HTTPS/privacy/runtime gates, then removes only its project/volumes and private temporary files. Logs may contain fictional fixture data; publish sanitized summary JSON only. Docker, Compose, OpenSSL, Node24, adequate disk and trusted registry/network access are required. System CA/proxy verification stays enabled. VFS storage preflight requires12GiB free for build+acceptance or3GiB with --reuse-images; default overlay-based CI is less disk-intensive. The optional Python HTTPS fixture reuses a small official image and never receives real data.

## Prepare an interactive local preview

```bash
$ cd shopping-app
$ node deploy/scripts/prepare-preview.mjs /private/novacart-preview 8443
$ docker compose --env-file /private/novacart-preview/compose.env config --quiet
$ docker compose --env-file /private/novacart-preview/compose.env build
$ docker compose --env-file /private/novacart-preview/compose.env --profile operations build operations
$ docker compose --env-file /private/novacart-preview/compose.env up -d novacart-db
```

The generator refuses an existing directory to preserve keys. It prints paths, not credential values. Its self-signed certificate is trusted only if explicitly supplied to the local client; do not use insecure TLS flags. Registry/package downloads in a managed cloud build require the session's proxy CA build secret as described by the environment runtime skill. Never COPY that CA into a release image.

An empty volume intentionally needs the separate backup/restore-gated release migration procedure before the app becomes healthy. Configure an approved HTTPS backup endpoint or use the disposable deployment test to exercise the mock. See DATABASE_OPERATIONS.md and BACKUP_RESTORE.md. Seed is permitted only on disposable fictional data with the existing development guard; it is never part of app startup/release migrations.

After schema readiness:

```bash
$ docker compose --env-file /private/novacart-preview/compose.env up -d --wait novacart-app nginx
$ docker compose --env-file /private/novacart-preview/compose.env ps
$ docker compose --env-file /private/novacart-preview/compose.env logs --tail=100 novacart-app nginx
```

The default listener is loopback8443 and uses private preview authentication. Use the locally trusted certificate and credential files. Do not publish a free address or tunnel without owner authorization; none was selected or created.

## Before any public preview

Owner selects EC2/new server, authorized access, domain/free preview service, valid certificate and renewal process, approved registry and external backup/alert services. Inspect OS/RAM/disk/ports/firewall/other sites read-only before making changes. Existing Nginx must not be overwritten. Use a dedicated host/entry or reviewed vhost, then explicitly bind the approved interface/ports. Only the Nginx entry may publish ports; PostgreSQL/app remain private. Add the approved domain to certificate and canonical APP_ORIGIN, replace fixture auth/certificates, verify HTTP redirect to correct HTTPS origin and test renewal with the actual certificate service. No certbot/DNS/SSH changes are run here.

Optional monitoring and backup profiles remain off until configured. A published preview must stay authenticated, fictional and transaction-disabled. Production requires RELEASE_CHECKLIST.md and separate explicit approval. The safe rollout script accepts only an approved immutable image and does not migrate or seed automatically.

Certificate renewal must refresh the mounted files and recreate the dedicated Nginx container (individual file bind mounts retain old inodes after atomic replacement). Test the owner-selected ACME staging/renewal flow and private-key ownership on the actual host; neither issuance nor automatic renewal was performed here.
