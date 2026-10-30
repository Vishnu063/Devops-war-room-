import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { razorpay, verifySignature } from './payments.mjs';
import { totals, allocate } from './pricing.mjs';
import { csv } from './business.mjs';

test('webhook HMAC validates exact raw bytes and refuses malformed signatures', () => {
  const key = randomBytes(32).toString('hex'),
    raw = Buffer.from('{"event":"test"}'),
    signature = createHmac('sha256', key).update(raw).digest('hex');
  assert.equal(verifySignature(raw, signature, key), true);
  assert.equal(verifySignature(Buffer.from(raw + ' '), signature, key), false);
  assert.equal(verifySignature(raw, 'invalid', key), false);
  assert.equal(verifySignature(raw, signature, ''), false);
});
test('gateway contract keeps INR amount/receipt binding and treats external outcomes as pending', async () => {
  const calls = [],
    receipt = 'local-attempt';
  const provider = razorpay({
    keyId: 'rzp_test_contract',
    keySecret: randomBytes(32).toString('hex'),
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(
        JSON.stringify({ id: 'order_Contract', amount: 12345, currency: 'INR', receipt }),
        { status: 200 },
      );
    },
  });
  assert.equal((await provider.createOrder({ amount: 12345, receipt })).id, 'order_Contract');
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.deepEqual(calls[0].body, {
    amount: 12345,
    currency: 'INR',
    receipt,
    notes: { source: 'NovaCart' },
  });
  const bad = razorpay({
    keyId: 'rzp_test_contract',
    keySecret: randomBytes(32).toString('hex'),
    fetchImpl: async () =>
      new Response(JSON.stringify({ id: 'order_Bad', amount: 1, currency: 'INR', receipt }), {
        status: 200,
      }),
  });
  await assert.rejects(bad.createOrder({ amount: 12345, receipt }), /Invalid provider order/);
});
test('unknown provider dispatch cannot be reported successful or automatically retried', async () => {
  let calls = 0;
  const provider = razorpay({
    keyId: 'rzp_test_contract',
    keySecret: randomBytes(32).toString('hex'),
    fetchImpl: async () => {
      calls++;
      throw new Error('private provider detail');
    },
  });
  await assert.rejects(
    provider.createOrder({ amount: 100, receipt: 'fixture' }),
    /outcome is uncertain/,
  );
  assert.equal(calls, 1);
});
test('coupon allocation preserves every paise and prevents floating point discount drift', () => {
  const t = totals(
    [
      { pricePaise: 10001, quantity: 3 },
      { pricePaise: 1, quantity: 1 },
    ],
    { type: 'PERCENT', value: 33, minimum_paise: 0 },
    500,
  );
  assert.equal(t.discountPaise, 9901);
  assert.equal(t.shippingPaise, 7900);
  assert.equal(t.totalPaise, 28003);
  assert.equal(t.payablePaise, 27503);
  const a = allocate(2, [1, 1, 1]);
  assert.equal(
    a.reduce((s, n) => s + n, 0),
    2,
  );
  assert.deepEqual(a, [1, 1, 0]);
});
test('CSV cells cannot introduce spreadsheet formulas', () => {
  const output = csv([{ name: '=HYPERLINK("malicious")', safe: 'ordinary' }], ['name', 'safe']);
  assert.ok(output.includes("'=HYPERLINK"));
  assert.ok(output.includes('"ordinary"'));
});
