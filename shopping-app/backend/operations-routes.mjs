import { ordersEnabled } from './config.mjs';
import { database } from './db.mjs';
import { principal, requireActor } from './shopping.mjs';
import { requireOwner } from './identity.mjs';
import { verifySameOrigin, requireJson, databaseRateLimit, clientAddress } from './security.mjs';
import { readRaw } from './http.mjs';
import { fail, uuid, object, integer, actorColumn, orderActor, key } from './validation.mjs';
import { paymentSession, processWebhook, submitRefund, reconcilePayment } from './payments.mjs';
import { transitionOrder, requestReturn, decideReturn, manualRefund } from './fulfillment.mjs';
import { category, variant, productImages, bulkProducts } from './catalog-admin.mjs';
import { saveCoupon, issueGift, redeemGift, content, report, csv } from './business.mjs';
import { getOrder, creditBalance, expireReservations } from './commerce.mjs';
import {
  engagement,
  moderate,
  support,
  tickets,
  reply,
  preferences,
  recent,
  recordAnalytics,
  exportData,
  deleteAccount,
  abandonedCartBatch,
} from './customer.mjs';
import { clearSessionCookie } from './sessions.mjs';
import { deliverMail } from './mail.mjs';
import { findProduct } from './repository.mjs';

const response = (data, status = 200) => ({ data, status });
export async function operationsRoutes(req, res, url, readJson) {
  const path = url.pathname,
    method = req.method;
  if (path === '/api/config' && method === 'GET')
    return response({
      currency: 'INR',
      ordersEnabled: !!process.env.DATABASE_URL && ordersEnabled(),
      database: !!process.env.DATABASE_URL,
      codEnabled: process.env.COD_ENABLED === 'true',
      onlineEnabled: !!(
        process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') && process.env.RAZORPAY_KEY_SECRET
      ),
      notice: 'Development application. No live payment or courier verification.',
    });
  if (path === '/api/webhooks/razorpay' && method === 'POST') {
    if (!process.env.DATABASE_URL) fail('Database required', 503);
    if (!requireJson(req) || req.headers['content-encoding']) fail('Unencoded JSON required', 415);
    return response(
      await processWebhook(
        await readRaw(req),
        req.headers['x-razorpay-signature'],
        req.headers['x-razorpay-event-id'],
      ),
    );
  }
  const isPublic =
    path === '/api/content' ||
    path === '/api/offers' ||
    path === '/api/compare' ||
    /^\/api\/products\/[^/]+\/(recommendations|reviews|questions)$/.test(path);
  const isCustomer =
    [
      '/api/preferences',
      '/api/recent',
      '/api/analytics/event',
      '/api/credit',
      '/api/gift-cards/redeem',
      '/api/notifications',
      '/api/support',
      '/api/privacy/export',
      '/api/privacy/delete',
    ].includes(path) ||
    /^\/api\/support\/[^/]+$/.test(path) ||
    /^\/api\/orders\/[^/]+\/(payment-session|returns)$/.test(path) ||
    /^\/api\/orders\/lookup\/[^/]+$/.test(path);
  const isAdmin =
    path === '/api/admin/products/bulk' ||
    (path.startsWith('/api/admin/') &&
      !['/api/admin/me', '/api/admin/products'].includes(path) &&
      !/^\/api\/admin\/products\/[^/]+$/.test(path));
  if (!isPublic && !isCustomer && !isAdmin) return null;
  if (!process.env.DATABASE_URL) fail('Database required', 403);
  if (!['GET', 'HEAD'].includes(method)) {
    if (!verifySameOrigin(req)) fail('Cross-origin request denied', 403);
    if (!requireJson(req)) fail('JSON required', 415);
    const rate = await databaseRateLimit('operations:' + clientAddress(req), {
      max: 200,
      windowMs: 60000,
    });
    if (!rate.allowed) fail('Too many requests', 429);
  }
  if (isPublic && method === 'GET') {
    if (path === '/api/content')
      return response({
        items: (
          await database().query(
            "SELECT key,value FROM content_blocks WHERE value->>'enabled'='true' ORDER BY key",
          )
        ).rows,
      });
    if (path === '/api/offers')
      return response({
        items: (
          await database().query(
            'SELECT code,type,value,minimum_paise,ends_at FROM coupons WHERE active AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) AND (usage_limit IS NULL OR usage_count<usage_limit) ORDER BY code LIMIT 50',
          )
        ).rows,
      });
    if (path === '/api/compare') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      if (ids.length < 2 || ids.length > 4) fail('Compare 2–4 products');
      return response({ items: await Promise.all(ids.map((id) => findProduct(uuid(id)))) });
    }
    const match = path.match(/^\/api\/products\/([^/]+)\/(recommendations|reviews|questions)$/),
      product = await findProduct(match[1]);
    if (match[2] === 'reviews') return response({ items: product.reviews });
    if (match[2] === 'questions') return response({ items: product.questions });
    return response({
      items: (
        await database().query(
          'SELECT p.id,p.title AS name,p.slug FROM products p WHERE p.category_id=(SELECT category_id FROM products WHERE id=$1) AND p.id<>$1 AND p.active AND EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active AND v.stock_on_hand>v.stock_reserved) ORDER BY p.created_at DESC LIMIT 4',
          [product.id],
        )
      ).rows,
      method: 'Same-category available items; no AI or invented popularity',
    });
  }
  if (isAdmin) {
    const user = await requireOwner(req),
      actor = { kind: 'user', id: user.id };
    if (path === '/api/admin/categories' && method === 'POST')
      return response(await category(actor, await readJson(req)), 201);
    if (path === '/api/admin/products/bulk' && method === 'POST')
      return response(await bulkProducts(actor, await readJson(req)), 207);
    let m = path.match(/^\/api\/admin\/products\/([^/]+)\/(variants|images)$/);
    if (m && m[2] === 'variants' && method === 'POST')
      return response(await variant(actor, m[1], await readJson(req)), 201);
    if (m && m[2] === 'images' && method === 'PUT')
      return response(await productImages(actor, m[1], await readJson(req)));
    m = path.match(/^\/api\/admin\/variants\/([^/]+)$/);
    if (m && method === 'PATCH')
      return response(await variant(actor, null, await readJson(req), m[1]));
    if (path === '/api/admin/orders' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT id,order_number,status,payment_status,total_paise,created_at FROM orders ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      });
    m = path.match(/^\/api\/admin\/orders\/([^/]+)(?:\/(transition))?$/);
    if (m) {
      if (m[2] && method === 'POST')
        return response(await transitionOrder(actor, m[1], await readJson(req)));
      if (!m[2] && method === 'GET') {
        const order = (await database().query('SELECT * FROM orders WHERE id=$1', [uuid(m[1])]))
          .rows[0];
        if (!order) fail('Order not found', 404);
        return response(await getOrder(orderActor(order), order.id));
      }
    }
    if (path === '/api/admin/returns' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT r.*,i.order_id FROM returns r JOIN order_items i ON i.id=r.order_item_id ORDER BY r.created_at DESC LIMIT 100',
          )
        ).rows,
      });
    m = path.match(/^\/api\/admin\/returns\/([^/]+)$/);
    if (m && method === 'PATCH')
      return response(await decideReturn(actor, m[1], await readJson(req)));
    if (path === '/api/admin/refunds' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT id,order_id,amount_paise,status,request_state,provider_refund_id FROM refunds ORDER BY id DESC LIMIT 100',
          )
        ).rows,
      });
    m = path.match(/^\/api\/admin\/refunds\/([^/]+)\/(submit|manual)$/);
    if (m && method === 'POST') {
      const input = await readJson(req);
      return response(
        m[2] === 'manual'
          ? await manualRefund(actor, m[1], input)
          : await submitRefund(actor, uuid(m[1])),
      );
    }
    if (path === '/api/admin/payments' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT id,order_id,provider,provider_order_id,provider_payment_id,status,request_state,amount_paise FROM payment_attempts ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      });
    m = path.match(/^\/api\/admin\/payments\/([^/]+)\/reconcile$/);
    if (m && method === 'POST') {
      const input = object(await readJson(req), ['providerOrderId']);
      return response(await reconcilePayment(actor, uuid(m[1]), input.providerOrderId));
    }
    if (path === '/api/admin/coupons' && method === 'GET')
      return response({
        items: (await database().query('SELECT * FROM coupons ORDER BY code LIMIT 100')).rows,
      });
    if (path === '/api/admin/coupons' && method === 'POST')
      return response(await saveCoupon(actor, await readJson(req)), 201);
    if (path === '/api/admin/gift-cards' && method === 'POST')
      return response(await issueGift(actor, await readJson(req)), 201);
    m = path.match(/^\/api\/admin\/content\/([^/]+)$/);
    if (m && method === 'PUT') return response(await content(actor, m[1], await readJson(req)));
    if (path === '/api/admin/reviews' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT id,product_id,rating,body,moderation_status,created_at FROM reviews ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      });
    if (path === '/api/admin/questions' && method === 'GET')
      return response({
        items: (
          await database().query(
            'SELECT id,product_id,question,answer,approved,created_at FROM product_questions ORDER BY created_at DESC LIMIT 100',
          )
        ).rows,
      });
    m = path.match(/^\/api\/admin\/(reviews|questions)\/([^/]+)$/);
    if (m && method === 'PATCH')
      return response(
        await moderate(
          actor,
          m[2],
          await readJson(req),
          m[1] === 'reviews' ? 'review' : 'question',
        ),
      );
    if (path === '/api/admin/support' && method === 'GET')
      return response(await tickets(actor, { owner: true }));
    m = path.match(/^\/api\/admin\/support\/([^/]+)$/);
    if (m && method === 'POST')
      return response(await reply(actor, m[1], await readJson(req), { owner: true }));
    if (path === '/api/admin/analytics' && method === 'GET') return response(await report());
    if (path === '/api/admin/audit' && method === 'GET') {
      const page = integer(Number(url.searchParams.get('page') || 1), 'page', 1, 10000);
      return response({
        items: (
          await database().query(
            'SELECT id,actor_id,action,entity_type,entity_id,details,created_at FROM audit_events ORDER BY created_at DESC,id LIMIT 100 OFFSET $1',
            [(page - 1) * 100],
          )
        ).rows,
      });
    }
    if (path === '/api/admin/export/orders' && method === 'GET') {
      const rows = (
        await database().query(
          'SELECT order_number,status,payment_status,currency,total_paise,created_at FROM orders ORDER BY created_at DESC LIMIT 5000',
        )
      ).rows;
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="novacart-orders.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(
        csv(rows, [
          'order_number',
          'status',
          'payment_status',
          'currency',
          'total_paise',
          'created_at',
        ]),
      );
      return { sent: true };
    }
    if (path === '/api/admin/maintenance' && method === 'POST') {
      await readJson(req);
      return response({
        reservations: await expireReservations(),
        recovery: await abandonedCartBatch(),
        mail: await deliverMail(),
      });
    }
    return response({ error: 'Not found' }, 404);
  }
  const actor = requireActor(await principal(req));
  if (isPublic && method === 'POST') {
    const m = path.match(/^\/api\/products\/([^/]+)\/(reviews|questions)$/);
    if (m)
      return response(
        await engagement(
          actor,
          m[1],
          await readJson(req),
          m[2] === 'reviews' ? 'review' : 'question',
        ),
        201,
      );
  }
  if (path === '/api/credit' && method === 'GET')
    return response({
      balancePaise: await creditBalance(database(), actor),
      loyaltyPoints:
        actor.kind === 'user'
          ? Number(
              (
                await database().query(
                  'SELECT COALESCE(sum(points),0) AS points FROM loyalty_ledger WHERE user_id=$1',
                  [actor.id],
                )
              ).rows[0].points,
            )
          : 0,
    });
  if (path === '/api/gift-cards/redeem' && method === 'POST')
    return response(await redeemGift(actor, await readJson(req)));
  if (path === '/api/preferences' && ['GET', 'PUT'].includes(method))
    return response(await preferences(actor, method === 'PUT' ? await readJson(req) : undefined));
  if (path === '/api/recent' && ['GET', 'POST'].includes(method)) {
    const input = method === 'POST' ? object(await readJson(req), ['productId']) : null;
    return response(await recent(actor, input?.productId));
  }
  if (path === '/api/analytics/event' && method === 'POST')
    return response(await recordAnalytics(actor, await readJson(req)));
  if (path === '/api/notifications' && method === 'GET')
    return response({
      items: (
        await database().query(
          `SELECT id,kind,title,read_at,created_at FROM notifications WHERE ${actorColumn(actor)}=$1 ORDER BY created_at DESC LIMIT 100`,
          [actor.id],
        )
      ).rows,
    });
  if (path === '/api/support' && method === 'GET') return response(await tickets(actor));
  if (path === '/api/support' && method === 'POST')
    return response(await support(actor, await readJson(req)), 201);
  let m = path.match(/^\/api\/support\/([^/]+)$/);
  if (m && method === 'POST') return response(await reply(actor, m[1], await readJson(req)));
  if (path === '/api/privacy/export' && method === 'GET') {
    res.setHeader('Content-Disposition', 'attachment; filename="novacart-personal-data.json"');
    return response(await exportData(actor));
  }
  if (path === '/api/privacy/delete' && method === 'POST') {
    const result = await deleteAccount(actor, await readJson(req));
    res.setHeader(
      'Set-Cookie',
      clearSessionCookie({ secure: process.env.NODE_ENV === 'production' }),
    );
    return response(result);
  }
  m = path.match(/^\/api\/orders\/lookup\/([^/]+)$/);
  if (m && method === 'GET') {
    const row = (
      await database().query(
        `SELECT id,order_number AS "orderNumber",status FROM orders WHERE checkout_key=$1 AND ${actorColumn(actor)}=$2`,
        [key(m[1]), actor.id],
      )
    ).rows[0];
    if (!row) fail('Order not found', 404);
    return response(row);
  }
  m = path.match(/^\/api\/orders\/([^/]+)\/(payment-session|returns)$/);
  if (m && method === 'POST')
    return response(
      m[2] === 'payment-session'
        ? await paymentSession(actor, m[1])
        : await requestReturn(actor, m[1], await readJson(req), req.headers['idempotency-key']),
      m[2] === 'returns' ? 201 : 200,
    );
  return response({ error: 'Not found' }, 404);
}
