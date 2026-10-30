// Full isolated container acceptance. No caller database, server or cloud credentials are used.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { observe } from './scripts/monitor.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { statfs, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:https';
const root = fileURLToPath(new URL('../', import.meta.url)),
  nonce = randomBytes(6).toString('hex'),
  project = 'novacart-deploy-' + nonce;
const directory = await mkdtemp(join(tmpdir(), project + '-')),
  secrets = join(directory, 'secrets'),
  out = new URL('../backend/test-artifacts/', import.meta.url);
await mkdir(out, { recursive: true });
const env = {
  ...process.env,
  APP_IMAGE: 'novacart-app:deployment-qa',
  DATABASE_IMAGE: 'novacart-database:deployment-qa',
  OPERATIONS_IMAGE: 'novacart-operations:deployment-qa',
  NGINX_PROXY_IMAGE: 'novacart-nginx:deployment-qa',
};
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DATABASE_URL',
  'DATA_ENCRYPTION_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'APP_ORIGIN',
  'BACKUP_UPLOAD_BASE_URL',
])
  delete env[name];
let ordinal = 0;
const result = {
  runId: nonce,
  status: 'FAILED',
  checks: [],
  limitations: [
    'Self-signed local TLS; HTTPS object-store mock is on the same Docker host. No real off-server provider, public deployment, certificate renewal or previous-version rollback verified.',
  ],
};
function run(command, args, { expectFailure = false, rejection, extra = {} } = {}) {
  ordinal++;
  let output;
  try {
    output = execFileSync(command, args, {
      cwd: root,
      env: { ...env, ...extra },
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (expectFailure) throw new Error('Expected command rejection');
  } catch (error) {
    if (
      expectFailure &&
      error.status &&
      (!rejection || (String(error.stdout) + String(error.stderr)).includes(rejection))
    ) {
      return '';
    }
    writeFileSync(
      new URL('deployment-command-' + ordinal + '.log', out),
      String(error.stdout || '') + '\n' + String(error.stderr || ''),
      { mode: 0o600 },
    );
    throw new Error(
      'Deployment command ' +
        ordinal +
        ' failed; inspect private test-artifacts/deployment-command-' +
        ordinal +
        '.log',
      { cause: error },
    );
  }
  return output.trim();
}
function docker(...args) {
  return run('docker', ['--host=unix:///var/run/docker.sock', ...args]);
}
let baseArgs = [];
function compose(args, options) {
  return run(
    'docker',
    ['--host=unix:///var/run/docker.sock', 'compose', ...baseArgs, ...args],
    options,
  );
}
function pass(name) {
  result.checks.push(name);
  console.log('PASS: ' + name);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  result.dockerDriver = docker('info', '--format', '{{.Driver}}');
  const space = await statfs(root);
  result.availableWorkspaceMiB = Math.floor((space.bavail * space.bsize) / 1048576);
  const requiredMiB = process.argv.includes('--reuse-images') ? 3072 : 12288;
  if (result.dockerDriver === 'vfs' && result.availableWorkspaceMiB < requiredMiB) {
    result.cleanup = 'NO_RESOURCES_CREATED';
    throw new Error(
      'VFS acceptance needs ' + requiredMiB + ' MiB free before starting; no test services created',
    );
  }
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  run(process.execPath, ['deploy/scripts/prepare-preview.mjs', secrets, String(port)]);
  await mkdir(join(directory, 'backups'), { mode: 0o700 });
  const override = join(directory, 'test.yaml');
  await writeFile(
    override,
    `services:\n  operations:\n    environment:\n      BACKUP_UPLOAD_BASE_URL: https://backup-sink:8443/objects\n      NODE_EXTRA_CA_CERTS: /run/secrets/tls_cert\n    secrets: [tls_cert, backup_url]\n    volumes: [${join(directory, 'backups')}:/backups]\n  backup-sink:\n    image: python:3.12-alpine\n    user: "1000:1000"\n    healthcheck:\n      test: [CMD, python, -c, "import socket; socket.create_connection(('127.0.0.1',8443),2).close()"]\n      interval: 2s\n      timeout: 2s\n      retries: 10\n    volumes: [${join(root, 'deploy/scripts/backup-sink.test-fixture.py')}:/opt/novacart/deploy/scripts/backup-sink.test-fixture.py:ro]\n    command: [python, ../deploy/scripts/backup-sink.test-fixture.py]\n    secrets: [tls_cert, tls_key, backup_token]\n    networks: [database]\n    working_dir: /opt/novacart/backend\n    read_only: true\n    tmpfs: [/tmp]\n    cap_drop: [ALL]\n    mem_limit: 128m\n`,
  );
  baseArgs = [
    '--project-name',
    project,
    '--env-file',
    join(secrets, 'compose.env'),
    '-f',
    'compose.yaml',
    '-f',
    override,
  ];
  compose(['config', '--quiet']);
  pass('Compose validation and private generated secrets');
  result.imagesReused = process.argv.includes('--reuse-images');
  if (!result.imagesReused) {
    for (const [target, tag] of [
      ['app', env.APP_IMAGE],
      ['operations', env.OPERATIONS_IMAGE],
      ['database', env.DATABASE_IMAGE],
    ]) {
      const args = ['build', '--target', target, '-t', tag];
      if (env.CODEX_PROXY_CERT) args.push('--secret', 'id=proxy_ca,src=' + env.CODEX_PROXY_CERT);
      args.push('.');
      docker(...args);
    }
    docker('build', '-t', env.NGINX_PROXY_IMAGE, 'deploy/nginx');
  } else {
    for (const tag of [
      env.APP_IMAGE,
      env.OPERATIONS_IMAGE,
      env.DATABASE_IMAGE,
      env.NGINX_PROXY_IMAGE,
    ])
      docker('image', 'inspect', tag);
  }
  pass(
    result.imagesReused
      ? 'Previously built pinned images available'
      : 'Pinned app, operations, database and non-root proxy image builds',
  );
  compose(['up', '-d', '--wait', 'novacart-db', 'backup-sink']);
  const admin = (await readFile(join(secrets, 'admin_url'), 'utf8')).trim();
  function op(args, options = {}) {
    return compose(['run', '--rm', '-T', '--no-deps', ...args], options);
  }
  function operation(script, args = [], bindings = {}) {
    const params = [];
    for (const name of Object.keys(bindings)) params.push('-e', name);
    return op([...params, 'operations', script, ...args], { extra: bindings });
  }
  function sql(statement, databaseName = 'novacart') {
    return compose([
      'exec',
      '-T',
      'novacart-db',
      'psql',
      '-U',
      'postgres',
      '-d',
      databaseName,
      '-At',
      '-c',
      statement,
    ]);
  }
  op(['-e', 'CONFIRM_SCHEMA_MIGRATION=apply', 'operations', 'release-migrate.mjs'], {
    expectFailure: true,
    rejection: 'Verified backup receipt required',
  });
  pass('Release migration refuses missing verified backup');
  async function snapshot() {
    operation('../deploy/scripts/backup.mjs', [], {
      DATABASE_URL_FILE: '/run/secrets/backup_url',
    });
    const files = (await readdir(join(directory, 'backups')))
      .filter((n) => n.endsWith('.json'))
      .sort();
    const file = files.at(-1);
    return {
      file,
      receipt: JSON.parse(await readFile(join(directory, 'backups', file), 'utf8')),
    };
  }
  const empty = await snapshot();
  sql('CREATE DATABASE novacart_restore_empty');
  operation(
    '../deploy/scripts/backup.mjs',
    ['restore', '/backups/' + empty.receipt.file, '/backups/' + empty.file],
    {
      RESTORE_DATABASE_URL: admin.replace(/\/novacart$/, '/novacart_restore_empty'),
      CONFIRM_DISPOSABLE_RESTORE: 'yes',
    },
  );
  pass('Encrypted pre-migration backup, authenticated HTTPS readback and fresh empty restore');
  const migration = {
    CONFIRM_SCHEMA_MIGRATION: 'apply',
    MIGRATION_BACKUP_RECEIPT: '/backups/' + empty.file,
  };
  operation('release-migrate.mjs', [], migration);
  operation('release-migrate.mjs', [], migration);
  pass('Release migrations and checksums repeat safely without seeding');
  operation('seed-demo.mjs', [], {
    NODE_ENV: 'development',
    CONFIRM_DEMO_SEED: 'yes',
  });
  pass('Explicit guarded fictional seed in owned disposable database only');
  const data = await snapshot();
  sql('CREATE DATABASE novacart_restore_data');
  operation(
    '../deploy/scripts/backup.mjs',
    ['restore', '/backups/' + data.receipt.file, '/backups/' + data.file],
    {
      RESTORE_DATABASE_URL: admin.replace(/\/novacart$/, '/novacart_restore_data'),
      CONFIRM_DISPOSABLE_RESTORE: 'yes',
    },
  );
  pass('Populated encrypted backup and restore with snapshot row-count comparison');
  const encrypted = await readFile(join(directory, 'backups', data.receipt.file));
  if (encrypted.includes(Buffer.from('Ceramic Accent Vase')))
    throw new Error('Plaintext product data found in encrypted archive');
  const originalHash = sql('SELECT checksum FROM schema_migrations WHERE version=1');
  sql("UPDATE schema_migrations SET checksum=repeat('0',64) WHERE version=1");
  op(
    [
      '-e',
      'CONFIRM_SCHEMA_MIGRATION=apply',
      '-e',
      'MIGRATION_BACKUP_RECEIPT=/backups/' + data.file,
      'operations',
      'release-migrate.mjs',
    ],
    { expectFailure: true, rejection: 'Applied migration checksum mismatch' },
  );
  sql("UPDATE schema_migrations SET checksum='" + originalHash + "' WHERE version=1");
  pass('Changed applied migration checksum is rejected');
  // Matching checksum alone is insufficient: GCM authentication must fail before SQL.
  sql('CREATE DATABASE novacart_restore_tamper');
  const tamper = Buffer.from(encrypted);
  tamper[22] ^= 1;
  const originalReceipt = await readFile(join(directory, 'backups', data.file), 'utf8');
  await writeFile(join(directory, 'backups', data.receipt.file), tamper);
  await writeFile(
    join(directory, 'backups', data.file),
    JSON.stringify({
      ...JSON.parse(originalReceipt),
      sha256: createHash('sha256').update(tamper).digest('hex'),
    }),
  );
  op(
    [
      '-e',
      'RESTORE_DATABASE_URL',
      '-e',
      'CONFIRM_DISPOSABLE_RESTORE=yes',
      'operations',
      '../deploy/scripts/backup.mjs',
      'restore',
      '/backups/' + data.receipt.file,
      '/backups/' + data.file,
    ],
    {
      expectFailure: true,
      rejection: 'Backup/restore failed',
      extra: {
        RESTORE_DATABASE_URL: admin.replace(/\/novacart$/, '/novacart_restore_tamper'),
      },
    },
  );
  if (
    sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'", 'novacart_restore_tamper') !==
    '0'
  )
    throw new Error('Tampered archive reached database restore');
  await writeFile(join(directory, 'backups', data.receipt.file), encrypted);
  await writeFile(join(directory, 'backups', data.file), originalReceipt);
  pass('GCM authentication rejects tampered ciphertext with matching checksum before SQL');
  compose(['up', '-d', '--wait', 'novacart-app', 'nginx']);
  const ca = await readFile(join(secrets, 'tls/cert.pem')),
    password = (await readFile(join(secrets, 'preview_password'), 'utf8')).trim(),
    authorization = 'Basic ' + Buffer.from('preview:' + password).toString('base64');
  async function https(path, { authenticate = true, method = 'GET', body, cookie } = {}) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          ca,
          headers: {
            Host: 'localhost:' + port,
            ...(authenticate ? { Authorization: authorization } : {}),
            ...(body
              ? {
                  'Content-Type': 'application/json',
                  Origin: 'https://localhost:' + port,
                }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (b) => (data += b));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data,
            }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('HTTPS timeout')));
      if (body) req.end(JSON.stringify(body));
      else req.end();
    });
  }
  if ((await https('/', { authenticate: false })).status !== 401)
    throw new Error('Preview access restriction failed');
  const page = await https('/');
  if (
    page.status !== 200 ||
    !page.headers['strict-transport-security'] ||
    !page.headers['content-security-policy']
  )
    throw new Error('TLS/header smoke failed');
  const health = await https('/api/health');
  if (health.status !== 200 || JSON.parse(health.body).mode !== 'DATABASE')
    throw new Error('Database readiness failed');
  pass('CA-verified HTTPS, preview authentication, security headers and real DB health');
  const redirect = compose([
    'exec',
    '-T',
    'novacart-app',
    'node',
    '--input-type=module',
    '-e',
    "import {request} from 'node:http';const req=request('http://nginx:8080/',{headers:{Host:'untrusted.invalid'}},res=>{console.log(res.statusCode+' '+res.headers.location);res.resume()});req.on('error',()=>process.exit(1));req.end()",
  ]);
  if (redirect !== '308 https://localhost:' + port + '/')
    throw new Error('HTTP redirect used untrusted Host');
  pass('HTTP redirect uses canonical approved HTTPS origin');

  const register = await https('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'deployment-fixture@example.test',
      name: 'Fictional Deployment Fixture',
      password: randomBytes(24).toString('hex'),
    },
  });
  if (register.status !== 201) throw new Error('Production-runtime registration fixture failed');
  const cookies = register.headers['set-cookie'];
  if (
    !cookies?.some(
      (c) =>
        c.startsWith('__Host-novacart_session=') && c.includes('Secure') && c.includes('HttpOnly'),
    )
  )
    throw new Error('Secure host session cookie missing');
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  if ((await https('/api/admin/me', { cookie })).status !== 403)
    throw new Error('Customer reached owner route');
  if ((await https('/api/orders', { method: 'POST', cookie, body: {} })).status !== 503)
    throw new Error('Preview accepted disabled orders');
  pass('Secure cookies, customer-owner separation and disabled order acceptance');
  if (compose(['exec', '-T', 'novacart-app', 'node', '-p', 'process.getuid()']) !== '1000')
    throw new Error('App is not non-root');
  compose([
    'exec',
    '-T',
    'novacart-app',
    'node',
    '--import',
    './runtime-env.mjs',
    '--input-type=module',
    '-e',
    "const {database,closeDatabase}=await import('./db.mjs');try{await database().query('CREATE TABLE forbidden_ddl(id int)');process.exitCode=1}catch(e){if(e.code!=='42501')process.exitCode=1}finally{await closeDatabase()}",
  ]);
  for (const service of ['novacart-app', 'novacart-db']) {
    const id = compose(['ps', '-q', service]);
    const binding = JSON.parse(
      docker('inspect', '--format', '{{json .HostConfig.PortBindings}}', id),
    );
    if (binding && Object.keys(binding).length)
      throw new Error('Private service publishes host ports');
  }
  if (compose(['exec', '-T', 'novacart-db', 'id', '-u']) !== '70')
    throw new Error('Database must run as postgres');
  compose(['exec', '-T', 'novacart-db', 'sh', '-c', 'test ! -e /usr/local/bin/gosu']);
  pass('Non-root app/database, denied runtime DDL and no published app/database ports');
  const timings = [];
  for (let i = 0; i < 5; i++)
    await Promise.all(
      [0, 1].map(async () => {
        const start = performance.now();
        if ((await https('/api/products')).status !== 200)
          throw new Error('Basic load request failed');
        timings.push(Math.round(performance.now() - start));
      }),
    );
  result.basicLoad = {
    requests: timings.length,
    concurrency: 2,
    p95Ms: timings.sort((a, b) => a - b)[Math.ceil(timings.length * 0.95) - 1],
    scope: 'Small unthrottled local TLS sample, not capacity certification',
  };
  pass('Bounded concurrent HTTPS catalog smoke load');
  compose(['--profile', 'monitoring', 'up', '-d', 'monitor']);
  await wait(2000);
  const monitorLog = compose(['logs', '--no-color', 'monitor']);
  if (!monitorLog.includes('"healthy":true'))
    throw new Error('HTTPS monitoring did not observe healthy app');
  pass('Optional internal HTTPS monitor observes authenticated database health');
  compose(['stop', 'novacart-app']);
  let monitorState = { failures: 0, active: false };
  const events = [];
  for (let i = 0; i < 3; i++) {
    const next = observe(monitorState, (await https('/api/health')).status === 200);
    monitorState = next.state;
    if (next.event) events.push(next.event);
  }
  compose(['up', '-d', '--no-deps', '--force-recreate', 'novacart-app']);
  compose(['restart', 'nginx']);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      if ((await https('/api/health')).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for this owned listener only. */
    }
    await wait(500);
  }
  if (!ready) throw new Error('Same-image recreate did not recover');
  const recovery = observe(monitorState, true);
  if (recovery.event) events.push(recovery.event);
  if (JSON.stringify(events) !== JSON.stringify(['firing', 'resolved']))
    throw new Error('Controlled outage did not fire and resolve alert state');
  result.alertEvidence = {
    events,
    scope: 'Actual local HTTPS outage/recovery observations, no external webhook delivery',
  };
  pass('Controlled HTTPS outage fires and resolves local alert state; same-image recovery');
  const previousImage = process.argv
    .find((value) => value.startsWith('--rollback-image='))
    ?.split('=')[1];
  if (previousImage) {
    if (!/^sha256:[0-9a-f]{64}$/.test(previousImage))
      throw new Error('Rollback fixture must be a full local image ID');
    if (
      docker('image', 'inspect', previousImage, '--format', '{{.Config.WorkingDir}}') !==
      '/opt/novacart/backend'
    )
      throw new Error('Rollback fixture is not a NovaCart image');
    const candidate = env.APP_IMAGE;
    const candidateId = docker('image', 'inspect', candidate, '--format', '{{.Id}}');
    if (previousImage === candidateId)
      throw new Error('Rollback fixture must be a different version');
    async function switchVersion(image) {
      env.APP_IMAGE = image;
      compose(['up', '-d', '--no-deps', '--wait', 'novacart-app']);
      compose(['restart', 'nginx']);
      let available = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          if ((await https('/api/health')).status === 200 && (await https('/')).status === 200) {
            available = true;
            break;
          }
        } catch {
          // The restarted owned proxy must open its listener before smoke requests.
        }
        await wait(500);
      }
      if (!available) throw new Error('Version switch smoke failed');
      if ((await https('/api/orders', { method: 'POST', cookie, body: {} })).status !== 503)
        throw new Error('Version switch enabled orders');
    }
    await switchVersion(previousImage);
    await switchVersion(candidate);
    result.rollbackEvidence = {
      previousImage,
      candidateImage: candidateId,
      scope:
        'Actual local previous-image rollback and roll-forward on compatible disposable schema; no production rollback or down-migration',
    };
    pass(
      'Previous-image rollback and candidate roll-forward preserve HTTPS health and disabled commerce',
    );
    result.limitations = result.limitations.map((item) =>
      item.replace(
        ' or previous-version rollback verified',
        ' verified; previous-image rollback is local only',
      ),
    );
  }
  result.images = {
    database: docker('image', 'inspect', env.DATABASE_IMAGE, '--format', '{{.Id}}'),
    app: docker('image', 'inspect', env.APP_IMAGE, '--format', '{{.Id}}'),
    operations: docker('image', 'inspect', env.OPERATIONS_IMAGE, '--format', '{{.Id}}'),
    nginx: docker('image', 'inspect', env.NGINX_PROXY_IMAGE, '--format', '{{.Id}}'),
  };
  result.status = 'VERIFIED_LOCAL_PREVIEW';
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (baseArgs.length && result.status === 'FAILED') {
    try {
      await writeFile(
        new URL('deployment-services.log', out),
        compose(['logs', '--no-color', '--tail', '60']),
        { mode: 0o600 },
      );
      const states = [];
      for (const id of compose(['ps', '-aq']).split('\n').filter(Boolean))
        states.push(JSON.parse(docker('inspect', '--format', '{{json .State}}', id)));
      await writeFile(
        new URL('deployment-container-states.json', out),
        JSON.stringify(states, null, 2),
        { mode: 0o600 },
      );
    } catch {
      /* Command diagnostics already retained. */
    }
  }
  if (baseArgs.length) {
    try {
      const ids = compose(['--profile', '*', 'ps', '-aq']).split('\n').filter(Boolean);
      let owned = true;
      for (const id of ids) {
        const labels = JSON.parse(docker('inspect', '--format', '{{json .Config.Labels}}', id));
        if (labels['com.docker.compose.project'] !== project) owned = false;
      }
      if (owned) {
        compose(['--profile', '*', 'down', '--volumes', '--remove-orphans']);
        if (docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project).trim()) {
          result.cleanup = 'UNCONFIRMED';
          result.status = 'FAILED';
          process.exitCode = 1;
        } else result.cleanup = 'OWNED_PROJECT_REMOVED';
      } else {
        result.cleanup = 'OWNERSHIP_MISMATCH';
        result.status = 'FAILED';
        process.exitCode = 1;
      }
    } catch {
      result.cleanup = 'UNCONFIRMED';
      result.status = 'FAILED';
      process.exitCode = 1;
    }
  }
  if (['OWNED_PROJECT_REMOVED', 'NO_RESOURCES_CREATED'].includes(result.cleanup))
    await rm(directory, { recursive: true, force: true });
  result.finishedAt = new Date().toISOString();
  await writeFile(new URL('deployment-summary.json', out), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log('Deployment QA: ' + result.status);
}
