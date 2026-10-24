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
