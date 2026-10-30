// Local development acceptance only. Never connects to caller-provided databases.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.argv.includes('--disposable')) throw new Error('Explicit --disposable flag required');
const directory = fileURLToPath(new URL('../', import.meta.url));
const artifacts = new URL('../test-artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const nonce = randomBytes(8).toString('hex'),
  name = 'novacart-qa-' + nonce,
  password = randomBytes(32).toString('hex');
const docker = ['--host=unix:///var/run/docker.sock'];
const results = {
  runId: nonce,
  startedAt: new Date().toISOString(),
  status: 'FAILED',
  checks: {},
  limitations: [
    'Gateway and SMTP responses are mocked; no live account verification or production deployment.',
  ],
};
let container,
  server,
  paused = false;
const serverOutput = [];
function tool(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}
function d(...args) {
  return tool('docker', [...docker, ...args]).trim();
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of [
    'DATABASE_URL',
    'DATA_ENCRYPTION_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'SMTP_URL',
    'MAIL_FROM',
    'APP_ORIGIN',
    'ALLOW_LIVE_PAYMENTS',
    'PRODUCT_IMAGE_HOSTS',
    'SEO_INDEXABLE',
  ])
    delete env[key];
  return env;
}
async function run(label, args, env) {
  const process = spawn(args[0], args.slice(1), {
    cwd: directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  process.stdout.on('data', (b) => {
    output += b;
  });
  process.stderr.on('data', (b) => {
    output += b;
  });
  const code = await new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', resolve);
  });
  await writeFile(new URL(label + '.log', artifacts), output, { mode: 0o600 });
  if (code !== 0)
    throw new Error(label + ' failed; inspect private test-artifacts/' + label + '.log');
  const tests = output.match(/# tests (\d+)/),
    passes = output.match(/# pass (\d+)/),
    skips = output.match(/# skipped (\d+)/);
  results.checks[label] = {
    exitCode: code,
    ...(tests
      ? {
          tests: Number(tests[1]),
          passed: Number(passes?.[1] || 0),
          skipped: Number(skips?.[1] || 0),
        }
      : {}),
  };
  console.log('PASS: ' + label);
  return output;
}
try {
  await run('static-checks', ['npm', 'run', 'check'], cleanEnvironment());
  const files = (await readdir(directory)).filter((f) => f.endsWith('.test.mjs'));
  await run('unit', [process.execPath, '--test', '--test-reporter=tap', ...files], {
    ...cleanEnvironment(),
    NODE_ENV: 'test',
  });
  d('info', '--format', '{{.ServerVersion}}');
  const dbPort = await freePort();
  container = tool(
    'docker',
    [
      ...docker,
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '--label',
      'novacart.qa=' + nonce,
      '--memory',
      '256m',
      '--cpus',
      '1',
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=novacart_test_integration',
      '-p',
      '127.0.0.1:' + dbPort + ':5432',
      'postgres:16-alpine',
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password } },
  ).trim();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      d('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
      ready = true;
      break;
    } catch {
      await delay(300);
    }
  }
  if (!ready) throw new Error('Disposable PostgreSQL not ready');
  const common = {
    ...cleanEnvironment(),
    NODE_ENV: 'test',
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${dbPort}/novacart_test_integration`,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    COD_ENABLED: 'true',
    AUTH_RATE_MAX: '100',
    CONFIRM_TEST_DATABASE: 'yes',
    RUN_JOBS: 'false',
  };
  await run(
    'postgresql',
    [process.execPath, '--test', '--test-reporter=tap', 'test/integration.test.mjs'],
    common,
  );
  const client = new pg.Client({ connectionString: common.DATABASE_URL });
  await client.connect();
  results.postgresqlVersion = (await client.query('SHOW server_version')).rows[0].server_version;
  results.migrations = (
    await client.query('SELECT version FROM schema_migrations ORDER BY version')
  ).rows.map((r) => r.version);
  await client.query('CREATE DATABASE novacart_test_browser');
  await client.end();
  const port = await freePort(),
    env = {
      ...common,
      DATABASE_URL: common.DATABASE_URL.replace(
        '/novacart_test_integration',
        '/novacart_test_browser',
      ),
      QA_RUN_ID: nonce,
      QA_OWNER_PASSWORD: randomBytes(24).toString('base64url'),
      PORT: String(port),
      QA_PORT: String(port),
    };
  env.CHROMIUM_EXECUTABLE =
    process.env.CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : '');
  await run('browser-migrate', [process.execPath, 'migrate.mjs'], {
    ...env,
    NODE_ENV: 'development',
    CONFIRM_DEMO_SCHEMA: 'yes',
  });
  await run('browser-seed', [process.execPath, 'seed-demo.mjs'], {
    ...env,
    NODE_ENV: 'development',
    CONFIRM_DEMO_SEED: 'yes',
  });
  server = spawn(process.execPath, ['--max-old-space-size=512', 'server.mjs'], {
    cwd: directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => serverOutput.push(b.toString()));
  server.stderr.on('data', (b) => serverOutput.push(b.toString()));
  const base = 'http://127.0.0.1:' + port;
  let live = false;
  for (let i = 0; i < 60; i++) {
    try {
      const health = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if ((await health.json()).testRunId === nonce) {
        live = true;
        break;
      }
    } catch {
      /* Wait for this run's exact readiness nonce, not an unrelated listener. */
    }
    await delay(200);
  }
  if (!live) throw new Error('Owned QA server did not become ready');
  await run('browser', [process.execPath, 'node_modules/@playwright/test/cli.js', 'test'], env);
  const report = JSON.parse(await readFile(new URL('browser-results.json', artifacts), 'utf8'));
  if (
    new Date(report.stats.startTime) < new Date(results.startedAt) ||
    report.stats.unexpected ||
    report.stats.skipped ||
    report.stats.expected < 4
  )
    throw new Error('Browser report does not establish all selected journeys');
  results.checks.browser = {
    passed: report.stats.expected,
    failed: report.stats.unexpected,
    skipped: report.stats.skipped,
  };
  const samples = [];
  function collect(suite) {
    for (const spec of suite.specs || [])
      for (const test of spec.tests || [])
        for (const note of test.annotations || [])
          if (note.type === 'local-performance') samples.push(JSON.parse(note.description));
    for (const child of suite.suites || []) collect(child);
  }
  for (const suite of report.suites || []) collect(suite);
  results.localPerformance = samples;
  const api = await fetch(base + '/api/products');
  const catalog = await api.json();
  if (!catalog.items.length) throw new Error('No actual catalog products');
  results.browser = env.CHROMIUM_EXECUTABLE
    ? tool(env.CHROMIUM_EXECUTABLE, ['--version']).trim()
    : 'Playwright bundled browser';
  const nodeStatus = await readFile('/proc/' + server.pid + '/status', 'utf8').catch(() => '');
  results.nodePeakRss = nodeStatus.match(/^VmHWM:\s+(.+)$/m)?.[1] || 'unavailable';
  results.databaseResourceSample = d(
    'stats',
    '--no-stream',
    '--format',
    '{{.MemUsage}} | {{.CPUPerc}}',
    container,
  );
  // Read-only fault: keep the same port/data, then prove health recovers. No repair/production action.
  d('pause', container);
  paused = true;
  const down = await fetch(base + '/api/health', { signal: AbortSignal.timeout(9000) });
  if (down.status !== 503) throw new Error('Database outage was not reported unavailable');
  d('unpause', container);
  paused = false;
  let recovered = false;
  for (let i = 0; i < 20; i++) {
    try {
      if (
        (await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) })).status === 200
      ) {
        recovered = true;
        break;
      }
    } catch {
      /* In-flight driver timeout can finish after unpause. */
    }
    await delay(300);
  }
  if (!recovered)
    throw new Error('Application did not recover after the disposable database resumed');
  results.checks.databaseRecovery = { unavailableStatus: 503, recoveredStatus: 200 };
  await run('dependency-audit', ['npm', 'audit', '--json'], cleanEnvironment());
  results.status = 'VERIFIED_LOCAL';
} catch (error) {
  results.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (paused && container) {
    try {
      d('unpause', container);
    } catch {
      /* Removal below is still restricted to this immutable owned ID. */
    }
  }
  if (server) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('close', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (container) {
    try {
      const labels = JSON.parse(d('inspect', '--format', '{{json .Config.Labels}}', container));
      if (labels['novacart.qa'] !== nonce) {
        results.cleanup = 'OWNERSHIP_CHANGED_NOT_REMOVED';
        results.status = 'FAILED';
        process.exitCode = 1;
      } else {
        d('rm', '-f', '-v', container);
        results.cleanup = 'OWNED_RESOURCES_REMOVED';
      }
    } catch {
      results.cleanup = 'UNCONFIRMED';
      results.status = 'FAILED';
      results.error = 'Disposable cleanup needs inspection; no unverified resources were removed';
      process.exitCode = 1;
    }
  }
  results.finishedAt = new Date().toISOString();
  results.nodeVersion = process.version;
  await writeFile(new URL('qa-summary.json', artifacts), JSON.stringify(results, null, 2) + '\n', {
    mode: 0o600,
  });
  await writeFile(new URL('server.log', artifacts), serverOutput.join(''), { mode: 0o600 });
  console.log('QA result: ' + results.status + '; summary in test-artifacts/qa-summary.json');
}
