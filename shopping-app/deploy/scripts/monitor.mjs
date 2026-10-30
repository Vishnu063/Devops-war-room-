import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function observe(state, healthy, threshold = 3) {
  const failures = healthy ? 0 : state.failures + 1;
  const active = healthy ? false : state.active || failures >= threshold;
  return {
    state: { failures, active },
    event: !state.active && active ? 'firing' : state.active && !active ? 'resolved' : null,
  };
}
export async function probe() {
  const url = new URL(process.env.MONITOR_URL || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search)
    throw new Error('Canonical HTTPS health URL required');
  const credential = process.env.MONITOR_AUTH_FILE
    ? (await readFile(process.env.MONITOR_AUTH_FILE, 'utf8')).trim()
    : null;
  return new Promise((resolve) => {
    const req = request(
      url,
      {
        headers: {
          ...(credential
            ? { Authorization: 'Basic ' + Buffer.from(credential).toString('base64') }
            : {}),
          ...(process.env.MONITOR_HOST ? { Host: process.env.MONITOR_HOST } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy();
        });
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 && JSON.parse(body).mode === 'DATABASE');
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.setTimeout(8000, () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}
export async function alert(event) {
  if (!process.env.ALERT_WEBHOOK_URL) return { blocked: true };
  const url = new URL(process.env.ALERT_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Approved HTTPS alert endpoint required');
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      fingerprint: 'novacart-preview-health',
      status: event,
      observedAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Alert delivery failed');
  return { delivered: true };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let state = { failures: 0, active: false };
  const seconds = Number(process.env.MONITOR_INTERVAL_SECONDS || 60);
  if (!Number.isSafeInteger(seconds) || seconds < 10) throw new Error('Invalid monitor interval');
  do {
    const healthy = await probe(),
      next = observe(state, healthy);
    state = next.state;
    console.log(
      JSON.stringify({ event: 'health_probe', healthy, consecutiveFailures: state.failures }),
    );
    if (next.event) {
      try {
        const delivery = await alert(next.event);
        console.log(JSON.stringify({ event: 'health_alert', status: next.event, ...delivery }));
      } catch {
        console.error(JSON.stringify({ event: 'alert_delivery_failed', status: next.event }));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  } while (process.argv[2] === 'schedule');
}
