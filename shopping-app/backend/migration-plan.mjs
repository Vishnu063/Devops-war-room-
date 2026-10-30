import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { database } from './db.mjs';
export const migrations = [
  new URL('../data-model.sql', import.meta.url),
  new URL('./auth-schema.sql', import.meta.url),
  new URL('./migrations/003-commerce.sql', import.meta.url),
  new URL('./migrations/004-operations.sql', import.meta.url),
];
export async function applyMigrations({ reviewedLegacy = false } = {}) {
  const plan = await Promise.all(
    migrations.map(async (url, i) => {
      const sql = await readFile(url, 'utf8');
      return { version: i + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query('SELECT pg_advisory_xact_lock(8712301)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,checksum text)',
    );
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    const existing = (
      await client.query('SELECT version,checksum FROM schema_migrations ORDER BY version')
    ).rows;
    if (existing.some((r) => !plan.some((p) => p.version === r.version)))
      throw new Error('Database schema is newer than this release');
    for (const item of plan) {
      const previous = existing.find((r) => r.version === item.version);
      if (previous) {
        if (previous.checksum && previous.checksum !== item.checksum)
          throw new Error('Applied migration checksum mismatch');
        if (!previous.checksum) {
          if (!reviewedLegacy)
            throw new Error('Legacy migration baseline requires reviewed confirmation');
          await client.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', [
            item.checksum,
            item.version,
          ]);
        }
      } else {
        await client.query(item.sql);
        await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [
          item.version,
          item.checksum,
        ]);
      }
    }
    await client.query('COMMIT');
    return plan.map((p) => ({ version: p.version, checksum: p.checksum }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
