import { database } from './db.mjs';
import { newSessionToken, sessionDigest, publicUser } from './auth.mjs';
const ttlMs = 7 * 24 * 60 * 60 * 1000;
export async function createSession(userId, { mfaVerified = false } = {}) {
  const token = newSessionToken();
  await database().query(
    'INSERT INTO user_sessions(user_id,token_sha256,expires_at,mfa_verified_at) VALUES($1,$2,$3,$4)',
    [userId, sessionDigest(token), new Date(Date.now() + ttlMs), mfaVerified ? new Date() : null],
  );
  return token;
}
export function cookieToken(cookie, name) {
  if (typeof cookie !== 'string') return null;
  const fields = cookie
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  if (fields.length !== 1) return null;
  const value = fields[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function parseSessionCookie(cookie) {
  if (process.env.NODE_ENV === 'production') return cookieToken(cookie, '__Host-novacart_session');
  return cookieToken(cookie, 'novacart_session') || cookieToken(cookie, '__Host-novacart_session');
}
export function guestToken(cookie) {
  return cookieToken(
    cookie,
    process.env.NODE_ENV === 'production' ? '__Host-novacart_guest' : 'novacart_guest',
  );
}
export function sessionCookie(token, { secure = true } = {}) {
  return (
    (secure ? '__Host-novacart_session=' : 'novacart_session=') +
    token +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800' +
    (secure ? '; Secure' : '')
  );
}
export function clearSessionCookie({ secure = true } = {}) {
  return (
    (secure ? '__Host-novacart_session=' : 'novacart_session=') +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' +
    (secure ? '; Secure' : '')
  );
}
export async function currentUser(req) {
  const token = parseSessionCookie(req.headers.cookie);
  if (!token) return null;
  const result = await database().query(
    `SELECT u.id,u.email,u.name,u.role,u.email_verified_at,(u.mfa_secret_encrypted IS NOT NULL) AS mfa_enabled,s.mfa_verified_at FROM user_sessions s
 JOIN users u ON u.id=s.user_id WHERE s.token_sha256=$1 AND s.revoked_at IS NULL
 AND s.expires_at>now() AND u.deleted_at IS NULL LIMIT 1`,
    [sessionDigest(token)],
  );
  return result.rows.length
    ? { ...publicUser(result.rows[0]), mfaVerifiedAt: result.rows[0].mfa_verified_at }
    : null;
}
export async function revokeSession(req) {
  const token = parseSessionCookie(req.headers.cookie);
  if (token)
    await database().query(
      'UPDATE user_sessions SET revoked_at=now() WHERE token_sha256=$1 AND revoked_at IS NULL',
      [sessionDigest(token)],
    );
}
