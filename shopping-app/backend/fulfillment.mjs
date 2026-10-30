import { transaction } from './db.mjs';
import { ownedOrder, releaseInventory, refundIntent, restoreCredit } from './commerce.mjs';
import {
  object,
  text,
  integer,
  uuid,
  key,
  digest,
  canonical,
  money,
  fail,
  audit,
  notify,
  orderActor,
} from './validation.mjs';

export async function transitionOrder(actor, id, input) {
  object(input, ['status', 'provider', 'trackingNumber', 'codCollected']);
  return transaction(async (db) => {
    const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [uuid(id)]))
      .rows[0];
    if (!order) fail('Order not found', 404);
    if (order.status === input.status) return { ok: true, duplicate: true };
    const next = { CONFIRMED: 'PACKING', PACKING: 'SHIPPED', SHIPPED: 'DELIVERED' }[order.status];
    if (input.status !== next || !next) fail('Invalid order state transition', 409);
    if (next === 'SHIPPED') {
      const provider = text(input.provider, 'carrier', 2, 80),
        tracking = text(input.trackingNumber, 'tracking reference', 3, 100);
      await releaseInventory(db, order, { consume: true });
      await db.query(
        "INSERT INTO shipments(order_id,provider,tracking_number,status,shipped_at) VALUES($1,$2,$3,'SHIPPED',now()) ON CONFLICT(order_id) DO UPDATE SET provider=EXCLUDED.provider,tracking_number=EXCLUDED.tracking_number,status='SHIPPED',shipped_at=now()",
        [order.id, provider, tracking],
      );
    }
    if (next === 'DELIVERED') {
      if (order.payment_method === 'COD' && money(order.payable_paise) > 0) {
        if (input.codCollected !== true)
          fail('Explicit cash collection confirmation is required', 409);
        await db.query(
          "INSERT INTO payment_attempts(order_id,provider,provider_payment_id,idempotency_key,amount_paise,status,request_state) VALUES($1,'COD',$2,$3,$4,'PAID','COMPLETE') ON CONFLICT(idempotency_key) DO NOTHING",
          [order.id, 'cash:' + order.id, 'cod:' + order.id, money(order.payable_paise)],
        );
        await db.query("UPDATE orders SET payment_status='PAID' WHERE id=$1", [order.id]);
        await audit(db, actor, 'CASH_COLLECTION_RECORDED', 'ORDER', order.id, {
          source: 'owner assertion; not gateway settlement',
        });
      }
      await db.query(
        "UPDATE shipments SET status='DELIVERED',delivered_at=now() WHERE order_id=$1",
        [order.id],
      );
      if (order.user_id)
        await db.query(
          'INSERT INTO loyalty_ledger(user_id,points,event_key) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',
          [
            order.user_id,
            Math.floor((money(order.subtotal_paise) - money(order.discount_paise)) / 10000),
            'earned:' + order.id,
          ],
        );
    }
    await db.query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2', [next, order.id]);
    await audit(db, actor, 'ORDER_' + next, 'ORDER', order.id);
    await notify(
      db,
      orderActor(order),
      'ORDER',
      'Order ' + order.order_number + ' is ' + next.toLowerCase(),
      'transition:' + order.id + ':' + next,
    );
    return { ok: true, status: next };
  });
}
export async function requestReturn(actor, id, input, idempotencyKey) {
  object(input, ['orderItemId', 'quantity', 'reason']);
  const itemId = uuid(input.orderItemId),
    quantity = integer(input.quantity, 'return quantity', 1, 99),
    reason = text(input.reason, 'reason', 5, 1000),
    requestKey = key(idempotencyKey),
    hash = digest(canonical({ itemId, quantity, reason }));
  return transaction(async (db) => {
    const order = await ownedOrder(db, actor, id, { lock: true });
    const old = (
      await db.query(
        'SELECT r.*,i.order_id FROM returns r JOIN order_items i ON i.id=r.order_item_id WHERE r.idempotency_key=$1',
        [requestKey],
      )
    ).rows[0];
    if (old) {
      if (old.order_id !== order.id || old.order_item_id !== itemId || old.request_hash !== hash)
        fail('Conflicting return request', 409);
      return { id: old.id, duplicate: true };
    }
    if (!['DELIVERED', 'RETURN_REQUESTED'].includes(order.status))
      fail('Only delivered items can be returned', 409);
    const shipment = (
      await db.query('SELECT delivered_at FROM shipments WHERE order_id=$1', [order.id])
    ).rows[0];
    const days = Number(
      process.env.RETURN_WINDOW_DAYS || (process.env.NODE_ENV === 'production' ? 0 : 14),
    );
    if (
      !shipment?.delivered_at ||
      days <= 0 ||
      Date.now() - new Date(shipment.delivered_at) > days * 86400000
    )
      fail('Return window is unavailable or expired', 409);
    const item = (
      await db.query('SELECT * FROM order_items WHERE id=$1 AND order_id=$2 FOR UPDATE', [
        itemId,
        order.id,
      ])
    ).rows[0];
    if (!item) fail('Order item not found', 404);
    const previous = Number(
      (
        await db.query(
          "SELECT COALESCE(sum(quantity),0) AS total FROM returns WHERE order_item_id=$1 AND status IN('REQUESTED','RECEIVED')",
          [item.id],
        )
      ).rows[0].total,
    );
    if (previous + quantity > item.quantity)
      fail('Return quantity exceeds the purchased quantity', 409);
    const share = (amount) =>
      Number(
        (BigInt(amount) * BigInt(previous + quantity)) / BigInt(item.quantity) -
          (BigInt(amount) * BigInt(previous)) / BigInt(item.quantity),
      );
    const credit = share(money(item.credit_paise)),
      amount = share(
        money(item.line_total_paise) - money(item.discount_paise) - money(item.credit_paise),
      );
    const r = await db.query(
      'INSERT INTO returns(order_item_id,quantity,reason,idempotency_key,request_hash,refund_paise,credit_paise) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [item.id, quantity, reason, requestKey, hash, amount, credit],
    );
    await db.query("UPDATE orders SET status='RETURN_REQUESTED',updated_at=now() WHERE id=$1", [
      order.id,
    ]);
    await audit(db, actor, 'RETURN_REQUESTED', 'ORDER', order.id, { returnId: r.rows[0].id });
    return { id: r.rows[0].id, duplicate: false };
  });
}
export async function decideReturn(actor, id, input) {
  object(input, ['decision', 'restock']);
  if (!['RECEIVED', 'REJECTED'].includes(input.decision)) fail('Invalid return decision');
  if (input.restock !== undefined && typeof input.restock !== 'boolean')
    fail('Invalid restock choice');
  return transaction(async (db) => {
    const reference = (
      await db.query(
        'SELECT i.order_id FROM returns r JOIN order_items i ON i.id=r.order_item_id WHERE r.id=$1',
        [uuid(id)],
      )
    ).rows[0];
    if (!reference) fail('Return not found', 404);
    const order = (
      await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [reference.order_id])
    ).rows[0];
    const item = (
      await db.query(
        'SELECT r.*,i.variant_id,i.quantity AS ordered_quantity,i.line_total_paise,i.discount_paise,i.credit_paise AS line_credit_paise FROM returns r JOIN order_items i ON i.id=r.order_item_id WHERE r.id=$1 FOR UPDATE OF r,i',
        [id],
      )
    ).rows[0];
    if (item.status !== 'REQUESTED') {
      if (item.status === input.decision) return { ok: true, duplicate: true };
      fail('Return already decided', 409);
    }
    if (input.decision === 'RECEIVED') {
      const received = Number(
        (
          await db.query(
            "SELECT COALESCE(sum(quantity),0) AS total FROM returns WHERE order_item_id=$1 AND status='RECEIVED'",
            [item.order_item_id],
          )
        ).rows[0].total,
      );
      const share = (amount) =>
        Number(
          (BigInt(amount) * BigInt(received + item.quantity)) / BigInt(item.ordered_quantity) -
            (BigInt(amount) * BigInt(received)) / BigInt(item.ordered_quantity),
        );
      item.credit_paise = share(money(item.line_credit_paise));
      item.refund_paise = share(
        money(item.line_total_paise) - money(item.discount_paise) - money(item.line_credit_paise),
      );
      await db.query('UPDATE returns SET refund_paise=$1,credit_paise=$2 WHERE id=$3', [
        item.refund_paise,
        item.credit_paise,
        item.id,
      ]);
      if (input.restock && item.variant_id)
        await db.query('UPDATE variants SET stock_on_hand=stock_on_hand+$1 WHERE id=$2', [
          item.quantity,
          item.variant_id,
        ]);
      await restoreCredit(db, order, 'return-credit:' + item.id, money(item.credit_paise));
      await refundIntent(db, order, money(item.refund_paise), 'return-refund:' + item.id, item.id);
      if (order.user_id) {
        const previousReturned = money(
          (
            await db.query(
              "SELECT COALESCE(sum(r.refund_paise+r.credit_paise),0) AS amount FROM returns r JOIN order_items i ON i.id=r.order_item_id WHERE i.order_id=$1 AND r.status='RECEIVED'",
              [order.id],
            )
          ).rows[0].amount,
        );
        const points =
          Math.floor(
            (previousReturned + money(item.refund_paise) + money(item.credit_paise)) / 10000,
          ) - Math.floor(previousReturned / 10000);
        await db.query(
          'INSERT INTO loyalty_ledger(user_id,points,event_key) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',
          [order.user_id, -points, 'returned:' + item.id],
        );
      }
    }
    await db.query('UPDATE returns SET status=$1 WHERE id=$2', [input.decision, item.id]);
    const quantities = (
      await db.query(
        "SELECT COALESCE(sum(r.quantity) FILTER(WHERE r.status='RECEIVED'),0) AS received,COALESCE(sum(r.quantity) FILTER(WHERE r.status='REQUESTED'),0) AS pending FROM returns r JOIN order_items i ON i.id=r.order_item_id WHERE i.order_id=$1",
        [order.id],
      )
    ).rows[0];
    const ordered = Number(
      (
        await db.query('SELECT sum(quantity) AS total FROM order_items WHERE order_id=$1', [
          order.id,
        ])
      ).rows[0].total,
    );
    const status =
      Number(quantities.received) >= ordered
        ? 'RETURNED'
        : Number(quantities.pending) > 0
          ? 'RETURN_REQUESTED'
          : 'DELIVERED';
    await db.query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2', [status, order.id]);
    await audit(db, actor, 'RETURN_' + input.decision, 'ORDER', order.id, {
      returnId: item.id,
      restocked: input.restock === true,
    });
    await notify(
      db,
      orderActor(order),
      'RETURN',
      'Return ' +
        input.decision.toLowerCase() +
        '. Any external refund requires provider confirmation.',
      'return-decision:' + item.id,
    );
    return { ok: true, status };
  });
}
export async function manualRefund(actor, id, input) {
  object(input, ['reference']);
  const reference = text(input.reference, 'cash payout reference', 5, 100);
  return transaction(async (db) => {
    const r = (
      await db.query(
        'SELECT r.*,p.provider FROM refunds r JOIN payment_attempts p ON p.id=r.payment_attempt_id WHERE r.id=$1 FOR UPDATE OF r,p',
        [uuid(id)],
      )
    ).rows[0];
    if (!r) fail('Refund not found', 404);
    if (r.provider !== 'COD') fail('Only recorded cash payouts use this operation', 409);
    if (r.status === 'PROCESSED') {
      if (r.manual_reference !== reference) fail('Refund already recorded', 409);
      return { ok: true, duplicate: true };
    }
    await db.query(
      "UPDATE refunds SET status='PROCESSED',request_state='COMPLETE',manual_reference=$1 WHERE id=$2",
      [reference, r.id],
    );
    const amount = Number(
        (
          await db.query(
            "SELECT sum(amount_paise) AS total FROM refunds WHERE payment_attempt_id=$1 AND status='PROCESSED'",
            [r.payment_attempt_id],
          )
        ).rows[0].total,
      ),
      paid = Number(
        (
          await db.query('SELECT amount_paise FROM payment_attempts WHERE id=$1', [
            r.payment_attempt_id,
          ])
        ).rows[0].amount_paise,
      );
    const state = amount >= paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await db.query('UPDATE payment_attempts SET status=$1 WHERE id=$2', [
      state,
      r.payment_attempt_id,
    ]);
    await db.query('UPDATE orders SET payment_status=$1 WHERE id=$2', [state, r.order_id]);
    await audit(db, actor, 'CASH_REFUND_RECORDED', 'ORDER', r.order_id, {
      source: 'owner-confirmed offline payout',
      refundId: r.id,
    });
    return { ok: true };
  });
}
