# Encrypted backup and restore

`deploy/scripts/backup.mjs` streams a consistent PostgreSQL custom-format snapshot through AES-256-GCM to a private spool. Header/version and nonce are authenticated; the archive includes a final authentication tag. The application key and backup key are separate. pg_dump credentials use child environment variables, never command-line URLs. A repeatable-read exported snapshot ties recorded row counts to the archive.

Backups upload only to an explicitly approved clean HTTPS base URL, then retrieve the object and compare SHA256. Endpoint contract: authenticated PUT/GET at BASE/generated-filename. No S3 account or paid provider is assumed. A generic HTTPS contract still needs an actual operator-managed endpoint; the QA fixture is an in-memory object server on the same Docker host and is NOT an off-server backup solution.

The backup profile uses a read-only database role. The operations profile has a migrator credential and is for explicitly invoked maintenance only. Enable scheduling only once off-server storage, key escrow, retention, restore capacity and alerting have been approved:

```bash
$ docker compose --env-file /private/novacart/compose.env --profile backups up -d backup
```

One worker runs every24 hours. Failure exits with a structured error rather than claiming success or retrying indefinitely. Operator/monitoring must alert on job exit, missing receipts, age and disk consumption. There is no invented retention period or automatic deletion of archives; approve retention and offsite lifecycle before scheduling. Spool and restored temporary space must fit the database.

Restore is deliberately limited to a **new empty** `novacart_restore_*` database and explicit CONFIRM_DISPOSABLE_RESTORE=yes. It verifies checksum and complete GCM authentication before executing pg_restore, then uses --single-transaction/--exit-on-error and compares snapshot row counts. Private temporary plaintext is mode0600 and removed afterward. Never use a real/occupied database as a restore target. It does not perform destructive in-place disaster recovery.

```bash
$ docker compose --env-file /private/novacart/compose.env --profile operations run --rm -e RESTORE_DATABASE_URL -e CONFIRM_DISPOSABLE_RESTORE=yes operations ../deploy/scripts/backup.mjs restore /backups/REVIEWED_BACKUP.ncbk /backups/REVIEWED_BACKUP.ncbk.json
```

Inject RESTORE_DATABASE_URL securely into the command environment; do not print it. A target DBA creates the empty disposable database separately. The restore stamp is added only after success. Migration accepts only a fresh offsite/restore-verified receipt for the same source database identity; the encrypted archive and encryption key must remain available independently. Real off-server retention/restore, key-loss recovery and operational RPO/RTO are still release gates.
