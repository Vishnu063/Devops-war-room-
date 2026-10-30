import { database, transaction } from './db.mjs';
import { getOrder, creditBalance } from './commerce.mjs';
import { addresses } from './shopping.mjs';
import { verifyPassword } from './auth.mjs';
import {
  object,
  text,
  integer,
  uuid,
  fail,
  actorColumn,
  audit,
  notify,
  seal,
} from './validation.mjs';
export async function engagement(actor, productId, input, kind) {
  if (actor.kind !== 'user') fail('Sign in required', 401);
  const id = uuid(productId);
  return transaction(async (db) => {
    const p = await db.query('SELECT id FROM products WHERE id=$1 AND active', [id]);
    if (!p.rows.length) fail('Product not found', 404);
    if (kind === 'review') {
      object(input, ['rating', 'body']);
      const rating = integer(input.rating, 'rating', 1, 5),
        body = text(input.body, 'review', 10, 2000);
      const bought = await db.query(
        "SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id JOIN variants v ON v.id=i.variant_id WHERE o.user_id=$1 AND v.product_id=$2 AND o.status IN('DELIVERED','RETURN_REQUESTED','RETURNED') LIMIT 1",
        [actor.id, id],
      );
      if (!bought.rows.length) fail('Reviews require a delivered purchase', 403);
      const r = await db.query(
        "INSERT INTO reviews(product_id,user_id,rating,body) VALUES($1,$2,$3,$4) ON CONFLICT(product_id,user_id) DO UPDATE SET rating=EXCLUDED.rating,body=EXCLUDED.body,moderation_status='PENDING' RETURNING id",
        [id, actor.id, rating, body],
      );
      return { id: r.rows[0].id, status: 'PENDING' };
    }
    object(input, ['question']);
    const r = await db.query(
      'INSERT INTO product_questions(product_id,user_id,question) VALUES($1,$2,$3) RETURNING id',
      [id, actor.id, text(input.question, 'question', 10, 1000)],
    );
    return r.rows[0];
  });
}
export async function moderate(actor, id, input, kind) {
  return transaction(async (db) => {
    if (kind === 'review') {
      object(input, ['status']);
      if (!['APPROVED', 'REJECTED'].includes(input.status)) fail('Invalid moderation state');
      const r = await db.query('UPDATE reviews SET moderation_status=$1 WHERE id=$2 RETURNING id', [
        input.status,
        uuid(id),
      ]);
      if (!r.rows.length) fail('Review not found', 404);
    } else {
      object(input, ['answer', 'approved']);
      if (typeof input.approved !== 'boolean') fail('Invalid publication state');
      const r = await db.query(
        'UPDATE product_questions SET answer=$1,approved=$2 WHERE id=$3 RETURNING id',
        [text(input.answer, 'answer', 1, 2000), input.approved, uuid(id)],
      );
      if (!r.rows.length) fail('Question not found', 404);
    }
    await audit(db, actor, 'CONTENT_MODERATED', kind.toUpperCase(), id);
    return { ok: true };
  });
}

export async function support(actor, input) {
  object(input, ['subject', 'message', 'orderId']);
  return transaction(async (db) => {
    if (input.orderId) {
      const found = await db.query(
        `SELECT id FROM orders WHERE id=$1 AND ${actorColumn(actor)}=$2`,
        [uuid(input.orderId), actor.id],
      );
      if (!found.rows.length) fail('Order not found', 404);
    }
    const r = await db.query(
      'INSERT INTO support_tickets(user_id,guest_id,order_id,subject) VALUES($1,$2,$3,$4) RETURNING id',
      [
        actor.kind === 'user' ? actor.id : null,
        actor.kind === 'guest' ? actor.id : null,
        input.orderId || null,
        text(input.subject, 'subject', 3, 150),
      ],
    );
    await db.query('INSERT INTO support_messages(ticket_id,author_id,body) VALUES($1,$2,$3)', [
      r.rows[0].id,
      actor.kind === 'user' ? actor.id : null,
      text(input.message, 'message', 5, 3000),
    ]);
    await audit(db, actor, 'SUPPORT_CREATED', 'TICKET', r.rows[0].id);
    return r.rows[0];
  });
}
export async function tickets(actor, { owner = false } = {}) {
  const rows = (
    await database().query(
      `SELECT id,order_id,subject,status,created_at FROM support_tickets ${owner ? '' : `WHERE ${actorColumn(actor)}=$1`} ORDER BY created_at DESC LIMIT 100`,
      owner ? [] : [actor.id],
    )
  ).rows;
  return {
    items: await Promise.all(
      rows.map(async (t) => ({
        ...t,
        messages: (
          await database().query(
            "SELECT m.id,m.body,m.created_at,CASE WHEN u.role='OWNER' THEN 'OWNER' ELSE 'CUSTOMER' END AS author FROM support_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.created_at LIMIT 100",
            [t.id],
          )
        ).rows,
      })),
    ),
  };
}
export async function reply(actor, id, input, { owner = false } = {}) {
  object(input, ['message', 'status']);
  if (
    input.status !== undefined &&
    (!owner || !['OPEN', 'WAITING_CUSTOMER', 'RESOLVED'].includes(input.status))
  )
    fail('Invalid ticket status');
  return transaction(async (db) => {
    const t = await db.query(
      `SELECT id,user_id,guest_id FROM support_tickets WHERE id=$1 ${owner ? '' : `AND ${actorColumn(actor)}=$2`} FOR UPDATE`,
      owner ? [uuid(id)] : [uuid(id), actor.id],
    );
    if (!t.rows.length) fail('Ticket not found', 404);
    const message = await db.query(
      'INSERT INTO support_messages(ticket_id,author_id,body) VALUES($1,$2,$3) RETURNING id',
      [id, actor.kind === 'user' ? actor.id : null, text(input.message, 'message', 1, 3000)],
    );
    if (owner) {
      const target = t.rows[0];
      await notify(
        db,
        target.user_id
          ? { kind: 'user', id: target.user_id }
          : { kind: 'guest', id: target.guest_id },
        'SUPPORT',
        'A support reply is available',
        'support-reply:' + message.rows[0].id,
      );
    }
    await db.query('UPDATE support_tickets SET status=$1 WHERE id=$2', [
      input.status || 'OPEN',
      id,
    ]);
    await audit(db, actor, 'SUPPORT_REPLIED', 'TICKET', id);
    return { ok: true };
  });
}
export async function preferences(actor, input) {
  if (actor.kind !== 'user') fail('Sign in required', 401);
  if (input === undefined) {
    const p = (
      await database().query(
        'SELECT marketing,personalization,analytics FROM notification_preferences WHERE user_id=$1',
        [actor.id],
      )
    ).rows[0];
    return p || { marketing: false, personalization: false, analytics: false };
  }
  object(input, ['marketing', 'personalization', 'analytics']);
  for (const k of ['marketing', 'personalization', 'analytics'])
    if (typeof input[k] !== 'boolean') fail('Invalid consent preference');
  return transaction(async (db) => {
    await db.query(
      'INSERT INTO notification_preferences(user_id,marketing,personalization,analytics) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET marketing=EXCLUDED.marketing,personalization=EXCLUDED.personalization,analytics=EXCLUDED.analytics,updated_at=now()',
      [actor.id, input.marketing, input.personalization, input.analytics],
    );
    if (!input.personalization)
      await db.query('DELETE FROM recent_products WHERE user_id=$1', [actor.id]);
    await audit(db, actor, 'CONSENT_UPDATED', 'USER', actor.id, input);
    return { ok: true };
  });
}
export async function recent(actor, productId) {
  if (actor.kind !== 'user') return { items: [] };
  const p = await preferences(actor);
  if (!p.personalization) return { items: [], consentRequired: true };
  if (productId) {
    await database().query(
      'INSERT INTO recent_products(user_id,product_id) SELECT $1,id FROM products WHERE id=$2 AND active ON CONFLICT(user_id,product_id) DO UPDATE SET viewed_at=now()',
      [actor.id, uuid(productId)],
    );
    await database().query(
      'DELETE FROM recent_products WHERE user_id=$1 AND product_id NOT IN(SELECT product_id FROM recent_products WHERE user_id=$1 ORDER BY viewed_at DESC LIMIT 20)',
      [actor.id],
    );
  }
  return {
    items: (
      await database().query(
        'SELECT p.id,p.title AS name,r.viewed_at FROM recent_products r JOIN products p ON p.id=r.product_id WHERE r.user_id=$1 AND p.active ORDER BY r.viewed_at DESC LIMIT 20',
        [actor.id],
      )
    ).rows,
  };
}
export async function recordAnalytics(actor, input) {
  object(input, ['event']);
  if (!['STOREFRONT_VIEW', 'PRODUCT_VIEW'].includes(input.event)) fail('Invalid analytics event');
  if (actor.kind !== 'user' || !(await preferences(actor)).analytics) return { recorded: false };
  await database().query(
    'INSERT INTO daily_events(day,event,count) VALUES(current_date,$1,1) ON CONFLICT(day,event) DO UPDATE SET count=daily_events.count+1',
    [input.event],
  );
  return { recorded: true };
}
export async function exportData(actor) {
  if (actor.kind !== 'user') fail('Sign in required', 401);
  const user = (
    await database().query(
      'SELECT id,email,name,email_verified_at,created_at FROM users WHERE id=$1 AND deleted_at IS NULL',
      [actor.id],
    )
  ).rows[0];
  const db = database();
  const records = async (sql) => (await db.query(sql, [actor.id])).rows;
  const orderList = await records('SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at,id');
  const orders = [];
  for (const order of orderList) orders.push(await getOrder(actor, order.id));
  return {
    generatedAt: new Date().toISOString(),
    user,
    addresses: (await addresses(actor)).items,
    orders,
    support: await records(
      'SELECT id,order_id,subject,status,created_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at,id',
    ),
    supportMessages: await records(
      'SELECT m.id,m.ticket_id,m.author_id,m.body,m.created_at FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.user_id=$1 ORDER BY m.created_at,m.id',
    ),
    cart: await records(
      'SELECT i.variant_id,i.quantity FROM cart_items i JOIN carts c ON c.id=i.cart_id WHERE c.user_id=$1 ORDER BY i.variant_id',
    ),
    wishlist: await records(
      'SELECT product_id FROM wishlists WHERE user_id=$1 ORDER BY product_id',
    ),
    recent: await records(
      'SELECT product_id,viewed_at FROM recent_products WHERE user_id=$1 ORDER BY viewed_at',
    ),
    reviews: await records(
      'SELECT id,product_id,rating,body,moderation_status,created_at FROM reviews WHERE user_id=$1 ORDER BY created_at,id',
    ),
    questions: await records(
      'SELECT id,product_id,question,answer,approved,created_at FROM product_questions WHERE user_id=$1 ORDER BY created_at,id',
    ),
    notifications: await records(
      'SELECT id,kind,title,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at,id',
    ),
    creditLedger: await records(
      'SELECT amount_paise,reason,event_key,created_at FROM credit_ledger WHERE user_id=$1 ORDER BY created_at,id',
    ),
    loyaltyLedger: await records(
      'SELECT points,event_key,created_at FROM loyalty_ledger WHERE user_id=$1 ORDER BY created_at,id',
    ),
    audit: await records(
      'SELECT action,entity_type,entity_id,details,created_at FROM audit_events WHERE actor_id=$1 ORDER BY created_at,id',
    ),
    mailStatus: await records(
      'SELECT event_key,status,attempts,created_at,sent_at FROM mail_outbox WHERE user_id=$1 ORDER BY created_at,id',
    ),
    preferences: await preferences(actor),
    creditBalancePaise: await creditBalance(db, actor),
    scope:
      'Application personal records, excluding authentication secrets. Provider/hosting backups and statutory retention require the owner policy. Export spans multiple reads, not a point-in-time financial snapshot.',
  };
}
export async function deleteAccount(actor, input) {
  if (actor.kind !== 'user') fail('Sign in required', 401);
  object(input, ['password', 'confirmation']);
  if (input.confirmation !== 'DELETE') fail('Explicit DELETE confirmation required');
  return transaction(async (db) => {
    const user = (
      await db.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [
        actor.id,
      ])
    ).rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash)))
      fail('Invalid credentials', 401);
    if (user.role !== 'CUSTOMER')
      fail('Privileged account removal requires a separate controlled handoff', 409);
    const active = await db.query(
      "SELECT id FROM orders WHERE user_id=$1 AND status NOT IN('DELIVERED','CANCELLED','RETURNED') LIMIT 1",
      [actor.id],
    );
    if (active.rows.length || (await creditBalance(db, actor)) > 0)
      fail('Resolve active orders or remaining store credit before deletion', 409);
    const refund = await db.query(
      "SELECT r.id FROM refunds r JOIN orders o ON o.id=r.order_id WHERE o.user_id=$1 AND r.status NOT IN('PROCESSED','FAILED') LIMIT 1",
      [actor.id],
    );
    if (refund.rows.length) fail('Resolve pending refunds before deletion', 409);
    for (const table of [
      'addresses',
      'wishlists',
      'recent_products',
      'notification_preferences',
      'identity_tokens',
      'mfa_enrollments',
    ])
      await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [actor.id]);
    await db.query('DELETE FROM carts WHERE user_id=$1', [actor.id]);
    await db.query(
      "UPDATE mail_outbox SET status='SUPPRESSED',encrypted_payload='{}'::jsonb WHERE user_id=$1",
      [actor.id],
    );
    await db.query('DELETE FROM notifications WHERE user_id=$1', [actor.id]);
    await db.query('DELETE FROM reviews WHERE user_id=$1', [actor.id]);
    await db.query('DELETE FROM product_questions WHERE user_id=$1', [actor.id]);
    await db.query(
      "UPDATE support_messages SET body='[erased]' WHERE author_id=$1 OR ticket_id IN(SELECT id FROM support_tickets WHERE user_id=$1)",
      [actor.id],
    );
    await db.query("UPDATE support_tickets SET subject='[erased]' WHERE user_id=$1", [actor.id]);
    await db.query(
      'UPDATE orders SET shipping_address=\'{"erased":true}\'::jsonb WHERE user_id=$1',
      [actor.id],
    );
    await db.query(
      "UPDATE users SET email='deleted-'||id::text||'@invalid.local',name='[erased]',password_hash='[revoked]',mfa_secret_encrypted=NULL,deleted_at=now() WHERE id=$1",
      [actor.id],
    );
    await db.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1', [actor.id]);
    await audit(db, actor, 'ACCOUNT_ERASED', 'USER', actor.id, {
      scope: 'Direct application personal fields; transaction amounts retained pseudonymously',
    });
    return {
      ok: true,
      scope:
        'Direct application personal data erased; pseudonymous transaction/audit records retained. External provider/backup retention is a separate owner responsibility.',
    };
  });
}
export async function abandonedCartBatch() {
  return transaction(async (db) => {
    const rows = (
      await db.query(
        "SELECT c.id,c.user_id,u.email FROM carts c JOIN users u ON u.id=c.user_id JOIN notification_preferences p ON p.user_id=u.id WHERE u.deleted_at IS NULL AND p.marketing AND c.updated_at<now()-interval '24 hours' AND (c.recovery_notified_at IS NULL OR c.recovery_notified_at<now()-interval '7 days') AND EXISTS(SELECT 1 FROM cart_items i WHERE i.cart_id=c.id) ORDER BY c.id LIMIT 20 FOR UPDATE OF c SKIP LOCKED",
      )
    ).rows;
    for (const row of rows) {
      await db.query(
        'INSERT INTO mail_outbox(user_id,encrypted_payload,event_key) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',
        [
          row.user_id,
          seal(
            {
              to: row.email,
              subject: 'Your NovaCart bag',
              text: 'Your saved bag is available when you return. Prices and availability are checked again at checkout.',
              marketing: true,
            },
            'mail',
          ),
          'cart-recovery:' + row.id + ':' + new Date().toISOString().slice(0, 10),
        ],
      );
      await db.query('UPDATE carts SET recovery_notified_at=now() WHERE id=$1', [row.id]);
    }
    return { queued: rows.length };
  });
}
