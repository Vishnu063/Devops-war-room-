import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 780 },
  { width: 768, height: 1024 },
]) {
  test('real database guest shopping and accessibility ' + viewport.width, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#catalogStatus')).toContainText('matching products');
    await expect(page.locator('.productCard')).toHaveCount(8);
    if (viewport.width <= 700)
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    const brokenImages = await page
      .locator('img')
      .evaluateAll((images) =>
        images
          .filter((img) => img.complete && img.naturalWidth === 0)
          .map((img) => img.getAttribute('src')),
      );
    expect(brokenImages).toEqual([]);
    const performanceSample = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        viewport: innerWidth,
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        transferBytes: performance
          .getEntriesByType('resource')
          .reduce((sum, r) => sum + r.transferSize, 0),
        scope: 'Unthrottled loopback Chromium; not a production performance SLO',
      };
    });
    test.info().annotations.push({
      type: 'local-performance',
      description: JSON.stringify(performanceSample),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page
      .locator('.productCard')
      .first()
      .getByRole('button', { name: 'Add to bag +', exact: true })
      .click();
    await expect(page.locator('#cartCount')).toHaveText('1');
    await page.reload();
    await expect(page.locator('#cartCount')).toHaveText('1');
    await page.locator('#cartButton').click();
    await page.getByRole('button', { name: 'Continue to checkout' }).click();
    await page.getByLabel('Recipient', { exact: true }).fill('Browser Fixture');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByLabel('Address line 1').fill('12 Test Lane');
    await page.getByLabel('City', { exact: true }).fill('Bengaluru');
    await page.getByLabel('State', { exact: true }).fill('Karnataka');
    await page.getByLabel('PIN code').fill('560001');
    await page.getByRole('button', { name: 'Place development order' }).click();
    await expect(page.locator('.orderCard').first()).toContainText('CONFIRMED');
    await page
      .locator('.orderCard')
      .first()
      .getByRole('button', { name: 'Cancel order', exact: true })
      .click();
    await expect(page.locator('.orderCard').first()).toContainText('CANCELLED');
    await page.locator('#closeDrawer').click();
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      accessibility.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: 'test-artifacts/storefront-' + viewport.width + '.png',
      fullPage: true,
    });
  });
}

test('catalog failure, retry, empty results, broken image and preview checkout are usable', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.productCard')).toHaveCount(8);
  await page.route('**/api/products?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fixture catalog outage' }),
    }),
  );
  await page.getByLabel('Search products', { exact: true }).fill('temporary outage');
  await expect(page.locator('#catalogStatus')).toContainText('Catalog unavailable');
  await expect(page.locator('.productCard')).toHaveCount(0);
  await expect(page.locator('#nextPage')).toBeDisabled();
  await expect(page.locator('#productGrid')).toHaveAttribute('aria-busy', 'false');
  await page.unroute('**/api/products?**');
  await page.getByRole('button', { name: 'Retry loading products', exact: true }).click();
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.productCard')).toHaveCount(8);
  await page
    .locator('.productCard img')
    .first()
    .evaluate((image) => {
      image.src = '/assets/missing-fixture.svg';
    });
  await expect(page.locator('.productCard img').first()).toHaveAttribute(
    'src',
    '/assets/product-placeholder.svg',
  );
  await page
    .locator('.productCard')
    .first()
    .getByRole('button', { name: 'Add to bag +', exact: true })
    .click();
  await expect(page.locator('#cartCount')).toHaveText('1');
  await page.route('**/api/config', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ordersEnabled: false, codEnabled: false, onlineEnabled: false }),
    }),
  );
  await page.reload();
  await page.locator('#cartButton').click();
  await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
  await expect(page.locator('#placeOrder')).toBeDisabled();
  await expect(page.locator('#checkoutStatus')).toContainText(
    'No orders or payments will be accepted',
  );
});

test('product detail skips sold-out variants and disables sold-out products', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.productCard')).toHaveCount(8);
  let soldOut = false;
  await page.route(/\/api\/products\/[^/?]+$/, async (route) => {
    const response = await route.fetch();
    const product = await response.json();
    product.images = [
      { src: '/assets/category-home.svg', alt: 'Fictional gallery image one' },
      { src: '/assets/category-tech.svg', alt: 'Fictional gallery image two' },
    ];
    product.variants = [
      { variantId: 'fixture-empty', sku: 'SOLD-OUT', pricePaise: 10000, stock: 0 },
      {
        variantId: 'fixture-available',
        sku: 'AVAILABLE',
        pricePaise: 12000,
        stock: soldOut ? 0 : 2,
      },
    ];
    await route.fulfill({ response, json: product });
  });
  await page.locator('.productTitle').first().click();
  await page.getByRole('button', { name: 'View product image 2', exact: true }).click();
  await expect(page.locator('.detailImage')).toHaveAttribute('src', '/assets/category-tech.svg');
  await expect(
    page.getByRole('button', { name: 'View product image 2', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Choose variant', { exact: true })).toHaveValue('fixture-available');
  await expect(
    page.getByRole('button', { name: 'Add selected variant', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel('Choose variant', { exact: true }).locator('option').first(),
  ).toHaveJSProperty('disabled', true);
  await page.locator('#closeProduct').click();
  soldOut = true;
  await page.locator('.productTitle').first().click();
  await expect(
    page.locator('#productDetail').getByRole('button', { name: 'Out of stock', exact: true }),
  ).toBeDisabled();
});

test('shared product URL opens the requested product instead of only the homepage', async ({
  page,
}) => {
  const response = await page.request.get('/api/products?limit=1');
  const product = (await response.json()).items[0];
  await page.goto('/products/' + product.slug);
  await expect(page.locator('#productDialog')).toBeVisible();
  await expect(page.locator('#detailTitle')).toHaveText(product.name);
  await expect(page).toHaveTitle(product.name + ' | NovaCart');
});

test('unavailable cart quotation keeps items removable so the customer can recover', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.productCard')).toHaveCount(8);
  await page
    .locator('.productCard')
    .first()
    .getByRole('button', { name: 'Add to bag +', exact: true })
    .click();
  await expect(page.locator('#cartCount')).toHaveText('1');
  await page.route('**/api/cart/quote', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Fixture item became unavailable' }),
    }),
  );
  await page.locator('#cartButton').click();
  await expect(page.locator('#drawerFooter')).toContainText('Update your bag to continue');
  await expect(page.getByRole('button', { name: 'Continue to checkout', exact: true })).toHaveCount(
    0,
  );
  await page.locator('#drawer').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#cartCount')).toHaveText('0');
  await expect(page.locator('#drawerContent')).toContainText('Your bag is empty');
});
