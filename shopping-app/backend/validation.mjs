import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function object(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail('Invalid request fields');
  return value;
}
export function text(value, name, min = 1, max = 200) {
  if (
    typeof value !== 'string' ||
    value.trim().length < min ||
    value.trim().length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))
  )
    fail('Invalid ' + name);
  return value.trim();
}
export function integer(value, name, min = 0, max = 1_000_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Invalid ' + name);
  return value;
}
export function uuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    fail('Invalid identifier');
  return value.toLowerCase();
}
export function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value))
    fail('Invalid idempotency key');
  return value;
}
export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function lines(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    fail('Cart must contain 1–50 lines');
  const seen = new Set();
  return value
    .map((line) => {
      if (!line || typeof line !== 'object') fail('Invalid cart line');
      const variantId = uuid(line.variantId);
      if (seen.has(variantId)) fail('Duplicate variant');
      seen.add(variantId);
      return { variantId, quantity: integer(line.quantity, 'quantity', 1, 99) };
    })
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}
export function address(value) {
  object(value, ['recipient', 'phone', 'line1', 'line2', 'city', 'state', 'pincode']);
  const pincode = text(value.pincode, 'PIN', 6, 6);
  if (!/^[1-9][0-9]{5}$/.test(pincode)) fail('Invalid Indian PIN');
  const phone = text(value.phone, 'phone', 10, 14).replace(/^\+91/, '');
  if (!/^[6-9][0-9]{9}$/.test(phone)) fail('Invalid Indian phone');
  return {
    recipient: text(value.recipient, 'recipient', 2, 100),
    phone,
    line1: text(value.line1, 'address', 3, 200),
    line2: value.line2 ? text(value.line2, 'address', 0, 200) : '',
    city: text(value.city, 'city', 2, 100),
    state: text(value.state, 'state', 2, 100),
    pincode,
  };
}
function encryptionKey() {
  if (!/^[0-9a-f]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ''))
    fail('Sensitive-data encryption is not configured', 503);
  return Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex');
}
export function seal(value, purpose) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}
export function open(value, purpose) {
  if (!value || value.v !== 1) fail('Encrypted data unavailable', 503);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ]).toString(),
  );
}
export function money(value) {
  return integer(Number(value), 'stored money', 0, Number.MAX_SAFE_INTEGER);
}
export const effectivePrice = `CASE WHEN v.sale_price_paise IS NOT NULL AND (v.sale_starts_at IS NULL OR v.sale_starts_at<=now()) AND (v.sale_ends_at IS NULL OR v.sale_ends_at>now()) THEN v.sale_price_paise ELSE v.price_paise END`;
export async function audit(db, actor, action, type, id, details = {}) {
  await db.query(
    'INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [actor?.kind === 'user' ? actor.id : null, action, type, String(id), JSON.stringify(details)],
  );
}
export async function notify(db, actor, kind, title, eventKey) {
  await db.query(
    'INSERT INTO notifications(user_id,guest_id,kind,title,event_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING',
    [
      actor.kind === 'user' ? actor.id : null,
      actor.kind === 'guest' ? actor.id : null,
      kind,
      title,
      eventKey,
    ],
  );
}
export const actorColumn = (actor) => (actor.kind === 'user' ? 'user_id' : 'guest_id');
export function orderActor(order) {
  return order.user_id
    ? { kind: 'user', id: order.user_id }
    : { kind: 'guest', id: order.guest_id };
}
