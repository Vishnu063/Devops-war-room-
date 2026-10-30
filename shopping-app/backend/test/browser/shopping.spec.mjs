import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test('real database guest shopping and accessibility ' + viewport.width, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#catalogStatus')).toContainText('matching products');
    await expect(page.locator('.productCard')).toHaveCount(8);
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
    test
      .info()
      .annotations.push({
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
