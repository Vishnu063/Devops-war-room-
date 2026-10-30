# Database operations

The `novacart-db` volume is persistent. No database ports are published. Never run `down --volumes` on a retained preview or production project. Tests remove volumes only in their uniquely named disposable projects.

Official initialization runs `deploy/db/init.sh` only on a new empty volume. It creates separate runtime, migrator and read-only backup logins, revokes PUBLIC database/schema privileges and configures default table/sequence grants. Changing password files later does not rotate existing database passwords; perform reviewed ALTER ROLE and coordinated secret updates instead.

Migrations remain outside application startup. The old `db:migrate`, seed and owner scripts remain development guarded. New `backend/release-migrate.mjs` reads a reviewed fresh backup receipt and calls `migration-plan.mjs`. It uses a transaction/advisory lock, version ordering, checksum validation and bounded lock timeouts, rejects newer databases and does not seed or provision users. No destructive down migration is supplied.

## Release procedure (approved environment only)

1. Build/review the proposed migration SQL. Assess DDL locks, existing rows, extensions and disk headroom. Schema1–4 verification on fresh databases does not validate a legacy production dataset.
2. Take an encrypted snapshot using the backup tool; verify HTTPS off-server readback and restore it to a new disposable database. Secure the receipt alongside the encrypted archive. It is an operator-controlled record, not an independent signed approval.
3. Set CONFIRM_SCHEMA_MIGRATION=apply and MIGRATION_BACKUP_RECEIPT to that private receipt path, within24 hours. Supply only the migration credential. Run the separate service:

```bash
$ docker compose --env-file /private/novacart/compose.env --profile operations run --rm -e CONFIRM_SCHEMA_MIGRATION=apply -e MIGRATION_BACKUP_RECEIPT=/backups/REVIEWED_BACKUP.ncbk.json operations release-migrate.mjs
```

4. Verify versions/checksums and runtime grants, then start/update the app separately. Migration errors stop release; never reset a checksum to conceal edited SQL.

Existing development migrations lack checksums. Baseline only after comparing the applied schema to immutable SQL, backed up and restored successfully, then explicitly set CONFIRM_LEGACY_MIGRATION_BASELINE=reviewed. Do not silently assume legacy version rows match code. Existing NOT VALID actor constraints and encrypted-address backfill need an owner-reviewed validation plan.

Production owner provisioning/recovery remains a separate controlled identity workflow. Do not disable the development provisioning guard, create a known owner password or run seed on a live database.
