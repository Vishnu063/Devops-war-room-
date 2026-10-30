import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { database, closeDatabase } from '../../db.mjs';
const base = 'http://127.0.0.1:' + (process.env.QA_PORT || 3210),
  nonce = randomBytes(5).toString('hex'),
  ownerEmail = 'owner-' + nonce + '@example.test',
  productName = 'Browser Fixture ' + nonce,
  slug = 'browser-' + nonce;
let ownerCookie;
async function request(context, path, body, cookie, method = 'POST') {
  return context.fetch(base + path, {
    method,
    headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { data: body }),
  });
}
test.beforeAll(async ({ request: context }) => {
  const health = await (await context.get(base + '/api/health')).json();
  expect(health.testRunId).toBe(process.env.QA_RUN_ID);
  const register = await request(context, '/api/auth/register', {
    email: ownerEmail,
    password: process.env.QA_OWNER_PASSWORD,
    name: 'Browser Owner',
  });
  expect(register.status()).toBe(201);
  execFileSync(process.execPath, ['provision-owner.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      OWNER_EMAIL: ownerEmail,
      CONFIRM_OWNER_PROVISION: 'yes',
    },
    stdio: 'pipe',
  });
  const login = await request(context, '/api/auth/login', {
    email: ownerEmail,
    password: process.env.QA_OWNER_PASSWORD,
  });
  expect(login.status()).toBe(200);
  ownerCookie = login.headers()['set-cookie'].split(';')[0];
});
test.afterAll(async () => {
  await database().query('UPDATE products SET active=false WHERE slug=$1', [slug]);
  await closeDatabase();
});

test('owner catalog, variants and operational console are usable and accessible', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/admin');
  const login = page.locator('#loginForm');
  await login.getByLabel('Email', { exact: true }).fill(ownerEmail);
  await login.getByLabel('Password', { exact: true }).fill(process.env.QA_OWNER_PASSWORD);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  const product = page.locator('#productForm');
  for (const [name, value] of Object.entries({
    name: productName,
    slug,
    categorySlug: 'home',
    sku: 'QA-' + nonce.toUpperCase(),
    price: '123.45',
    stock: '4',
    description: 'Fictional browser acceptance product; not for sale.',
  }))
    await product.locator('[name="' + name + '"]').fill(value);
  await product.getByLabel('Published', { exact: true }).check();
  await product.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Product saved');
  const record = page.locator('.product').filter({ hasText: productName });
  await expect(record).toContainText('Published');
  await record.getByRole('button', { name: 'Variants, sales and images' }).click();
  await expect(page.locator('#ownerPanels')).toContainText('Variants for ' + productName);
  const variantForm = page
    .locator('#ownerPanels form')
    .filter({ has: page.getByRole('button', { name: 'Create additional variant' }) });
  await variantForm.getByLabel('New SKU').fill('QA-VARIANT-' + nonce.toUpperCase());
  await variantForm.getByLabel('Price INR', { exact: true }).fill('150.00');
  await variantForm.getByLabel('Stock on hand', { exact: true }).fill('2');
  await variantForm.getByLabel('Color', { exact: true }).fill('Sage');
  await variantForm.getByRole('button', { name: 'Create additional variant' }).click();
  await expect(page.locator('#ownerPanels')).toContainText('QA-VARIANT-' + nonce.toUpperCase());

  await page.getByRole('button', { name: 'Analytics and audit', exact: true }).click();
  await expect(page.locator('#ownerPanels')).toContainText('Actual development database records');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-artifacts/owner-console.png', fullPage: true });
});

test('customer registration, preferences, persistent wishlist, purchase, shipment, return and support', async ({
  page,
  request: context,
}) => {
  await page.goto('/');
  await expect(page.locator('#catalogStatus')).toContainText('matching products');
  await page.locator('#accountButton').click();
  const auth = page.locator('#authForm');
  await auth.locator('#registerChoice').check();
  await auth.getByLabel('Name (for registration)').fill('Customer Fixture');
  await auth.getByLabel('Email', { exact: true }).fill('buyer-' + nonce + '@example.test');
  await auth.getByLabel('Password', { exact: true }).fill('browser-customer-fixture-password');
  await auth.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#accountButton')).toHaveText('Customer');
  await expect(page.locator('#authForm input[name="email"]')).toHaveValue('');
  await expect(page.locator('#authStatus')).toHaveText('');
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'novacart_session');
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe('Lax');
  const customerCookie = 'novacart_session=' + session.value;
  await page.locator('#searchInput').fill(productName);
  await expect(page.locator('#catalogStatus')).toHaveText('1 matching products');
  const card = page.locator('.productCard');
  await card.getByRole('button', { name: 'Add to wishlist: ' + productName, exact: true }).click();
  await expect(page.locator('#wishlistCount')).toHaveText('1');
  await card.getByRole('button', { name: 'Add to bag +', exact: true }).click();
  await page.reload();
  await expect(page.locator('#cartCount')).toHaveText('1');
  await expect(page.locator('#wishlistCount')).toHaveText('1');
  await page.locator('#cartButton').click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  const checkout = page.locator('#checkoutForm');
  const saved = await request(
    context,
    '/api/addresses',
    {
      recipient: 'Fictional Buyer',
      phone: '9876543210',
      line1: '12 Browser Test Lane',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
    customerCookie,
  );
  expect(saved.status()).toBe(201);
  const addressId = (await saved.json()).id;
  // Reopen to fetch the newly saved account address.
  await page.getByRole('button', { name: 'Close checkout', exact: true }).click();
  await page.locator('#cartButton').click();
  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
  await page.getByLabel('Saved address', { exact: true }).selectOption(addressId);
  await expect(checkout.getByLabel('Address line 1', { exact: true })).toHaveValue(
    '12 Browser Test Lane',
  );
  await expect(checkout.getByLabel('PIN code', { exact: true })).toHaveValue('560001');
  await checkout.getByRole('button', { name: 'Place development order' }).click();
  await expect(page.locator('.orderCard').first()).toContainText('CONFIRMED');
  const order = (
    await (await request(context, '/api/orders', undefined, customerCookie, 'GET')).json()
  ).items[0];
  for (const body of [
    { status: 'PACKING' },
    { status: 'SHIPPED', provider: 'Fixture Carrier', trackingNumber: 'BROWSER-TRACK-' + nonce },
    { status: 'DELIVERED', codCollected: true },
  ])
    expect(
      (
        await request(context, '/api/admin/orders/' + order.id + '/transition', body, ownerCookie)
      ).status(),
    ).toBe(200);
  await page.locator('#closeDrawer').click();
  await page.locator('#ordersButton').click();
  await expect(page.locator('.orderCard').first()).toContainText('DELIVERED');
  await page.getByRole('button', { name: 'View order', exact: true }).click();
  await page
    .getByLabel('Return reason', { exact: true })
    .fill('Fictional acceptance return request');
  await page.getByRole('button', { name: 'Request return review' }).click();
  await expect(page.locator('#toast')).toContainText('Return requested');
  await page.locator('#closeDrawer').click();
  await page.locator('#accountButton').click();
  await page.getByRole('button', { name: 'Consent preferences', exact: true }).click();
  const preference = page.locator('#accountContent form');
  await preference.getByLabel('Remember recently viewed products', { exact: true }).check();
  await preference.getByRole('button', { name: 'Save preferences' }).click();
  await expect(preference).toContainText('Saved');
  await page.getByRole('button', { name: 'Customer support', exact: true }).click();
  const ticket = page.locator('#accountContent form').last();
  await ticket.getByLabel('Subject', { exact: true }).fill('Browser support fixture');
  await ticket
    .getByLabel('Message', { exact: true })
    .fill('This is an isolated browser support test.');
  await ticket.getByRole('button', { name: 'Open support ticket' }).click();
  await expect(page.locator('#accountContent')).toContainText('Browser support fixture');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  await page.locator('#searchInput').fill(productName);
  await expect(page.locator('#catalogStatus')).toHaveText('1 matching products');
  await page.getByRole('button', { name: productName, exact: true }).click();
  await page
    .getByLabel('Review', { exact: true })
    .fill('Fictional delivered purchase browser review.');
  await page.getByRole('button', { name: 'Submit review for moderation' }).click();
  await expect(page.locator('#toast')).toContainText('Review submitted');
  await page
    .getByLabel('Ask about this product', { exact: true })
    .fill('Does this fictional product support browser acceptance?');
  await page.getByRole('button', { name: 'Submit question', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Question submitted');
  const questions = (
    await (await request(context, '/api/admin/questions', undefined, ownerCookie, 'GET')).json()
  ).items;
  const question = questions.find((q) => q.question.includes('browser acceptance'));
  expect(question).toBeTruthy();
  expect(
    (
      await request(
        context,
        '/api/admin/questions/' + question.id,
        { answer: 'Fictional approved browser answer.', approved: true },
        ownerCookie,
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  const reviews = (
    await (await request(context, '/api/admin/reviews', undefined, ownerCookie, 'GET')).json()
  ).items;
  const review = reviews.find((r) => r.body === 'Fictional delivered purchase browser review.');
  expect(
    (
      await request(
        context,
        '/api/admin/reviews/' + review.id,
        { status: 'APPROVED' },
        ownerCookie,
        'PATCH',
      )
    ).status(),
  ).toBe(200);
  await page.locator('#closeProduct').click();
  await page.getByRole('button', { name: productName, exact: true }).click();
  await expect(page.locator('#productDetail')).toContainText('Fictional approved browser answer.');
  await expect(page.locator('#productDetail')).toContainText(
    'Fictional delivered purchase browser review.',
  );
  const productA11y = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(productA11y.violations.map((v) => v.id)).toEqual([]);
  await page.locator('#closeProduct').click();
  await page.locator('#searchInput').fill('');
  await expect(page.locator('.productCard')).toHaveCount(8);
  await page.locator('.productCard input[type="checkbox"]').nth(0).check();
  await page.locator('.productCard input[type="checkbox"]').nth(1).check();
  await page.getByRole('button', { name: 'Compare products (2)', exact: true }).click();
  await expect(page.locator('#detailTitle')).toHaveText('Compare products');
  await expect(page.locator('#productDetail section')).toHaveCount(2);
});
