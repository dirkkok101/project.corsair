import { expect, test } from '@playwright/test';

// The 3D sea map (?renderer=3d, being built): it draws over the 2D view at sea, zooms on the wheel and
// switches to a view from astern on C, and goes away in port.
test('the 3D sea map: draws at sea, zooms, looks from astern, and gives way to the harbour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?seed=3&renderer=3d');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await page.evaluate(() => window.__corsair.sim.pause());
  const sea = page.locator('canvas.sea3d');
  // A new career starts in the harbour: the 3D sea waits behind it.
  await expect(sea).toBeHidden();
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(sea).toBeVisible();
  // Out of the harbour a little way, under sail.
  await page.evaluate(() => window.__corsair.sim.step(300));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/sea3d-near.png' });
  await page.mouse.move(960, 540);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/sea3d-far.png' });
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/sea3d-astern.png' });
  expect(errors).toEqual([]);
});

test('the 3D sky keeps its own slow day: sunset and a moonlit night, for review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const hour of [17.8, 23]) {
    await page.goto(`/?seed=3&renderer=3d&sky=${hour}`);
    await page.waitForFunction(() => Boolean(window.__corsair));
    await page.evaluate(() => window.__corsair.sim.pause());
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(300));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/sea3d-sky-${hour}.png` });
  }
  // The HUD shows the date only in 3D: the sky's hour isn't the game clock's.
  await expect(page.locator('.hud-date').first()).not.toContainText(':00');
  expect(errors).toEqual([]);
});
