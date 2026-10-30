import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { server } from '../server.mjs';
import { database, closeDatabase } from '../db.mjs';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.CONFIRM_TEST_DATABASE !== 'yes' ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/novacart_test_')
)
  throw new Error(
    'Refusing integration tests without an explicitly disposable novacart_test_ database',
  );
const cwd = new URL('../', import.meta.url);
let base, ownerCookie, customerCookie, customerId, productId, variantId;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  CONFIRM_DEMO_SCHEMA: 'yes',
  CONFIRM_DEMO_SEED: 'yes',
};
function script(name, extra = {}) {
  return execFileSync(process.execPath, [name], {
    cwd,
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
}
async function api(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    headers: response.headers,
  };
}
before(async () => {
  script('migrate.mjs');
  script('migrate.mjs');
  script('seed-demo.mjs');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
});

test('Stage 2 real PostgreSQL registration, provisioning, ownership and audited product lifecycle', async () => {
  const suffix = Date.now();
  const customer = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email: `customer-${suffix}@example.test`,
      password: 'test-password-long-enough',
      name: 'Test Customer',
      role: 'OWNER',
    },
  });
  assert.equal(customer.status, 201);
  assert.equal(customer.body.user.role, 'CUSTOMER');
  assert.ok(customer.cookie);
  assert.equal((await api('/api/auth/me', { cookie: customer.cookie })).status, 200);
  assert.equal((await api('/api/admin/products', { cookie: customer.cookie })).status, 403);
  const email = `owner-${suffix}@example.test`;
  const owner = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'test-owner-password-long', name: 'Test Owner' },
  });
  assert.equal(owner.status, 201);
  script('provision-owner.mjs', { OWNER_EMAIL: email, CONFIRM_OWNER_PROVISION: 'yes' });
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'test-owner-password-long' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'OWNER');
  const input = {
    name: 'Acceptance ' + suffix,
    slug: 'acceptance-' + suffix,
    categorySlug: 'home',
    sku: 'ACCEPT-' + suffix,
    pricePaise: 12345,
    stock: 3,
  };
  const created = await api('/api/admin/products', {
    method: 'POST',
    cookie: login.cookie,
    body: input,
  });
  ownerCookie = login.cookie;
  customerCookie = customer.cookie;
  customerId = customer.body.user.id;
  productId = created.body.id;
  variantId = created.body.variantId;
  assert.equal(created.status, 201);
  assert.equal(created.body.active, false);
  let catalog = await api('/api/products?search=' + encodeURIComponent(input.name));
  assert.equal(catalog.body.total, 0);
  const edit = await api('/api/admin/products/' + created.body.id, {
    method: 'PATCH',
    cookie: login.cookie,
    body: { active: true, stock: 5, pricePaise: 15000 },
  });
  assert.equal(edit.status, 200);
  catalog = await api('/api/products?search=' + encodeURIComponent(input.name));
  assert.equal(catalog.body.total, 1);
  assert.equal(Number(catalog.body.items[0].pricePaise), 15000);
  const quote = await api('/api/checkout/quote', {
    method: 'POST',
    body: { items: [{ variantId: created.body.variantId, quantity: 2, pricePaise: 1 }] },
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.subtotalPaise, 30000);
  const audits = await database().query('SELECT action FROM audit_events WHERE entity_id=$1', [
    created.body.id,
  ]);
  assert.deepEqual(audits.rows.map((r) => r.action).sort(), ['PRODUCT_CREATED', 'PRODUCT_UPDATED']);
  assert.equal(
    (
      await api('/api/admin/products/' + created.body.id, {
        method: 'PATCH',
        cookie: customer.cookie,
        body: { stock: 0 },
      })
    ).status,
    403,
  );
  assert.equal(
    (await api('/api/auth/logout', { method: 'POST', cookie: login.cookie, body: {} })).status,
    200,
  );
  assert.equal((await api('/api/admin/me', { cookie: login.cookie })).status, 403);
  const versions = await database().query('SELECT version FROM schema_migrations ORDER BY version');
  assert.ok(versions.rows.length >= 2);
  ownerCookie = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { email, password: 'test-owner-password-long' },
    })
  ).cookie;
});

const shipping = {
  recipient: 'Fictional Customer',
  phone: '9876543210',
  line1: '12 Demo Lane',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

test('persistent guest cart/wishlist merge, encrypted addresses, immutable COD order, ownership and retry protection', async () => {
  const guest = await api('/api/guest', { method: 'POST', body: {} });
  assert.equal(guest.status, 200);
  assert.equal(
    (
      await api('/api/cart', {
        method: 'PUT',
        cookie: guest.cookie,
        body: { variantId, quantity: 2 },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('/api/wishlist/' + productId, { method: 'PUT', cookie: guest.cookie, body: {} }))
      .status,
    200,
  );
  const email = 'merge-' + Date.now() + '@example.test';
  const merged = await api('/api/auth/register', {
    method: 'POST',
    cookie: guest.cookie,
    body: { email, password: 'test-merge-long-password', name: 'Merge Test' },
  });
  assert.equal(merged.status, 201);
  assert.equal((await api('/api/cart', { cookie: merged.cookie })).body.items[0].quantity, 2);
  assert.equal((await api('/api/wishlist', { cookie: merged.cookie })).body.items.length, 1);
  const address = await api('/api/addresses', {
    method: 'POST',
    cookie: merged.cookie,
    body: shipping,
  });
  assert.equal(address.status, 201);
  const raw = await database().query(
    'SELECT recipient,encrypted_payload FROM addresses WHERE id=$1',
    [address.body.id],
  );
  assert.equal(raw.rows[0].recipient, '[encrypted]');
  assert.ok(!JSON.stringify(raw.rows[0].encrypted_payload).includes('Demo Lane'));
  const quote = await api('/api/cart/quote', { method: 'POST', cookie: merged.cookie, body: {} });
  assert.equal(quote.body.totalPaise, 37900);
  const { randomUUID } = await import('node:crypto');
  const idempotency = randomUUID();
  const body = {
    items: [{ variantId, quantity: 2, pricePaise: 1 }],
    addressId: address.body.id,
    paymentMethod: 'COD',
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      api('/api/orders', {
        method: 'POST',
        cookie: merged.cookie,
        headers: { 'Idempotency-Key': idempotency },
        body,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.id, results[1].body.id);
  const id = results[0].body.id;
  const order = await api('/api/orders/' + id, { cookie: merged.cookie });
  assert.equal(order.status, 200);
  assert.equal(order.body.totalPaise, 37900);
  assert.equal(order.body.status, 'CONFIRMED');
  assert.equal(order.body.address.line1, shipping.line1);
  assert.equal((await api('/api/orders/' + id, { cookie: customerCookie })).status, 404);
  assert.equal(
    (
      await api('/api/orders', {
        method: 'POST',
        cookie: merged.cookie,
        headers: { 'Idempotency-Key': idempotency },
        body: { ...body, items: [{ variantId, quantity: 1 }] },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('/api/orders/' + id + '/cancel', {
        method: 'POST',
        cookie: merged.cookie,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api('/api/orders/' + id + '/cancel', {
        method: 'POST',
        cookie: merged.cookie,
        body: {},
      })
    ).body.duplicate,
    true,
  );
  assert.equal(
    (await database().query('SELECT stock_reserved FROM variants WHERE id=$1', [variantId])).rows[0]
      .stock_reserved,
    0,
  );
  assert.equal(
    (
      await api('/api/cart', {
        method: 'PUT',
        cookie: merged.cookie,
        headers: { Origin: 'http://evil.example' },
        body: { variantId, quantity: 1 },
      })
    ).status,
    403,
  );
});

test('two independent checkouts race for the last unit without overselling; cancellation releases exactly once', async () => {
  const { createAdminProduct } = await import('../admin.mjs');
  const { randomUUID } = await import('node:crypto');
  const owner = (await database().query("SELECT id FROM users WHERE role='OWNER' LIMIT 1")).rows[0];
  const suffix = randomUUID().slice(0, 8);
  const p = await createAdminProduct(
    {
      name: 'Last unit fixture',
      slug: 'last-' + suffix,
      categorySlug: 'home',
      sku: 'LAST-' + suffix.toUpperCase(),
      pricePaise: 10000,
      stock: 1,
      active: true,
    },
    owner.id,
  );
  const guest = await api('/api/guest', { method: 'POST', body: {} });
  const body = {
    items: [{ variantId: p.variantId, quantity: 1 }],
    address: shipping,
    paymentMethod: 'COD',
  };
  const r = await Promise.all(
    [customerCookie, guest.cookie].map((cookie) =>
      api('/api/orders', {
        method: 'POST',
        cookie,
        headers: { 'Idempotency-Key': randomUUID() },
        body,
      }),
    ),
  );
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
  const stock = (
    await database().query('SELECT stock_on_hand,stock_reserved FROM variants WHERE id=$1', [
      p.variantId,
    ])
  ).rows[0];
  assert.deepEqual(stock, { stock_on_hand: 1, stock_reserved: 1 });
  const winner = r.findIndex((x) => x.status === 201),
    cookie = winner === 0 ? customerCookie : guest.cookie;
  await api('/api/orders/' + r[winner].body.id + '/cancel', { method: 'POST', cookie, body: {} });
  assert.equal(
    (await database().query('SELECT stock_reserved FROM variants WHERE id=$1', [p.variantId]))
      .rows[0].stock_reserved,
    0,
  );
});

test('owner fulfillment, verified-purchase reviews, idempotent partial returns and recorded cash refund', async () => {
  const { randomUUID } = await import('node:crypto');
  const created = await api('/api/orders', {
    method: 'POST',
    cookie: customerCookie,
    headers: { 'Idempotency-Key': randomUUID() },
    body: { items: [{ variantId, quantity: 2 }], address: shipping, paymentMethod: 'COD' },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(
    (
      await api('/api/admin/orders/' + id + '/transition', {
        method: 'POST',
        cookie: customerCookie,
        body: { status: 'PACKING' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api('/api/admin/orders/' + id + '/transition', {
        method: 'POST',
        cookie: ownerCookie,
        body: { status: 'DELIVERED', codCollected: true },
      })
    ).status,
    409,
  );
  for (const body of [
    { status: 'PACKING' },
    { status: 'SHIPPED', provider: 'Manual Test Carrier', trackingNumber: 'FIXTURE-TRACK-1' },
    { status: 'DELIVERED', codCollected: true },
  ])
    assert.equal(
      (
        await api('/api/admin/orders/' + id + '/transition', {
          method: 'POST',
          cookie: ownerCookie,
          body,
        })
      ).status,
      200,
    );
  const v = (
    await database().query('SELECT stock_on_hand,stock_reserved FROM variants WHERE id=$1', [
      variantId,
    ])
  ).rows[0];
  assert.deepEqual(v, { stock_on_hand: 3, stock_reserved: 0 });
  assert.equal(
    (
      await api('/api/orders/' + id + '/cancel', {
        method: 'POST',
        cookie: customerCookie,
        body: {},
      })
    ).status,
    409,
  );
  const review = await api('/api/products/' + productId + '/reviews', {
    method: 'POST',
    cookie: customerCookie,
    body: { rating: 4, body: 'Fixture review from a delivered development purchase.' },
  });
  assert.equal(review.status, 201);
  assert.equal((await api('/api/products/' + productId)).body.reviews.length, 0);
  assert.equal(
    (
      await api('/api/admin/reviews/' + review.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { status: 'APPROVED' },
      })
    ).status,
    200,
  );
  assert.equal((await api('/api/products/' + productId)).body.reviews.length, 1);
  const detail = (await api('/api/orders/' + id, { cookie: customerCookie })).body;
  const retKey = randomUUID(),
    body = {
      orderItemId: detail.items[0].id,
      quantity: 1,
      reason: 'Fictional lab return: wrong fit',
    };
  const request = await api('/api/orders/' + id + '/returns', {
    method: 'POST',
    cookie: customerCookie,
    headers: { 'Idempotency-Key': retKey },
    body,
  });
  assert.equal(request.status, 201);
  assert.equal(
    (
      await api('/api/orders/' + id + '/returns', {
        method: 'POST',
        cookie: customerCookie,
        headers: { 'Idempotency-Key': retKey },
        body,
      })
    ).body.duplicate,
    true,
  );
  const received = await api('/api/admin/returns/' + request.body.id, {
    method: 'PATCH',
    cookie: ownerCookie,
    body: { decision: 'RECEIVED', restock: true },
  });
  assert.equal(received.status, 200);
  assert.equal(
    (
      await api('/api/admin/returns/' + request.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { decision: 'RECEIVED', restock: true },
      })
    ).body.duplicate,
    true,
  );
  assert.equal(
    (await database().query('SELECT stock_on_hand FROM variants WHERE id=$1', [variantId])).rows[0]
      .stock_on_hand,
    4,
  );
  const refund = (
    await database().query('SELECT * FROM refunds WHERE return_id=$1', [request.body.id])
  ).rows[0];
  assert.equal(Number(refund.amount_paise), 15000);
  assert.equal(refund.status, 'PENDING');
  const payout = await api('/api/admin/refunds/' + refund.id + '/manual', {
    method: 'POST',
    cookie: ownerCookie,
    body: { reference: 'FIXTURE-CASH-REFUND-1' },
  });
  assert.equal(payout.status, 200);
  assert.equal(
    (await api('/api/orders/' + id, { cookie: customerCookie })).body.paymentStatus,
    'PARTIALLY_REFUNDED',
  );
  const pdf = await fetch(base + '/api/orders/' + id + '/receipt', {
    headers: { Cookie: customerCookie },
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  const secondReturn = await api('/api/orders/' + id + '/returns', {
    method: 'POST',
    cookie: customerCookie,
    headers: { 'Idempotency-Key': randomUUID() },
    body,
  });
  assert.equal(secondReturn.status, 201);
  assert.equal(
    (
      await api('/api/admin/returns/' + secondReturn.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { decision: 'RECEIVED', restock: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('/api/credit', { cookie: customerCookie })).body.loyaltyPoints,
    0,
    'split partial returns reverse all earned points without rounding leakage',
  );
  const secondRefund = (
    await database().query('SELECT id FROM refunds WHERE return_id=$1', [secondReturn.body.id])
  ).rows[0];
  assert.equal(
    (
      await api('/api/admin/refunds/' + secondRefund.id + '/manual', {
        method: 'POST',
        cookie: ownerCookie,
        body: { reference: 'FIXTURE-CASH-REFUND-2' },
      })
    ).status,
    200,
  );
  const fullyReturned = (await api('/api/orders/' + id, { cookie: customerCookie })).body;
  assert.equal(fullyReturned.status, 'RETURNED');
  // Development return policy refunds merchandise; delivery charge is retained.
  assert.equal(
    fullyReturned.refunds.reduce((sum, r) => sum + Number(r.amount_paise), 0),
    fullyReturned.totalPaise - fullyReturned.shippingPaise,
  );
  assert.equal(fullyReturned.paymentStatus, 'PARTIALLY_REFUNDED');
});

test('mocked provider lifecycle verifies signatures/amount, duplicate callbacks, refund confirmation and late captured payment', async () => {
  const { randomUUID, randomBytes, createHmac } = await import('node:crypto');
  const { createOrder, expireReservations } = await import('../commerce.mjs');
  const { paymentSession, processWebhook, submitRefund } = await import('../payments.mjs');
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
  process.env.RAZORPAY_KEY_SECRET = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  let createCalls = 0,
    refundCalls = 0;
  const provider = {
    keyId: 'rzp_test_fixture',
    createOrder: async ({ amount, receipt }) => {
      createCalls++;
      return { id: 'order_' + receipt.replaceAll('-', ''), amount, currency: 'INR', receipt };
    },
    refund: async ({ paymentId, amount, receipt }) => {
      refundCalls++;
      return { id: 'rfnd_' + receipt.replaceAll('-', ''), payment_id: paymentId, amount };
    },
  };
  const actor = { kind: 'user', id: customerId };
  async function event(type, entity, id = randomUUID()) {
    const raw = Buffer.from(
      JSON.stringify({
        event: type,
        payload: { [type.startsWith('refund') ? 'refund' : 'payment']: { entity } },
      }),
    );
    return processWebhook(raw, createHmac('sha256', secret).update(raw).digest('hex'), id, {
      secret,
    });
  }
  const order = await createOrder(
    actor,
    { items: [{ variantId, quantity: 1 }], address: shipping, paymentMethod: 'RAZORPAY' },
    randomUUID(),
  );
  const session = await paymentSession(actor, order.id, { providerFactory: () => provider });
  await paymentSession(actor, order.id, { providerFactory: () => provider });
  assert.equal(createCalls, 1);
  const entity = {
    id: 'pay_' + randomBytes(10).toString('hex'),
    order_id: session.providerOrderId,
    amount: session.amountPaise,
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  const raw = Buffer.from(
      JSON.stringify({ event: 'payment.captured', payload: { payment: { entity } } }),
    ),
    sig = createHmac('sha256', secret).update(raw).digest('hex'),
    eventId = randomUUID();
  await assert.rejects(
    processWebhook(raw, sig + 'x', eventId, { secret }),
    (e) => e.status === 401,
  );
  await assert.rejects(
    event('payment.captured', { ...entity, amount: 1 }),
    (e) => e.status === 409,
  );
  assert.equal((await processWebhook(raw, sig, eventId, { secret })).duplicate, false);
  assert.equal((await processWebhook(raw, sig, eventId, { secret })).duplicate, true);
  assert.equal(
    (await api('/api/orders/' + order.id, { cookie: customerCookie })).body.status,
    'CONFIRMED',
  );
  await api('/api/orders/' + order.id + '/cancel', {
    method: 'POST',
    cookie: customerCookie,
    body: {},
  });
  const refund = (await database().query('SELECT * FROM refunds WHERE order_id=$1', [order.id]))
    .rows[0];
  assert.equal(refund.status, 'PENDING');
  const submitted = await submitRefund(
    {
      kind: 'user',
      id: (await database().query("SELECT id FROM users WHERE role='OWNER' LIMIT 1")).rows[0].id,
    },
    refund.id,
    { providerFactory: () => provider },
  );
  await submitRefund(actor, refund.id, { providerFactory: () => provider });
  assert.equal(refundCalls, 1);
  assert.equal(
    (await api('/api/orders/' + order.id, { cookie: customerCookie })).body.paymentStatus,
    'PAID',
  );
  await event('refund.processed', {
    id: submitted.providerRefundId,
    payment_id: entity.id,
    amount: session.amountPaise,
    currency: 'INR',
    status: 'processed',
  });
  assert.equal(
    (await api('/api/orders/' + order.id, { cookie: customerCookie })).body.paymentStatus,
    'REFUNDED',
  );
  const late = await createOrder(
    actor,
    { items: [{ variantId, quantity: 1 }], address: shipping, paymentMethod: 'RAZORPAY' },
    randomUUID(),
  );
  const lateSession = await paymentSession(actor, late.id, { providerFactory: () => provider });
  await database().query(
    "UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1",
    [late.id],
  );
  await expireReservations();
  await event('payment.captured', {
    ...entity,
    id: 'pay_' + randomBytes(10).toString('hex'),
    order_id: lateSession.providerOrderId,
    amount: lateSession.amountPaise,
  });
  const lateOrder = (await api('/api/orders/' + late.id, { cookie: customerCookie })).body;
  assert.equal(lateOrder.status, 'CANCELLED');
  assert.equal(lateOrder.paymentStatus, 'PAID');
  assert.equal(lateOrder.refunds.length, 1);
  assert.equal(lateOrder.refunds[0].status, 'PENDING');
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

test('promotions, one-use gift credit, consent, support ownership and privacy erasure', async () => {
  const { randomUUID } = await import('node:crypto');
  const suffix = randomUUID().slice(0, 8);
  const account = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'privacy-' + suffix + '@example.test',
      name: 'Privacy Fixture',
      password: 'privacy-fixture-password',
    },
  });
  assert.equal(account.status, 201);
  const cookie = account.cookie;
  const coupon = await api('/api/admin/coupons', {
    method: 'POST',
    cookie: ownerCookie,
    body: { code: 'TEST-' + suffix, type: 'PERCENT', value: 10, usageLimit: 1 },
  });
  assert.equal(coupon.status, 201);
  const quote = await api('/api/cart/quote', {
    method: 'POST',
    cookie,
    body: { items: [{ variantId, quantity: 1 }], couponCode: 'TEST-' + suffix },
  });
  assert.equal(quote.body.discountPaise, 1500);
  const gift = await api('/api/admin/gift-cards', {
    method: 'POST',
    cookie: ownerCookie,
    body: { amountPaise: 5000 },
  });
  assert.equal(gift.status, 201);
  assert.equal(
    (
      await api('/api/gift-cards/redeem', {
        method: 'POST',
        cookie,
        body: { code: gift.body.code },
      })
    ).body.balancePaise,
    5000,
  );
  assert.equal(
    (
      await api('/api/gift-cards/redeem', {
        method: 'POST',
        cookie,
        body: { code: gift.body.code },
      })
    ).status,
    409,
  );
  const p = await api('/api/preferences', { cookie });
  assert.deepEqual(p.body, { marketing: false, personalization: false, analytics: false });
  assert.equal(
    (await api('/api/recent', { method: 'POST', cookie, body: { productId } })).body
      .consentRequired,
    true,
  );
  await api('/api/preferences', {
    method: 'PUT',
    cookie,
    body: { marketing: false, personalization: true, analytics: false },
  });
  assert.equal(
    (await api('/api/recent', { method: 'POST', cookie, body: { productId } })).body.items.length,
    1,
  );
  const ticket = await api('/api/support', {
    method: 'POST',
    cookie,
    body: {
      subject: 'Development question',
      message: 'Fixture support message, no real customer data.',
    },
  });
  assert.equal(ticket.status, 201);
  assert.equal(
    (
      await api('/api/support/' + ticket.body.id, {
        method: 'POST',
        cookie: customerCookie,
        body: { message: 'Not my ticket' },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api('/api/admin/support/' + ticket.body.id, {
        method: 'POST',
        cookie: ownerCookie,
        body: { message: 'Fixture owner reply', status: 'RESOLVED' },
      })
    ).status,
    200,
  );
  assert.equal((await api('/api/support', { cookie })).body.items[0].messages.length, 2);
  const order = await api('/api/orders', {
    method: 'POST',
    cookie,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      items: [{ variantId, quantity: 1 }],
      address: shipping,
      paymentMethod: 'COD',
      couponCode: 'TEST-' + suffix,
      useStoreCredit: true,
    },
  });
  assert.equal(order.status, 201);
  const detail = (await api('/api/orders/' + order.body.id, { cookie })).body;
  assert.equal(detail.creditPaise, 5000);
  assert.equal(detail.payablePaise, 16400);
  assert.equal(
    (
      await api('/api/privacy/delete', {
        method: 'POST',
        cookie,
        body: { password: 'privacy-fixture-password', confirmation: 'DELETE' },
      })
    ).status,
    409,
  );
  await api('/api/orders/' + order.body.id + '/cancel', { method: 'POST', cookie, body: {} });
  assert.equal(
    (await database().query('SELECT usage_count FROM coupons WHERE id=$1', [coupon.body.id]))
      .rows[0].usage_count,
    0,
  );
  // Restore of spent credit is verified; erasure refuses to discard a monetary balance.
  assert.equal((await api('/api/credit', { cookie })).body.balancePaise, 5000);
  const exported = await api('/api/privacy/export', { cookie });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.user.email, 'privacy-' + suffix + '@example.test');
  assert.equal(exported.body.supportMessages.length, 2);
  assert.equal(exported.body.creditLedger.length, 3);
  assert.equal(exported.body.orders.length, 1);
  assert.ok(exported.body.audit.some((row) => row.action === 'CONSENT_UPDATED'));
  assert.ok(!JSON.stringify(exported.body).includes('password_hash'));
  const erase = await api('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'erase-' + suffix + '@example.test',
      name: 'Erase Fixture',
      password: 'erase-fixture-password',
    },
  });
  assert.equal(erase.status, 201);
  assert.equal(
    (
      await api('/api/privacy/delete', {
        method: 'POST',
        cookie: erase.cookie,
        body: { password: 'erase-fixture-password', confirmation: 'DELETE' },
      })
    ).status,
    200,
  );
  assert.equal((await api('/api/auth/me', { cookie: erase.cookie })).status, 401);
  const erased = (
    await database().query('SELECT email,name,password_hash FROM users WHERE id=$1', [
      erase.body.user.id,
    ])
  ).rows[0];
  assert.equal(erased.name, '[erased]');
  assert.equal(erased.password_hash, '[revoked]');
});

test('single-use verification/reset, session expiry/revocation, shared throttling and backend-enforced owner MFA', async () => {
  const { randomUUID } = await import('node:crypto');
  const { open } = await import('../validation.mjs');
  const { databaseRateLimit } = await import('../security.mjs');
  const OTPAuth = await import('otpauth');
  const suffix = randomUUID().slice(0, 8),
    email = 'identity-' + suffix + '@example.test';
  const created = await api('/api/auth/register', {
    method: 'POST',
    body: { email, name: 'Identity Fixture', password: 'identity-fixture-password' },
  });
  assert.equal(created.status, 201);
  const mail = (
    await database().query(
      'SELECT encrypted_payload FROM mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [created.body.user.id],
    )
  ).rows[0];
  const token = open(mail.encrypted_payload, 'mail').text.match(/#verify=([A-Za-z0-9_-]+)/)[1];
  assert.equal(
    (await api('/api/auth/verify-email', { method: 'POST', body: { token } })).status,
    200,
  );
  assert.equal(
    (await api('/api/auth/verify-email', { method: 'POST', body: { token } })).status,
    400,
  );
  const forgot = await api('/api/auth/forgot-password', { method: 'POST', body: { email } }),
    unknown = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'missing-' + suffix + '@example.test' },
    });
  assert.deepEqual(forgot.body, unknown.body);
  const resetMail = (
    await database().query(
      'SELECT encrypted_payload FROM mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [created.body.user.id],
    )
  ).rows[0];
  const resetToken = open(resetMail.encrypted_payload, 'mail').text.match(
    /#reset=([A-Za-z0-9_-]+)/,
  )[1];
  assert.equal(
    (
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, password: 'changed-fixture-password' },
      })
    ).status,
    200,
  );
  assert.equal((await api('/api/auth/me', { cookie: created.cookie })).status, 401);
  assert.equal(
    (
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, password: 'changed-fixture-password' },
      })
    ).status,
    400,
  );
  const limited = await Promise.all([
    databaseRateLimit('fixture:' + suffix, { max: 1 }),
    databaseRateLimit('fixture:' + suffix, { max: 1 }),
  ]);
  assert.deepEqual(limited.map((r) => r.allowed).sort(), [false, true]);
  const expired = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'changed-fixture-password' },
  });
  await database().query(
    "UPDATE user_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [created.body.user.id],
  );
  assert.equal((await api('/api/auth/me', { cookie: expired.cookie })).status, 401);
  assert.equal(
    (
      await api('/api/auth/mfa/setup', {
        method: 'POST',
        cookie: customerCookie,
        body: { password: 'test-password-long-enough' },
      })
    ).status,
    403,
  );
  const setup = await api('/api/auth/mfa/setup', {
    method: 'POST',
    cookie: ownerCookie,
    body: { password: 'test-owner-password-long' },
  });
  assert.equal(setup.status, 200);
  const otp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(setup.body.secret),
    period: 30,
    digits: 6,
  });
  const finish = await api('/api/auth/mfa/confirm', {
    method: 'POST',
    cookie: ownerCookie,
    body: { code: otp.generate() },
  });
  assert.equal(finish.status, 200);
  assert.equal((await api('/api/admin/products', { cookie: ownerCookie })).status, 403);
  ownerCookie = finish.cookie;
  assert.equal((await api('/api/admin/products', { cookie: ownerCookie })).status, 200);
  const ownerEmail = (await api('/api/auth/me', { cookie: ownerCookie })).body.user.email;
  assert.equal(
    (
      await api('/api/auth/login', {
        method: 'POST',
        body: { email: ownerEmail, password: 'test-owner-password-long' },
      })
    ).status,
    401,
  );
  const nextCode = otp.generate({ timestamp: Date.now() + 30000 });
  const mfaLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ownerEmail, password: 'test-owner-password-long', totp: nextCode },
  });
  assert.equal(mfaLogin.status, 200);
  ownerCookie = mfaLogin.cookie;
  assert.equal(
    (
      await api('/api/auth/login', {
        method: 'POST',
        body: { email: ownerEmail, password: 'test-owner-password-long', totp: nextCode },
      })
    ).status,
    401,
  );
});

test('variant search, scheduled prices, bulk result reporting, rollback and sanitized negative responses', async () => {
  const { randomUUID } = await import('node:crypto');
  const suffix = randomUUID().slice(0, 8);
  const create = await api('/api/admin/products', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      name: 'Variants ' + suffix,
      slug: 'variants-' + suffix,
      categorySlug: 'tech',
      sku: 'VBASE-' + suffix.toUpperCase(),
      pricePaise: 30000,
      stock: 3,
      active: true,
    },
  });
  assert.equal(create.status, 201);
  const variant = await api('/api/admin/products/' + create.body.id + '/variants', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      sku: 'VOTHER-' + suffix.toUpperCase(),
      pricePaise: 20000,
      stock: 4,
      attributes: { color: 'Sage' },
    },
  });
  assert.equal(variant.status, 201);
  const search = await api('/api/products?search=VOTHER-' + suffix.toUpperCase());
  assert.equal(search.body.total, 1);
  assert.equal(search.body.items[0].id, create.body.id);
  assert.equal((await api('/api/products/' + create.body.id)).body.variants.length, 2);
  assert.equal(
    (
      await api('/api/admin/variants/' + variant.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: {
          salePricePaise: 10000,
          saleStartsAt: new Date(Date.now() - 60000).toISOString(),
          saleEndsAt: new Date(Date.now() + 60000).toISOString(),
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('/api/products/' + create.body.id)).body.variants.find(
      (v) => v.variantId === variant.body.id,
    ).pricePaise,
    10000,
  );
  const q = await api('/api/cart/quote', {
    method: 'POST',
    cookie: customerCookie,
    body: { items: [{ variantId: variant.body.id, quantity: 1 }] },
  });
  assert.equal(q.body.subtotalPaise, 10000);
  assert.equal(
    (
      await api('/api/admin/variants/' + variant.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { pricePaise: 5000 },
      })
    ).status,
    400,
  );
  const reserved = await api('/api/orders', {
    method: 'POST',
    cookie: customerCookie,
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      items: [{ variantId: variant.body.id, quantity: 1 }],
      address: shipping,
      paymentMethod: 'COD',
    },
  });
  assert.equal(reserved.status, 201);
  assert.equal(
    (
      await api('/api/admin/variants/' + variant.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { stock: 0 },
      })
    ).status,
    409,
  );
  await api('/api/orders/' + reserved.body.id + '/cancel', {
    method: 'POST',
    cookie: customerCookie,
    body: {},
  });
  const input = {
    name: 'Bulk ' + suffix,
    slug: 'bulk-' + suffix,
    categorySlug: 'home',
    sku: 'BULK-' + suffix.toUpperCase(),
    pricePaise: 10000,
    stock: 2,
  };
  const bulk = await api('/api/admin/products/bulk', {
    method: 'POST',
    cookie: ownerCookie,
    body: { items: [input, input] },
  });
  assert.equal(bulk.status, 207);
  assert.deepEqual(
    bulk.body.items.map((x) => x.status),
    ['CREATED', 'REJECTED'],
  );
  const before = (await database().query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
  assert.equal(
    (
      await api('/api/orders', {
        method: 'POST',
        cookie: customerCookie,
        headers: { 'Idempotency-Key': randomUUID() },
        body: {
          items: [{ variantId: variant.body.id, quantity: 1 }],
          address: { ...shipping, pincode: '000000' },
          paymentMethod: 'COD',
        },
      })
    ).status,
    400,
  );
  assert.equal((await database().query('SELECT count(*)::int AS n FROM orders')).rows[0].n, before);
  const missingOrigin = await fetch(base + '/api/cart', {
    method: 'PUT',
    headers: { Cookie: customerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId, quantity: 1 }),
  });
  assert.equal(missingOrigin.status, 403);
  const injection = await api('/api/products?search=' + encodeURIComponent("' OR true;--"));
  assert.equal(injection.status, 200);
  assert.equal(injection.body.total, 0);
  const badId = await api('/api/orders/not-a-uuid', { cookie: customerCookie });
  assert.equal(badId.status, 400);
  assert.ok(!JSON.stringify(badId.body).includes('SELECT'));
});

test('moderated discovery, comparisons, CMS/SEO escaping and consent-limited personalization', async () => {
  const product = (await api('/api/products/' + productId)).body;
  const question = await api('/api/products/' + productId + '/questions', {
    method: 'POST',
    cookie: customerCookie,
    body: { question: 'Does this fictional product have a test warranty?' },
  });
  assert.equal(question.status, 201);
  assert.ok(
    !(await api('/api/products/' + productId + '/questions')).body.items.some(
      (q) => q.id === question.body.id,
    ),
  );
  assert.equal(
    (
      await api('/api/admin/questions/' + question.body.id, {
        method: 'PATCH',
        cookie: ownerCookie,
        body: { answer: 'Fictional test answer only.', approved: true },
      })
    ).status,
    200,
  );
  assert.ok(
    (await api('/api/products/' + productId + '/questions')).body.items.some(
      (q) => q.id === question.body.id,
    ),
  );
  const second = (await api('/api/products')).body.items.find((p) => p.id !== productId);
  assert.equal((await api('/api/compare?ids=' + productId + ',' + second.id)).body.items.length, 2);
  assert.equal((await api('/api/compare?ids=' + productId)).status, 400);
  const prefs = { marketing: false, personalization: true, analytics: false };
  await api('/api/preferences', { method: 'PUT', cookie: customerCookie, body: prefs });
  assert.equal(
    (await api('/api/recent', { method: 'POST', cookie: customerCookie, body: { productId } })).body
      .items[0].id,
    productId,
  );
  await api('/api/preferences', {
    method: 'PUT',
    cookie: customerCookie,
    body: { ...prefs, personalization: false },
  });
  assert.equal((await api('/api/recent', { cookie: customerCookie })).body.items.length, 0);
  assert.equal((await api('/api/products/' + productId + '/recommendations')).status, 200);
  for (const k of ['homepage', 'campaign'])
    assert.equal(
      (
        await api('/api/admin/content/' + k, {
          method: 'PUT',
          cookie: ownerCookie,
          body: {
            title: 'Fictional <content>',
            body: 'Plain text only, never executable HTML.',
            enabled: true,
          },
        })
      ).status,
      200,
    );
  assert.equal(
    (await api('/api/content')).body.items.filter((x) => ['homepage', 'campaign'].includes(x.key))
      .length,
    2,
  );
  const page = await fetch(base + '/products/' + product.slug);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('name="robots" content="noindex,nofollow"'));
  assert.ok(
    (await (await fetch(base + '/sitemap.xml')).text()).includes('/products/' + product.slug),
  );
  assert.ok((await (await fetch(base + '/robots.txt')).text()).includes('Disallow: /'));
});
