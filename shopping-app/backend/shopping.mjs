import { database, transaction } from './db.mjs';
import { currentUser, guestToken } from './sessions.mjs';
import { newSessionToken, sessionDigest } from './auth.mjs';
import {
  actorColumn,
  uuid,
  integer,
  object,
  address,
  seal,
  open,
  fail,
  effectivePrice,
} from './validation.mjs';
import { price } from './pricing.mjs';

export async function principal(req) {
  const user = await currentUser(req);
  if (user) return { kind: 'user', id: user.id, user };
  const match = guestToken(req.headers.cookie);
  if (match) {
    const r = await database().query(
      'SELECT id FROM guest_sessions WHERE token_sha256=$1 AND expires_at>now()',
      [sessionDigest(match)],
    );
    if (r.rows.length) return { kind: 'guest', id: r.rows[0].id };
  }
  return null;
}
export async function guest() {
  const token = newSessionToken();
  await database().query(
    "INSERT INTO guest_sessions(token_sha256,expires_at) VALUES($1,now()+interval '30 days')",
    [sessionDigest(token)],
  );
  return token;
}
export function requireActor(actor) {
  if (!actor) fail('Sign in or start a guest session', 401);
  return actor;
}
export async function cart(actor) {
  const col = actorColumn(actor),
    db = database();
  const r = await db.query(
    `SELECT v.id AS "variantId",ci.quantity,p.id AS "productId",p.title AS name,${effectivePrice} AS "pricePaise",v.stock_on_hand-v.stock_reserved AS stock,p.active AND v.active AS active FROM carts c JOIN cart_items ci ON ci.cart_id=c.id JOIN variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE c.${col}=$1 ORDER BY v.id`,
    [actor.id],
  );
  return { items: r.rows };
}
export async function changeCart(actor, input) {
  object(input, ['variantId', 'quantity']);
  const variant = uuid(input.variantId),
    quantity = integer(input.quantity, 'quantity', 0, 99),
    col = actorColumn(actor);
  return transaction(async (db) => {
    await db.query(
      `SELECT id FROM ${actor.kind === 'user' ? 'users' : 'guest_sessions'} WHERE id=$1 FOR UPDATE`,
      [actor.id],
    );
    const c = await db.query(
      `INSERT INTO carts(${col}) VALUES($1) ON CONFLICT(${col}) DO UPDATE SET updated_at=now() RETURNING id`,
      [actor.id],
    );
    if (quantity) {
      await price(db, [{ variantId: variant, quantity }]);
      await db.query(
        'INSERT INTO cart_items(cart_id,variant_id,quantity) VALUES($1,$2,$3) ON CONFLICT(cart_id,variant_id) DO UPDATE SET quantity=EXCLUDED.quantity',
        [c.rows[0].id, variant, quantity],
      );
    } else
      await db.query('DELETE FROM cart_items WHERE cart_id=$1 AND variant_id=$2', [
        c.rows[0].id,
        variant,
      ]);
    return { ok: true };
  });
}
export async function wishlist(actor) {
  const table = actor.kind === 'user' ? 'wishlists' : 'guest_wishlists',
    col = actorColumn(actor);
  return {
    items: (
      await database().query(
        `SELECT p.id,p.slug,p.title AS name FROM ${table} w JOIN products p ON p.id=w.product_id WHERE w.${col}=$1 AND p.active ORDER BY p.title`,
        [actor.id],
      )
    ).rows,
  };
}
export async function changeWish(actor, productId, remove = false) {
  const id = uuid(productId),
    table = actor.kind === 'user' ? 'wishlists' : 'guest_wishlists',
    col = actorColumn(actor);
  if (remove)
    await database().query(`DELETE FROM ${table} WHERE ${col}=$1 AND product_id=$2`, [
      actor.id,
      id,
    ]);
  else {
    const p = await database().query('SELECT id FROM products WHERE id=$1 AND active', [id]);
    if (!p.rows.length) fail('Product not found', 404);
    await database().query(
      `INSERT INTO ${table}(${col},product_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [actor.id, id],
    );
  }
  return { ok: true };
}
export async function mergeGuest(req, userId) {
  const match = guestToken(req.headers.cookie);
  if (!match) return;
  await transaction(async (db) => {
    const g = await db.query(
      'SELECT id FROM guest_sessions WHERE token_sha256=$1 AND expires_at>now() FOR UPDATE',
      [sessionDigest(match)],
    );
    if (!g.rows.length) return;
    const guestId = g.rows[0].id;
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const c = await db.query(
      'INSERT INTO carts(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET updated_at=now() RETURNING id',
      [userId],
    );
    await db.query(
      `INSERT INTO cart_items(cart_id,variant_id,quantity) SELECT $1,ci.variant_id,ci.quantity FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.guest_id=$2 ON CONFLICT(cart_id,variant_id) DO UPDATE SET quantity=LEAST(99,cart_items.quantity+EXCLUDED.quantity)`,
      [c.rows[0].id, guestId],
    );
    await db.query(
      'INSERT INTO wishlists(user_id,product_id) SELECT $1,product_id FROM guest_wishlists WHERE guest_id=$2 ON CONFLICT DO NOTHING',
      [userId, guestId],
    );
    await db.query(
      'UPDATE orders SET user_id=$1,guest_id=NULL WHERE guest_id=$2 AND user_id IS NULL',
      [userId, guestId],
    );
    await db.query('UPDATE notifications SET user_id=$1,guest_id=NULL WHERE guest_id=$2', [
      userId,
      guestId,
    ]);
    await db.query('UPDATE support_tickets SET user_id=$1,guest_id=NULL WHERE guest_id=$2', [
      userId,
      guestId,
    ]);
    await db.query('DELETE FROM carts WHERE guest_id=$1', [guestId]);
    await db.query('UPDATE guest_sessions SET expires_at=now() WHERE id=$1', [guestId]);
  });
}
export async function addresses(actor) {
  if (actor.kind !== 'user') fail('Sign in to save addresses', 401);
  return {
    items: (
      await database().query(
        'SELECT id,encrypted_payload FROM addresses WHERE user_id=$1 ORDER BY created_at DESC',
        [actor.id],
      )
    ).rows.map((r) => ({ id: r.id, ...open(r.encrypted_payload, 'address') })),
  };
}
export async function saveAddress(actor, input) {
  if (actor.kind !== 'user') fail('Sign in to save addresses', 401);
  const a = address(input);
  const count = await database().query(
    'SELECT count(*)::int AS n FROM addresses WHERE user_id=$1',
    [actor.id],
  );
  if (count.rows[0].n >= 20) fail('Address book is full', 409);
  const r = await database().query(
    "INSERT INTO addresses(user_id,recipient,phone,line1,city,state,pincode,encrypted_payload) VALUES($1,'[encrypted]','[encrypted]','[encrypted]','[encrypted]','[encrypted]',$2,$3) RETURNING id",
    [actor.id, a.pincode, seal(a, 'address')],
  );
  return { id: r.rows[0].id };
}
export async function resolveAddress(db, actor, input, addressId) {
  if (addressId) {
    if (actor.kind !== 'user') fail('Address not found', 404);
    const r = await db.query('SELECT encrypted_payload FROM addresses WHERE id=$1 AND user_id=$2', [
      uuid(addressId),
      actor.id,
    ]);
    if (!r.rows.length) fail('Address not found', 404);
    return address(open(r.rows[0].encrypted_payload, 'address'));
  }
  return address(input);
}
