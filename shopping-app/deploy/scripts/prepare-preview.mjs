// Creates local fictional preview inputs only. Never overwrites existing secrets.
import { mkdir, writeFile, access, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const directory = resolve(process.argv[2] || '.local-preview'),
  port = Number(process.argv[3] || 8443);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Unprivileged local preview port required');
try {
  await access(directory);
  throw new Error('Refusing to overwrite existing preview directory');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(join(directory, 'tls'), { recursive: true, mode: 0o700 });
const random = () => randomBytes(32).toString('hex'),
  admin = random(),
  app = random(),
  migrator = random(),
  backup = random(),
  preview = random();
const values = {
  admin_password: admin,
  app_password: app,
  migrator_password: migrator,
  backup_password: backup,
  backup_url: `postgresql://novacart_backup:${backup}@novacart-db:5432/novacart`,
  app_url: `postgresql://novacart_app:${app}@novacart-db:5432/novacart`,
  migrator_url: `postgresql://novacart_migrator:${migrator}@novacart-db:5432/novacart`,
  admin_url: `postgresql://postgres:${admin}@novacart-db:5432/novacart`,
  data_key: random(),
  backup_key: random(),
  backup_token: random(),
  preview_password: preview,
  monitor_login: 'preview:' + preview,
};
for (const [name, value] of Object.entries(values)) {
  await writeFile(join(directory, name), value + '\n', { mode: 0o444, flag: 'wx' });
  await chmod(join(directory, name), 0o444);
}
const hash = execFileSync('openssl', ['passwd', '-6', '-stdin'], {
  input: preview + '\n',
  encoding: 'utf8',
}).trim();
await writeFile(join(directory, 'preview_auth'), 'preview:' + hash + '\n', {
  mode: 0o444,
  flag: 'wx',
});
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(directory, 'tls/key.pem'),
    '-out',
    join(directory, 'tls/cert.pem'),
    '-days',
    '3',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,DNS:backup-sink,DNS:nginx,IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);
// Secret directories are private; file readability permits explicit secret mounts across container UIDs.
await chmod(join(directory, 'tls/key.pem'), 0o444);
await writeFile(
  join(directory, 'compose.env'),
  `SECRETS_DIRECTORY=${directory}\nAPP_ORIGIN=https://localhost:${port}\nPREVIEW_HTTPS_PORT=${port}\nPREVIEW_HOST=localhost:${port}\n`,
  { mode: 0o600 },
);
console.log(
  'Prepared private local-preview files in ' +
    directory +
    '; username preview, password in preview_password. Self-signed TLS is for local review only.',
);
