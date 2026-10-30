import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, open, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { Client } = createRequire(new URL('../../backend/package.json', import.meta.url))('pg');
const magic = Buffer.from('NCBK1');
export function databaseIdentity(raw) {
  const u = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(u.protocol))
    throw new Error('PostgreSQL URL required');
  return createHash('sha256')
    .update(u.hostname + ':' + (u.port || 5432) + u.pathname)
    .digest('hex');
}
function key() {
  if (!/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || ''))
    throw new Error('Separate private backup encryption key required');
  return Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'hex');
}
function pgEnv(raw) {
  const u = new URL(raw);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: u.searchParams.get('sslmode') || 'prefer',
    PGSSLROOTCERT: u.searchParams.get('sslrootcert') || undefined,
  };
}
function job(command, args, url) {
  const child = spawn(command, args, { env: pgEnv(url), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  const complete = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(command + ' failed; credentials/details withheld')),
    );
  });
  return { child, complete };
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const b of createReadStream(path)) hash.update(b);
  return hash.digest('hex');
}
async function summary(client) {
  const result = {};
  for (const table of [
    'schema_migrations',
    'users',
    'products',
    'variants',
    'orders',
    'audit_events',
  ]) {
    if ((await client.query('SELECT to_regclass($1) AS name', ['public.' + table])).rows[0].name)
      result[table] = Number((await client.query('SELECT count(*) AS n FROM ' + table)).rows[0].n);
  }
  return result;
}
function endpoint(name) {
  const raw = process.env.BACKUP_UPLOAD_BASE_URL;
  if (!raw) throw new Error('Approved off-server backup endpoint required');
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:')
    throw new Error('Backup endpoint requires clean HTTPS URL');
  url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(name);
  return url;
}
export async function backup({ directory = process.env.BACKUP_DIRECTORY || '/backups' } = {}) {
  const encryptionKey = key(),
    url = process.env.DATABASE_URL;
  if (!url) throw new Error('Database required');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = 'novacart-' + Date.now() + '-' + randomBytes(6).toString('hex') + '.ncbk',
    path = join(directory, file),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(magic);
  const client = new Client({ connectionString: url, statement_timeout: 10000 });
  await client.connect();
  let receipt;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const counts = await summary(client);
    const handle = await open(path, 'wx', 0o600);
    await handle.write(Buffer.concat([magic, iv]));
    await handle.close();
    const { child, complete } = job(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-privileges', '--snapshot=' + snapshot],
      url,
    );
    await Promise.all([
      pipeline(child.stdout, cipher, createWriteStream(path, { flags: 'a', mode: 0o600 })),
      complete,
    ]);
    const out = await open(path, 'a');
    await out.write(cipher.getAuthTag());
    await out.close();
    await client.query('COMMIT');
    receipt = {
      format: 'NOVACART_BACKUP_V1',
      createdAt: new Date().toISOString(),
      file,
      databaseIdentity: databaseIdentity(url),
      sha256: await hashFile(path),
      counts,
      offsiteVerified: false,
    };
    const target = endpoint(file),
      auth = process.env.BACKUP_UPLOAD_TOKEN
        ? { Authorization: 'Bearer ' + process.env.BACKUP_UPLOAD_TOKEN }
        : {};
    const upload = await fetch(target, {
      method: 'PUT',
      headers: {
        ...auth,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String((await stat(path)).size),
      },
      body: createReadStream(path),
      duplex: 'half',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!upload.ok) throw new Error('Offsite upload rejected');
    await upload.body?.cancel();
    const retrieved = await fetch(target, {
      headers: auth,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!retrieved.ok) throw new Error('Offsite readback rejected');
    const digest = createHash('sha256');
    for await (const chunk of Readable.fromWeb(retrieved.body)) digest.update(chunk);
    if (digest.digest('hex') !== receipt.sha256) throw new Error('Offsite checksum mismatch');
    receipt.offsiteVerified = true;
    await writeFile(path + '.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    return { path, receiptPath: path + '.json', receipt };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
export async function restore(path, receiptPath) {
  if (process.env.CONFIRM_DISPOSABLE_RESTORE !== 'yes')
    throw new Error('Disposable restore confirmation required');
  const target = process.env.RESTORE_DATABASE_URL;
  if (!target || !/^\/novacart_restore_[a-z0-9_]+$/.test(new URL(target).pathname))
    throw new Error(
      'Restore only supports explicitly named disposable novacart_restore_* databases',
    );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (basename(path) !== receipt.file || (await hashFile(path)) !== receipt.sha256)
    throw new Error('Backup checksum mismatch');
  const client = new Client({ connectionString: target, statement_timeout: 10000 });
  await client.connect();
  const directory = await mkdtemp(join(tmpdir(), 'novacart-restore-')),
    plain = join(directory, 'restore.dump');
  try {
    if (
      Number(
        (
          await client.query(
            "SELECT count(*) AS n FROM pg_tables WHERE schemaname NOT IN('pg_catalog','information_schema')",
          )
        ).rows[0].n,
      ) !== 0
    )
      throw new Error('Restore refuses nonempty target database');
    const size = (await stat(path)).size;
    if (size < 34) throw new Error('Invalid encrypted backup');
    const handle = await open(path, 'r');
    const header = Buffer.alloc(17),
      tag = Buffer.alloc(16);
    await handle.read(header, 0, 17, 0);
    await handle.read(tag, 0, 16, size - 16);
    await handle.close();
    if (!header.subarray(0, 5).equals(magic)) throw new Error('Invalid backup format');
    const decrypt = createDecipheriv('aes-256-gcm', key(), header.subarray(5));
    decrypt.setAAD(magic);
    decrypt.setAuthTag(tag);
    // Authenticate the complete archive before opening any database restore process.
    await pipeline(
      createReadStream(path, { start: 17, end: size - 17 }),
      decrypt,
      createWriteStream(plain, { flags: 'wx', mode: 0o600 }),
    );
    const { child, complete } = job(
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--dbname=' + decodeURIComponent(new URL(target).pathname.slice(1)),
        plain,
      ],
      target,
    );
    child.stdout.resume();
    await complete;
    const counts = await summary(client);
    if (JSON.stringify(counts) !== JSON.stringify(receipt.counts))
      throw new Error('Restored row counts do not match snapshot');
    receipt.restoreVerifiedAt = new Date().toISOString();
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    return { ok: true, counts };
  } finally {
    await client.end();
    await unlink(plain).catch(() => {});
    const { rmdir } = await import('node:fs/promises');
    await rmdir(directory).catch(() => {});
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv[2] === 'restore') {
      await restore(process.argv[3], process.argv[4]);
      console.log('Disposable restore and row counts verified');
    } else {
      do {
        const result = await backup();
        console.log(
          JSON.stringify({
            event: 'encrypted_backup_verified',
            file: result.receipt.file,
            offsiteVerified: true,
          }),
        );
        if (process.argv[2] !== 'schedule') break;
        const seconds = Number(process.env.BACKUP_INTERVAL_SECONDS || 86400);
        if (!Number.isSafeInteger(seconds) || seconds < 60)
          throw new Error('Invalid backup interval');
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      } while (process.argv[2] === 'schedule');
    }
  } catch {
    console.error(
      'Backup/restore failed; inspect configuration and receipts without logging secrets',
    );
    process.exitCode = 1;
  }
}
