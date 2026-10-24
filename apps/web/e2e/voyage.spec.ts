import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The First Voyage (docs/design/first-voyage.md), played as a newcomer plays it: real keys, the world's own clock.

type Voyage = { step: string; home: string; cay: { x: number; y: number; name: string; bearing: string; tiles: number } };

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
};

test('a new career asks how well she knows the sea: the First Voyage, picked for her, opens on the storm letter and its orders', async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await expect(page.locator('.start-h2')).toHaveText('How well do you know the sea?');
  await expect(page.locator('.start-head .k-tag')).toHaveText('3 of 3');
  // New to these waters is picked, and says what it is.
  const fresh = page.locator('.know-card', { hasText: 'New to these waters' });
  await expect(fresh).toHaveAttribute('aria-pressed', 'true');
  await expect(fresh).toContainText('Ned Tully, your quartermaster');
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/voyage-career.png' });
  // Back keeps the sea picked; Enter sets sail.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.start-h2')).toHaveText('How hard a sea?');
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await expect(page.locator('.know-card')).toHaveCount(2);
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Boolean(window.__corsair));
  const letter = page.locator('.moment-voyage');
  await expect(letter).toBeVisible();
  const voyage = (await page.evaluate(() => window.__corsair.state.get('captain.voyage'))) as Voyage;
  expect(voyage.step).toBe('harbour');
  await expect(letter).toContainText(`Last night's storm drove a sloop onto ${voyage.cay.name}, a short sail to the ${voyage.cay.bearing}`);
  await expect(letter.locator('.orders li')).toHaveText([`1Sail out to ${voyage.cay.name} · a short sail ${voyage.cay.bearing} · the smoke on the horizon`, '2See what the storm left', '3Bring it home to Port Royal']);
  await expect(page.locator('.moment-opening')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/voyage-letter.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  // In port at home; the cay off a shore, by sea, clear of every port.
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.docked'))).toBe(voyage.home);
  expect(await page.evaluate(({ x, y }) => window.__corsair.land(x, y), voyage.cay)).toBe(false);
  const ports = await page.evaluate(() => window.__corsair.ports());
  for (const p of ports) expect(Math.hypot(p.x - voyage.cay.x, p.y - voyage.cay.y)).toBeGreaterThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('a seed run sails as a veteran unless it asks for the voyage', async ({ page }) => {
  await page.goto('/?seed=3&pace=1&turn=1');
  await page.waitForFunction(() => Boolean(window.__corsair));
  expect(await page.evaluate(() => window.__corsair.state.get('captain.voyage'))).toBeUndefined();
  await page.goto('/?seed=3&voyage=1&pace=1&turn=1');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.moment-voyage')).toBeVisible();
  expect(((await page.evaluate(() => window.__corsair.state.get('captain.voyage'))) as Voyage).step).toBe('harbour');
});

/** A seed run on the First Voyage, past the storm letter, in port at home. */
async function voyageBegun(page: Page) {
  const errors = errorsOf(page);
  await page.goto('/?seed=3&voyage=1');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.moment-voyage')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  return errors;
}
const voyageOf = (page: Page) => page.evaluate(() => window.__corsair.state.get('captain.voyage')) as Promise<Voyage & { lessons?: string[] }>;

test('chapter 1, the harbour: every building shut and why, her orders, the quartermaster, and Set sail lit', async ({ page }) => {
  const errors = await voyageBegun(page);
  await expect(page.locator('.port-spot.shut')).toHaveCount(4);
  await expect(page.locator('.port-spot.shut', { hasText: 'Merchant' }).locator('.spot-why')).toHaveText('Nothing in your hold to sell yet.');
  await expect(page.locator('.port-spot.shut', { hasText: 'Governor' }).locator('.spot-why')).toContainText('Come back with a prize');
  // A shut building can't be gone into.
  await page.locator('.port-spot.shut', { hasText: 'Shipwright' }).click({ force: true });
  await expect(page.locator('.shipwright')).toHaveCount(0);
  await expect(page.locator('.voyage-orders')).toContainText('Orders · 1 of 3');
  await expect(page.locator('.voyage-order.now')).toContainText('Sail out to Gallows Cay');
  await expect(page.locator('.voyage-ned')).toContainText("Wind's fair for the cay, Captain");
  // No port news over him: one thing at a time.
  await expect(page.locator('.harbour-news')).toHaveCount(0);
  await expect(page.locator('.voyage-go')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/voyage-harbour.png' });
  expect(errors).toEqual([]);
});

test('chapter 1, the helm: out at half sail, steer, more sail, the wind, and the cay reached', async ({ page }) => {
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);
  expect((await voyageOf(page)).step).toBe('helm');
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.sails'))).toBe('half');
  // One prompt: steer, its keys shown.
  const prompt = page.locator('.voyage-prompt');
  await expect(prompt).toContainText('Steer her toward the smoke');
  await expect(prompt.locator('.k-key')).toHaveText(['A', 'D']);
  await expect(page.locator('.voyage-sea .voyage-orders')).toContainText(/Sail out to Gallows Cay\s*\d+ km/);
  await expect(page.locator('.voyage-cay')).toContainText('Gallows Cay · smoke');
  // The goal pill and the port's own prompt keep quiet.
  await expect(page.locator('.hud-goal')).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/voyage-steer.png' });
  await page.keyboard.down('d');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  await expect(prompt).toContainText("More sail: she'll go faster");
  await expect(page.locator('.voyage-pip.done')).toHaveText(['Steer']);
  await page.screenshot({ path: 'test-results/voyage-sail.png' });
  await page.keyboard.press('w');
  await expect(prompt).toHaveCount(0);
  expect((await voyageOf(page)).lessons).toEqual(['steer', 'sail']);
  // Into the wind: the quartermaster says so; bearing away again, the lesson is learned.
  await page.evaluate(() => {
    const me = window.__corsair.state.get('ships.player') as { headingDeg: number };
    window.__corsair.cmd.send({ type: 'SetWind', fromDeg: me.headingDeg, strength: 'fresh' } as never);
  });
  await expect(page.locator('.voyage-ned')).toContainText('Too close to the wind, Captain');
  await page.screenshot({ path: 'test-results/voyage-wind.png' });
  await page.evaluate(() => {
    const me = window.__corsair.state.get('ships.player') as { headingDeg: number };
    window.__corsair.cmd.send({ type: 'SetWind', fromDeg: (me.headingDeg + 120) % 360, strength: 'fresh' } as never);
  });
  await expect(page.locator('.voyage-ned')).toHaveCount(0);
  await expect(page.locator('.voyage-lesson')).toHaveCount(0);
  // The cay reached.
  const { cay } = await voyageOf(page);
  await page.evaluate(({ x, y }) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: x + 1.5, y } as never), cay);
  await expect.poll(async () => (await voyageOf(page)).step).toBe('salvage');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/voyage-cay.png' });
  expect(errors).toEqual([]);
});
