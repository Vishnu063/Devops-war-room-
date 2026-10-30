import * as OTPAuth from 'otpauth';
import { database, transaction } from './db.mjs';
import {
  hashPassword,
  verifyPassword,
  normalizeEmail,
  requireRole,
  sessionDigest,
  newSessionToken,
} from './auth.mjs';
import { currentUser } from './sessions.mjs';
import { fail, object, text, seal, open, audit } from './validation.mjs';

export async function issueIdentityToken(db, user, kind, origin) {
  const token = newSessionToken();
  await db.query(
    'UPDATE identity_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL',
    [user.id, kind],
  );
  const inserted = await db.query(
    "INSERT INTO identity_tokens(user_id,kind,digest,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes') RETURNING id",
    [user.id, kind, sessionDigest(token)],
  );
  const action = kind === 'VERIFY_EMAIL' ? 'verify' : 'reset';
  await db.query('INSERT INTO mail_outbox(user_id,encrypted_payload,event_key) VALUES($1,$2,$3)', [
    user.id,
    seal(
      {
        to: user.email,
        subject:
          kind === 'VERIFY_EMAIL' ? 'Verify your NovaCart account' : 'Reset your NovaCart password',
        text: `Open ${origin}/#${action}=${token}\nThis one-use link expires in 30 minutes. Ignore it if you did not request it.`,
      },
      'mail',
    ),
    'identity:' + inserted.rows[0].id,
  ]);
  return { queued: true };
}
export async function requestIdentity(input, kind, origin) {
  object(input, ['email']);
  const email = normalizeEmail(input.email);
  await transaction(async (db) => {
    const found = await db.query(
      'SELECT id,email,email_verified_at FROM users WHERE lower(email)=$1 AND deleted_at IS NULL FOR UPDATE',
      [email],
    );
    if (found.rows.length && (kind !== 'VERIFY_EMAIL' || !found.rows[0].email_verified_at))
      await issueIdentityToken(db, found.rows[0], kind, origin);
  });
  return {
    message:
      'If the account is eligible, a one-use email has been queued. Delivery requires a configured mail service.',
  };
}
export async function consumeIdentity(input, kind) {
  object(input, kind === 'RESET_PASSWORD' ? ['token', 'password'] : ['token']);
  const token = text(input.token, 'token', 43, 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail('Invalid or expired token');
  const hashed = kind === 'RESET_PASSWORD' ? await hashPassword(input.password) : null;
  return transaction(async (db) => {
    const r = await db.query(
      'SELECT t.*,u.deleted_at FROM identity_tokens t JOIN users u ON u.id=t.user_id WHERE t.digest=$1 AND t.kind=$2 FOR UPDATE OF t,u',
      [sessionDigest(token), kind],
    );
    const t = r.rows[0];
    if (!t || t.used_at || t.deleted_at || new Date(t.expires_at) <= new Date())
      fail('Invalid or expired token');
    await db.query('UPDATE identity_tokens SET used_at=now() WHERE id=$1', [t.id]);
    if (kind === 'VERIFY_EMAIL')
      await db.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [t.user_id]);
    else {
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashed, t.user_id]);
      await db.query('DELETE FROM mfa_enrollments WHERE user_id=$1', [t.user_id]);
      await db.query(
        'UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',
        [t.user_id],
      );
      await db.query(
        'UPDATE identity_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
        [t.user_id],
      );
    }
    await audit(
      db,
      { kind: 'user', id: t.user_id },
      kind === 'VERIFY_EMAIL' ? 'EMAIL_VERIFIED' : 'PASSWORD_RESET',
      'USER',
      t.user_id,
    );
    return { ok: true };
  });
}
export async function requireOwner(req) {
  const user = await currentUser(req);
  requireRole(user, 'OWNER');
  if (user.mfaEnabled) {
    if (!user.mfaVerifiedAt || Date.now() - new Date(user.mfaVerifiedAt) > 20 * 60 * 1000)
      fail('Owner MFA reauthentication required', 403);
  } else if (process.env.NODE_ENV === 'production') fail('Owner MFA enrollment is required', 403);
  return user;
}
function totp(secret, email) {
  return new OTPAuth.TOTP({
    issuer: 'NovaCart',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export async function checkMfa(userId, code, db = database()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail('Authenticator code required', 401);
  const found = await db.query(
    'SELECT email,mfa_secret_encrypted,mfa_last_counter FROM users WHERE id=$1 AND deleted_at IS NULL',
    [userId],
  );
  const user = found.rows[0];
  if (!user?.mfa_secret_encrypted) fail('MFA is not enrolled', 409);
  const value = open(user.mfa_secret_encrypted, 'mfa'),
    delta = totp(value.secret, user.email).validate({ token: code, window: 1 });
  if (delta === null) fail('Invalid authenticator code', 401);
  const counter = Math.floor(Date.now() / 30000) + delta;
  const updated = await db.query(
    'UPDATE users SET mfa_last_counter=$1 WHERE id=$2 AND mfa_last_counter<$1 RETURNING id',
    [counter, userId],
  );
  if (!updated.rows.length) fail('Authenticator code already used', 401);
  return true;
}
export async function beginMfa(req, input) {
  object(input, ['password']);
  const user = await currentUser(req);
  requireRole(user, 'OWNER');
  if (user.mfaEnabled) await requireOwner(req);
  const stored = (await database().query('SELECT password_hash FROM users WHERE id=$1', [user.id]))
    .rows[0];
  if (!(await verifyPassword(input.password, stored.password_hash)))
    fail('Invalid credentials', 401);
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await database().query(
    "INSERT INTO mfa_enrollments(user_id,secret_encrypted,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,expires_at=EXCLUDED.expires_at",
    [user.id, seal({ secret }, 'mfa')],
  );
  return {
    secret,
    uri: totp(secret, user.email).toString(),
    notice: 'Save this authenticator enrollment privately. Confirm before it is enabled.',
  };
}
export async function finishMfa(req, input) {
  object(input, ['code']);
  const user = await currentUser(req);
  requireRole(user, 'OWNER');
  return transaction(async (db) => {
    const r = await db.query(
      'SELECT * FROM mfa_enrollments WHERE user_id=$1 AND expires_at>now() FOR UPDATE',
      [user.id],
    );
    if (!r.rows.length) fail('MFA enrollment expired', 409);
    const secret = open(r.rows[0].secret_encrypted, 'mfa');
    if (
      typeof input.code !== 'string' ||
      totp(secret.secret, user.email).validate({ token: input.code, window: 0 }) === null
    )
      fail('Invalid authenticator code', 401);
    await db.query('UPDATE users SET mfa_secret_encrypted=$1,mfa_last_counter=$2 WHERE id=$3', [
      r.rows[0].secret_encrypted,
      Math.floor(Date.now() / 30000),
      user.id,
    ]);
    await db.query('DELETE FROM mfa_enrollments WHERE user_id=$1', [user.id]);
    await db.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
    await audit(db, { kind: 'user', id: user.id }, 'MFA_ENABLED', 'USER', user.id);
    return { id: user.id };
  });
}
export async function revokeAll(req) {
  const user = await currentUser(req);
  if (!user) fail('Sign in required', 401);
  await database().query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
  return { ok: true };
}
