import test from 'node:test';
import assert from 'node:assert/strict';
import { observe } from '../deploy/scripts/monitor.mjs';
import { databaseIdentity } from '../deploy/scripts/backup.mjs';
import { validateConfiguration } from './config.mjs';
test('monitor triggers once after threshold and resolves once after recovery', () => {
  let state = { failures: 0, active: false };
  const events = [];
  for (const healthy of [true, false, false, false, false, true, true]) {
    const next = observe(state, healthy);
    state = next.state;
    if (next.event) events.push(next.event);
  }
  assert.deepEqual(events, ['firing', 'resolved']);
});
test('backup identity binds host, port and database, without including passwords', () => {
  assert.equal(
    databaseIdentity('postgresql://one:fictional@db/novacart'),
    databaseIdentity('postgresql://two:different@db:5432/novacart'),
  );
  assert.notEqual(
    databaseIdentity('postgresql://one:fictional@db/novacart'),
    databaseIdentity('postgresql://one:fictional@db/another'),
  );
});
test('preview rejects live payment activation and arbitrary bind addresses', () => {
  const previous = { ...process.env };
  try {
    process.env.RELEASE_MODE = 'preview';
    process.env.ALLOW_LIVE_PAYMENTS = 'true';
    assert.throws(validateConfiguration, /Preview cannot/);
    delete process.env.ALLOW_LIVE_PAYMENTS;
    process.env.BIND_HOST = 'public.example';
    assert.throws(validateConfiguration, /Invalid BIND_HOST/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k];
    Object.assign(process.env, previous);
  }
});

test('malformed private database URLs cannot leak credential input from startup validation', () => {
  const previous = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://fixture:private-fixture@[invalid';
    assert.throws(validateConfiguration, (error) => {
      assert.equal(error.message, 'Invalid service URL configuration');
      assert.equal('input' in error, false);
      assert.equal('cause' in error, false);
      assert.ok(!String(error.stack).includes('private-fixture'));
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
