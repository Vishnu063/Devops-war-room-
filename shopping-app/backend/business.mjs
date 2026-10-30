import { randomBytes } from 'node:crypto';
import { database, transaction } from './db.mjs';
import { object, text, integer, fail, audit, digest, money } from './validation.mjs';
import { creditBalance } from './commerce.mjs';
export async function saveCoupon(actor, input) {
  object(input, [
    'code',
    'type',
    'value',
    'minimumPaise',
    'startsAt',
    'endsAt',
    'usageLimit',
    'active',
  ]);
  const code = text(input.code, 'coupon code', 3, 40).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code) || !['PERCENT', 'FIXED'].includes(input.type))
    fail('Invalid coupon');
  const value = integer(
      input.value,
      'coupon value',
      1,
      input.type === 'PERCENT' ? 100 : 1000000000,
    ),
    minimum = integer(input.minimumPaise ?? 0, 'minimum', 0, 100000000000);
  const dates = ['startsAt', 'endsAt'].map((k) => {
    if (input[k] == null) return null;
    const d = new Date(input[k]);
    if (typeof input[k] !== 'string' || !Number.isFinite(+d)) fail('Invalid coupon date');
    return d.toISOString();
  });
  if (dates[0] && dates[1] && dates[1] <= dates[0]) fail('Invalid coupon window');
  const limit =
    input.usageLimit == null ? null : integer(input.usageLimit, 'usage limit', 1, 1000000);
  if (input.active !== undefined && typeof input.active !== 'boolean')
    fail('Invalid coupon active flag');
  return transaction(async (db) => {
    const r = await db.query(
      'INSERT INTO coupons(code,type,value,minimum_paise,starts_at,ends_at,usage_limit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code) DO UPDATE SET type=EXCLUDED.type,value=EXCLUDED.value,minimum_paise=EXCLUDED.minimum_paise,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,usage_limit=EXCLUDED.usage_limit,active=EXCLUDED.active RETURNING id',
      [code, input.type, value, minimum, ...dates, limit, input.active ?? true],
    );
    await audit(db, actor, 'COUPON_SAVED', 'COUPON', r.rows[0].id);
    return r.rows[0];
  });
}
export async function issueGift(actor, input) {
  object(input, ['amountPaise', 'expiresAt']);
  const amount = integer(input.amountPaise, 'gift amount', 100, 10000000);
  const expiry = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiry && (!Number.isFinite(+expiry) || expiry <= new Date())) fail('Invalid gift expiry');
  const code = randomBytes(18).toString('base64url');
  return transaction(async (db) => {
    const r = await db.query(
      'INSERT INTO gift_cards(code_sha256,amount_paise,expires_at) VALUES($1,$2,$3) RETURNING id',
      [digest(code), amount, expiry],
    );
    await audit(db, actor, 'GIFT_CREDIT_ISSUED', 'GIFT_CARD', r.rows[0].id, {
      amountPaise: amount,
    });
    return {
      id: r.rows[0].id,
      code,
      notice:
        'One-time display of owner-issued store credit. This is not a purchased payment instrument.',
    };
  });
}
export async function redeemGift(actor, input) {
  if (actor.kind !== 'user') fail('Sign in required', 401);
  object(input, ['code']);
  const code = text(input.code, 'gift code', 24, 24);
  return transaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
    const card = (
      await db.query('SELECT * FROM gift_cards WHERE code_sha256=$1 FOR UPDATE', [digest(code)])
    ).rows[0];
    if (!card || card.redeemed_by || (card.expires_at && new Date(card.expires_at) <= new Date()))
      fail('Gift credit unavailable', 409);
    await db.query('UPDATE gift_cards SET redeemed_by=$1 WHERE id=$2', [actor.id, card.id]);
    await db.query(
      "INSERT INTO credit_ledger(user_id,amount_paise,reason,event_key) VALUES($1,$2,'GIFT_CREDIT',$3)",
      [actor.id, money(card.amount_paise), 'gift:' + card.id],
    );
    await audit(db, actor, 'GIFT_CREDIT_REDEEMED', 'GIFT_CARD', card.id);
    return { balancePaise: await creditBalance(db, actor) };
  });
}
export async function content(actor, key, input) {
  if (!['homepage', 'policy-preview', 'campaign'].includes(key)) fail('Unknown content block');
  object(input, ['title', 'body', 'enabled']);
  const value = {
    title: text(input.title, 'title', 3, 120),
    body: text(input.body, 'content', 1, 2000),
    enabled: input.enabled === true,
  };
  return transaction(async (db) => {
    await db.query(
      'INSERT INTO content_blocks(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
      [key, JSON.stringify(value)],
    );
    await audit(db, actor, 'CONTENT_UPDATED', 'CONTENT', key);
    return { ok: true };
  });
}
export async function report() {
  const db = database();
  const orders = (
    await db.query(
      "SELECT count(*)::int AS orders,count(*) FILTER(WHERE status='CANCELLED')::int AS cancelled,count(*) FILTER(WHERE status='DELIVERED')::int AS delivered,COALESCE(sum(total_paise) FILTER(WHERE payment_status='PAID'),0)::text AS recorded_paid_order_paise FROM orders",
    )
  ).rows[0];
  const refunds = (
    await db.query(
      "SELECT COALESCE(sum(amount_paise),0)::text AS processed_refund_paise FROM refunds WHERE status='PROCESSED'",
    )
  ).rows[0];
  const lowStock = (
    await db.query(
      'SELECT v.id,v.sku,v.stock_on_hand-v.stock_reserved AS available FROM variants v WHERE v.active AND v.stock_on_hand-v.stock_reserved<=10 ORDER BY available,sku LIMIT 100',
    )
  ).rows;
  return {
    orders,
    refunds,
    lowStock,
    scope:
      'Actual development database records, not audited financial revenue or real-business sales claims',
  };
}
export function csv(rows, columns) {
  const cell = (value) => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    [
      columns.map(cell).join(','),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(',')),
    ].join('\r\n') + '\r\n'
  );
}
