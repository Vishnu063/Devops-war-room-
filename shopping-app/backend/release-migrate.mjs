import './runtime-env.mjs';
import { readFile, stat } from 'node:fs/promises';
import { applyMigrations } from './migration-plan.mjs';
import { closeDatabase } from './db.mjs';
import { databaseIdentity } from '../deploy/scripts/backup.mjs';
try {
  if (process.env.CONFIRM_SCHEMA_MIGRATION !== 'apply')
    throw new Error('Explicit migration confirmation required');
  const path = process.env.MIGRATION_BACKUP_RECEIPT;
  if (!path) throw new Error('Verified backup receipt required');
  const info = await stat(path);
  if (info.mode & 0o022) throw new Error('Backup receipt must not be writable by others');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  if (
    receipt.format !== 'NOVACART_BACKUP_V1' ||
    !Number.isFinite(Date.parse(receipt.restoreVerifiedAt)) ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    Date.parse(receipt.restoreVerifiedAt) < Date.parse(receipt.createdAt) ||
    Date.parse(receipt.restoreVerifiedAt) > Date.now() ||
    receipt.databaseIdentity !== databaseIdentity(process.env.DATABASE_URL) ||
    Date.now() - Date.parse(receipt.createdAt) > 86400000 ||
    Date.parse(receipt.createdAt) > Date.now() ||
    !/^([0-9a-f]{64})$/.test(receipt.sha256) ||
    receipt.offsiteVerified !== true
  )
    throw new Error('Fresh offsite and restore-verified backup receipt required');
  await applyMigrations({
    reviewedLegacy: process.env.CONFIRM_LEGACY_MIGRATION_BASELINE === 'reviewed',
  });
  console.log('Release migrations applied; no demo data or owner provisioning executed');
} catch (error) {
  const reasons = [
    'Explicit migration confirmation required',
    'Verified backup receipt required',
    'Fresh offsite and restore-verified backup receipt required',
    'Applied migration checksum mismatch',
    'Legacy migration baseline requires reviewed confirmation',
    'Database schema is newer than this release',
  ];
  console.error(
    JSON.stringify({
      event: 'release_migration_failed',
      reason: reasons.includes(error.message)
        ? error.message
        : 'Review plan, backup receipt and database permissions',
    }),
  );
  console.error(
    'Release migration refused or failed; inspect reviewed plan, backup receipt and database permissions',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
