// Development API protections. Use a shared rate-limit store before scaling.
const attempts = new Map();
export function checkRateLimit(key, { max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (attempts.size >= 10000) {
    for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
    if (attempts.size >= 10000) attempts.delete(attempts.keys().next().value);
  }
  const state = attempts.get(key);
  if (!state || state.reset <= now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  state.count++;
  return { allowed: state.count <= max, retryAfter: Math.ceil((state.reset - now) / 1000) };
}
export function verifySameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const u = new URL(origin);
    return (
      origin === u.origin &&
      !u.username &&
      !u.password &&
      u.pathname === '/' &&
      !u.search &&
      !u.hash &&
      u.origin ===
        (process.env.APP_ORIGIN || (req.socket?.encrypted ? 'https' : 'http') + '://' + host) &&
      req.headers['sec-fetch-site'] !== 'cross-site'
    );
  } catch {
    return false;
  }
}
export function requireJson(req) {
  return req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}
export function clientAddress(req) {
  return req.socket.remoteAddress || 'unknown';
}

export async function databaseRateLimit(
  key,
  { max = Number(process.env.AUTH_RATE_MAX || 8), windowMs = 900000 } = {},
) {
  const { database } = await import('./db.mjs');
  const { digest } = await import('./validation.mjs');
  const result = await database().query(
    `INSERT INTO auth_attempts(key,count,reset_at) VALUES($1,1,now()+$2*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_attempts.reset_at<=now() THEN 1 ELSE auth_attempts.count+1 END,reset_at=CASE WHEN auth_attempts.reset_at<=now() THEN EXCLUDED.reset_at ELSE auth_attempts.reset_at END RETURNING count,reset_at`,
    [digest(key), windowMs],
  );
  return {
    allowed: result.rows[0].count <= max,
    retryAfter: Math.max(1, Math.ceil((new Date(result.rows[0].reset_at) - Date.now()) / 1000)),
  };
}
