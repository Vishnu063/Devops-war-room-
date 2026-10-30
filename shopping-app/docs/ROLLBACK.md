# Rollback and recovery

Keep the previously approved application/proxy image digests and compatible Compose configuration before release. Never use mutable latest tags or force-push Git history. Database migrations are separate; app rollback is valid only if the prior version can read the current schema. Review that compatibility before release.

For an approved preview host, inject the prior immutable APP_IMAGE and the same private environment/curl configuration, then invoke the guarded rollout script:

```bash
$ CONFIRM_PREVIEW_ROLLOUT=yes sh deploy/rollout.sh
```

Required variables are documented in the script; never put secret values in the command. It pulls the reviewed digest, updates only the app, restarts the existing proxy and performs authenticated CA-verified HTTPS smoke. A failure stops and reports; it does not guess repairs or automatically downgrade data. Preserve new writes and provider evidence for diagnosis. Reconcile payment/refund state externally before any financial recovery action.

Do not use down --volumes, database reset, seed or destructive down migration for rollback. For data loss/corruption, restore a verified encrypted archive to a new empty isolated database, compare records/provider reconciliation, then propose a separately authorized cutover. Never overwrite the original database to test a restore.

Local acceptance exercises same-image recreate/recovery. That is not verification of an actual previous-version rollback. No previous approved production artifact or production database exists here; rollback compatibility, external restore/cutover, RPO/RTO and live post-release monitoring remain owner acceptance gates.
