import { createHmac, timingSafeEqual } from 'node:crypto';
import { database, transaction } from './db.mjs';
import { ownedOrder, refundIntent } from './commerce.mjs';
import { fail, text, money, digest, audit, notify, orderActor } from './validation.mjs';

export function verifySignature(raw, signature, secret) {
  if (!secret) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function razorpay({
  keyId = process.env.RAZORPAY_KEY_ID,
  keySecret = process.env.RAZORPAY_KEY_SECRET,
  fetchImpl = fetch,
} = {}) {
  if (!keyId || !keySecret) fail('Online payments are not configured', 503);
  if (
    !keyId.startsWith('rzp_test_') &&
    !(process.env.NODE_ENV === 'production' && process.env.ALLOW_LIVE_PAYMENTS === 'true')
  )
    fail('Live payments require separate activation', 503);
  async function call(path, method = 'GET', body) {
    let response;
    try {
      response = await fetchImpl('https://api.razorpay.com/v1/' + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      fail('Provider outcome is uncertain; reconcile before retrying', 503);
    }
    if (!response.ok) fail('Payment provider rejected the request; reconciliation required', 503);
    const bytes = await response.text();
    if (bytes.length > 65536) fail('Invalid provider response', 503);
    try {
      return JSON.parse(bytes);
    } catch {
      fail('Invalid provider response', 503);
    }
  }
  return {
    keyId,
    createOrder: async ({ amount, receipt }) => {
      const r = await call('orders', 'POST', {
        amount: money(amount),
        currency: 'INR',
        receipt,
        notes: { source: 'NovaCart' },
      });
      if (
        typeof r.id !== 'string' ||
        !/^order_[A-Za-z0-9]+$/.test(r.id) ||
        r.amount !== amount ||
        r.currency !== 'INR' ||
        r.receipt !== receipt
      )
        fail('Invalid provider order response', 503);
      return r;
    },
    getOrder: (id) => call('orders/' + providerId(id, 'order')),
    refund: async ({ paymentId, amount, receipt }) => {
      const r = await call('payments/' + providerId(paymentId, 'pay') + '/refund', 'POST', {
        amount: money(amount),
        receipt,
      });
      if (
        typeof r.id !== 'string' ||
        !/^rfnd_[A-Za-z0-9]+$/.test(r.id) ||
        r.amount !== amount ||
        r.payment_id !== paymentId
      )
        fail('Invalid provider refund response', 503);
      return r;
    },
  };
}
function providerId(value, prefix) {
  if (typeof value !== 'string' || !new RegExp('^' + prefix + '_[A-Za-z0-9]+$').test(value))
    fail('Invalid provider identifier');
  return value;
}
export async function paymentSession(actor, id, { providerFactory = razorpay } = {}) {
  const provider = providerFactory();
  const intent = await transaction(async (db) => {
    const order = await ownedOrder(db, actor, id, { lock: true });
    if (
      order.status !== 'PENDING_PAYMENT' ||
      order.payment_method !== 'RAZORPAY' ||
      new Date(order.reservation_expires_at) <= new Date()
    )
      fail('Order is not payable', 409);
    const old = (
      await db.query(
        "SELECT * FROM payment_attempts WHERE order_id=$1 AND provider='RAZORPAY' FOR UPDATE",
        [order.id],
      )
    ).rows[0];
    if (old) {
      if (old.provider_order_id) return { order, attempt: old, existing: true };
      fail('Payment creation outcome requires reconciliation', 409);
    }
    const r = await db.query(
      "INSERT INTO payment_attempts(order_id,provider,idempotency_key,amount_paise,status,request_state) VALUES($1,'RAZORPAY',$2,$3,'PENDING','CREATING') RETURNING *",
      [order.id, 'session:' + order.id, money(order.payable_paise)],
    );
    return { order, attempt: r.rows[0], existing: false };
  });
  if (!intent.existing) {
    try {
      const remote = await provider.createOrder({
        amount: money(intent.attempt.amount_paise),
        receipt: intent.attempt.id,
      });
      await database().query(
        "UPDATE payment_attempts SET provider_order_id=$1,request_state='COMPLETE' WHERE id=$2",
        [remote.id, intent.attempt.id],
      );
      intent.attempt.provider_order_id = remote.id;
    } catch (e) {
      await database().query("UPDATE payment_attempts SET request_state='UNKNOWN' WHERE id=$1", [
        intent.attempt.id,
      ]);
      throw e;
    }
  }
  return {
    provider: 'RAZORPAY',
    keyId: provider.keyId,
    providerOrderId: intent.attempt.provider_order_id,
    amountPaise: money(intent.attempt.amount_paise),
    currency: 'INR',
    status: 'PENDING',
    notice: 'Client callbacks do not confirm payment. Await verified webhook.',
  };
}
export async function processWebhook(
  raw,
  signature,
  eventId,
  { secret = process.env.RAZORPAY_WEBHOOK_SECRET } = {},
) {
  if (!secret) fail('Payment webhooks are not configured', 503);
  if (!verifySignature(raw, signature, secret)) fail('Invalid webhook signature', 401);
  text(eventId, 'event identifier', 1, 128);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('Invalid webhook JSON');
  }
  const type = payload.event;
  if (
    ![
      'payment.authorized',
      'payment.captured',
      'payment.failed',
      'refund.processed',
      'refund.failed',
    ].includes(type)
  )
    return { accepted: true, ignored: true };
  const entity = type.startsWith('payment.')
    ? payload.payload?.payment?.entity
    : payload.payload?.refund?.entity;
  if (!entity) fail('Invalid provider event');
  const hash = digest(raw);
  return transaction(async (db) => {
    // Serializes duplicate event IDs even across application instances.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('razorpay:'||$1,0))", [eventId]);
    const seen = await db.query(
      "SELECT payload_sha256 FROM payment_webhook_events WHERE provider='RAZORPAY' AND event_id=$1",
      [eventId],
    );
    if (seen.rows.length) {
      if (seen.rows[0].payload_sha256 !== hash) fail('Conflicting webhook event identifier', 409);
      return { accepted: true, duplicate: true };
    }
    if (type.startsWith('payment.')) {
      const id = providerId(entity.order_id, 'order'),
        paymentId = providerId(entity.id, 'pay');
      // Lock order then payment, consistently with checkout, cancellation and refund creation.
      const reference = await db.query(
        "SELECT order_id FROM payment_attempts WHERE provider='RAZORPAY' AND provider_order_id=$1",
        [id],
      );
      if (!reference.rows.length) fail('Unknown provider order', 409);
      const order = (
        await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [reference.rows[0].order_id])
      ).rows[0];
      const attempt = (
        await db.query(
          "SELECT * FROM payment_attempts WHERE provider='RAZORPAY' AND provider_order_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        entity.currency !== 'INR' ||
        !Number.isSafeInteger(entity.amount) ||
        entity.amount !== money(attempt.amount_paise) ||
        entity.amount !== money(order.payable_paise)
      )
        fail('Payment amount or currency does not match', 409);
      const expected = {
        'payment.authorized': 'authorized',
        'payment.captured': 'captured',
        'payment.failed': 'failed',
      }[type];
      if (entity.status !== expected || (type === 'payment.captured' && entity.captured !== true))
        fail('Invalid payment state', 409);
      if (type === 'payment.captured') {
        if (
          ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(attempt.status) &&
          attempt.provider_payment_id !== paymentId
        )
          fail('Another payment is already recorded', 409);
        if (!['REFUNDED', 'PARTIALLY_REFUNDED'].includes(attempt.status)) {
          await db.query(
            "UPDATE payment_attempts SET status='PAID',provider_payment_id=$1 WHERE id=$2",
            [paymentId, attempt.id],
          );
          await db.query(
            "UPDATE orders SET payment_status='PAID',status=CASE WHEN status='PENDING_PAYMENT' AND reservation_expires_at>now() THEN 'CONFIRMED'::order_status ELSE status END,updated_at=now() WHERE id=$1",
            [order.id],
          );
          if (
            order.status === 'CANCELLED' ||
            (order.status === 'PENDING_PAYMENT' &&
              new Date(order.reservation_expires_at) <= new Date())
          ) {
            const { releaseInventory, restoreCredit, releaseCoupon } =
              await import('./commerce.mjs');
            await releaseInventory(db, order);
            await restoreCredit(db, order, 'expired-credit:' + order.id);
            await releaseCoupon(db, order);
            await db.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [order.id]);
            await refundIntent(
              db,
              { ...order, payment_status: 'PAID' },
              entity.amount,
              'late-payment:' + order.id,
            );
          }
        }
      } else if (!['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(attempt.status)) {
        const status = type === 'payment.authorized' ? 'AUTHORIZED' : 'FAILED';
        await db.query('UPDATE payment_attempts SET status=$1,provider_payment_id=$2 WHERE id=$3', [
          status,
          paymentId,
          attempt.id,
        ]);
        await db.query('UPDATE orders SET payment_status=$1 WHERE id=$2', [status, order.id]);
      }
      await audit(db, null, 'PAYMENT_' + type.split('.')[1].toUpperCase(), 'ORDER', order.id, {
        provider: 'RAZORPAY',
        eventId,
      });
      await notify(
        db,
        orderActor(order),
        'PAYMENT',
        'Payment state updated for ' + order.order_number,
        'payment-event:' + eventId,
      );
    } else {
      const refundId = providerId(entity.id, 'rfnd');
      const reference = await db.query('SELECT order_id FROM refunds WHERE provider_refund_id=$1', [
        refundId,
      ]);
      if (!reference.rows.length) fail('Unknown refund', 409);
      const order = (
        await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [reference.rows[0].order_id])
      ).rows[0];
      const refund = (
        await db.query(
          'SELECT r.*,p.provider_payment_id FROM refunds r JOIN payment_attempts p ON p.id=r.payment_attempt_id WHERE r.provider_refund_id=$1 FOR UPDATE OF r,p',
          [refundId],
        )
      ).rows[0];
      if (
        entity.payment_id !== refund.provider_payment_id ||
        entity.amount !== money(refund.amount_paise) ||
        entity.currency !== 'INR' ||
        entity.status !== (type === 'refund.processed' ? 'processed' : 'failed')
      )
        fail('Refund details do not match', 409);
      if (refund.status !== 'PROCESSED')
        await db.query("UPDATE refunds SET status=$1,request_state='COMPLETE' WHERE id=$2", [
          type === 'refund.processed' ? 'PROCESSED' : 'FAILED',
          refund.id,
        ]);
      const p = (
        await db.query('SELECT amount_paise FROM payment_attempts WHERE id=$1', [
          refund.payment_attempt_id,
        ])
      ).rows[0];
      const refunded = money(
        (
          await db.query(
            "SELECT COALESCE(sum(amount_paise),0) AS total FROM refunds WHERE payment_attempt_id=$1 AND status='PROCESSED'",
            [refund.payment_attempt_id],
          )
        ).rows[0].total,
      );
      if (refunded) {
        const status = refunded >= money(p.amount_paise) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await db.query('UPDATE payment_attempts SET status=$1 WHERE id=$2', [
          status,
          refund.payment_attempt_id,
        ]);
        await db.query('UPDATE orders SET payment_status=$1 WHERE id=$2', [status, order.id]);
      }
      await audit(db, null, 'REFUND_' + type.split('.')[1].toUpperCase(), 'ORDER', order.id, {
        eventId,
      });
      await notify(
        db,
        orderActor(order),
        'REFUND',
        'Refund state updated for ' + order.order_number,
        'refund-event:' + eventId,
      );
    }
    await db.query(
      "INSERT INTO payment_webhook_events(provider,event_id,payload_sha256,processed_at) VALUES('RAZORPAY',$1,$2,now())",
      [eventId, hash],
    );
    return { accepted: true, duplicate: false };
  });
}
export async function submitRefund(actor, refundId, { providerFactory = razorpay } = {}) {
  let provider;
  const intent = await transaction(async (db) => {
    const r = await db.query(
      'SELECT r.*,p.provider,p.provider_payment_id FROM refunds r JOIN payment_attempts p ON p.id=r.payment_attempt_id WHERE r.id=$1 FOR UPDATE OF r,p',
      [refundId],
    );
    if (!r.rows.length) fail('Refund not found', 404);
    const refund = r.rows[0];
    if (refund.provider !== 'RAZORPAY')
      fail('Manual cash or credit refund requires an explicit offline payout record', 409);
    if (refund.provider_refund_id) return { refund, duplicate: true };
    if (refund.request_state !== 'NEW') fail('Refund outcome requires reconciliation', 409);
    provider = providerFactory();
    await db.query("UPDATE refunds SET request_state='CREATING' WHERE id=$1", [refund.id]);
    await audit(db, actor, 'REFUND_SUBMITTED', 'REFUND', refund.id);
    return { refund, duplicate: false };
  });
  if (intent.duplicate)
    return {
      id: intent.refund.id,
      providerRefundId: intent.refund.provider_refund_id,
      status: intent.refund.status,
    };
  try {
    const remote = await provider.refund({
      paymentId: intent.refund.provider_payment_id,
      amount: money(intent.refund.amount_paise),
      receipt: intent.refund.id,
    });
    await database().query(
      "UPDATE refunds SET provider_refund_id=$1,request_state='COMPLETE' WHERE id=$2",
      [remote.id, intent.refund.id],
    );
    return { id: intent.refund.id, status: 'PENDING', providerRefundId: remote.id };
  } catch (error) {
    await database().query("UPDATE refunds SET request_state='UNKNOWN' WHERE id=$1", [
      intent.refund.id,
    ]);
    throw error;
  }
}
export async function reconcilePayment(
  actor,
  attemptId,
  providerOrderId,
  { providerFactory = razorpay } = {},
) {
  const provider = providerFactory(),
    remote = await provider.getOrder(providerOrderId);
  return transaction(async (db) => {
    const r = await db.query('SELECT * FROM payment_attempts WHERE id=$1 FOR UPDATE', [attemptId]);
    if (!r.rows.length) fail('Payment attempt not found', 404);
    const attempt = r.rows[0];
    if (
      attempt.provider !== 'RAZORPAY' ||
      remote.id !== providerOrderId ||
      remote.receipt !== attempt.id ||
      remote.amount !== money(attempt.amount_paise) ||
      remote.currency !== 'INR'
    )
      fail('Provider order does not match local intent', 409);
    if (attempt.provider_order_id && attempt.provider_order_id !== providerOrderId)
      fail('Intent already bound to a provider order', 409);
    await db.query(
      "UPDATE payment_attempts SET provider_order_id=$1,request_state='COMPLETE' WHERE id=$2",
      [providerOrderId, attempt.id],
    );
    await audit(db, actor, 'PAYMENT_RECONCILED', 'PAYMENT', attempt.id);
    return {
      ok: true,
      notice: 'Provider order bound; payment state still requires verified events',
    };
  });
}
