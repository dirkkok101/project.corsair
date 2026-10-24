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
  // Alongside the wreck, Space salvages it.
  await expect(page.locator('.hud-prompt')).toContainText('Salvage the wreck');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/voyage-cay.png' });
  await page.keyboard.press(' ');
  await expect.poll(async () => (await voyageOf(page)).step).toBe('prize');
  const card = page.locator('.deed-standard');
  await expect(card.locator('.deed-title')).toHaveText('First salvage');
  await expect(card).toContainText(/\d+ sugar and 4 castaways, off Gallows Cay/);
  const sugar = (await page.evaluate(() => window.__corsair.state.get('ships.player.cargo.sugar'))) as number;
  expect(sugar).toBeGreaterThanOrEqual(20);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/voyage-salvage.png' });
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('chapter 2, the first prize: a pirate harrying a boat, chased and fought with round shot, she strikes, the plunder explained, then home', async ({ page }) => {
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);
  const { cay } = await voyageOf(page);
  await page.evaluate(({ x, y }) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: x + 1.5, y } as never), cay);
  await expect(page.locator('.hud-prompt')).toContainText('Salvage the wreck');
  await page.keyboard.press(' ');
  await expect(page.locator('.deed-standard')).toBeVisible();
  await page.keyboard.press('Enter');
  // Sail ho: the pirate and the boat she harries, the quartermaster's word, and her order.
  const v = (await voyageOf(page)) as Voyage & { pirateId: string; pirate: string };
  expect(v.pirate).toBe('Salt Rat');
  await expect(page.locator('.voyage-ned')).toContainText("She's no great guns, Captain: take her.");
  await expect(page.locator('.voyage-order.now')).toContainText('Take the pirate Salt Rat');
  await expect(page.locator('.hud-prompt')).toContainText('Chase the');
  await expect(page.locator('.hud-picked, .ship-card').first()).toContainText('Salt Rat');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/voyage-sailho.png' });
  // Alongside, Space attacks her.
  await page.evaluate((id) => {
    const s = window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s[id]!.x + 1.2, y: s[id]!.y + 1.2 } as never);
  }, v.pirateId);
  await expect(page.locator('.hud-prompt')).toContainText('Attack the pirate Salt Rat');
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.__corsair.battle.active())).toBe(true);
  // Ned's word as it begins, the arc lesson, and round shot only.
  await expect(page.locator('.battle-ned')).toContainText('Put your side to her');
  await expect(page.locator('.battle-lesson')).toBeVisible();
  await expect(page.locator('.battle-ammo button', { hasText: 'Chain' })).toBeDisabled();
  await expect(page.locator('.battle-ammo button', { hasText: 'Grape' })).toBeDisabled();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/voyage-fight.png' });
  // Fought out (the battle has its own tests): she strikes.
  await page.evaluate(() => {
    for (let i = 0; i < 30 * 60 * 5 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(1, 'cautious');
  });
  expect(await page.evaluate(() => window.__corsair.battle.result()?.outcome)).toBe('struck');
  await expect(page.locator('.plunder-ned')).toContainText("Plunder's the crew's till we're ashore");
  // Not one to keep: she'd only slow the brig.
  await expect(page.locator('.plunder')).toContainText("only slow us");
  // The picked card is the pirate's (not the boat's) until she is taken: checked above by the prompt.
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/voyage-plunder.png' });
  await page.keyboard.press('Enter');
  const card = page.locator('.deed-standard');
  await expect(card.locator('.deed-title')).toHaveText('First prize taken');
  await expect(card.locator('.deed-next')).toContainText('bring it home to Port Royal');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/voyage-prize-deed.png' });
  await page.keyboard.press('Enter');
  expect((await voyageOf(page)).step).toBe('home');
  await expect(page.locator('.hud-prompt')).toContainText('Sail home to Port Royal');
  expect(errors).toEqual([]);
});

/** Chapters 1 and 2 played quickly (each has its own test): salvaged, the pirate taken, and home in port. */
async function toHome(page: Page) {
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);
  const { cay } = await voyageOf(page);
  await page.evaluate(({ x, y }) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: x + 1.5, y } as never), cay);
  await expect(page.locator('.hud-prompt')).toContainText('Salvage the wreck');
  await page.keyboard.press(' ');
  await expect(page.locator('.deed-standard')).toBeVisible();
  await page.keyboard.press('Enter');
  const v = (await voyageOf(page)) as Voyage & { pirateId: string };
  await page.evaluate((id) => {
    const s = window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s[id]!.x + 1.2, y: s[id]!.y + 1.2 } as never);
  }, v.pirateId);
  await expect(page.locator('.hud-prompt')).toContainText('Attack the pirate');
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.__corsair.battle.active())).toBe(true);
  await page.evaluate(() => {
    for (let i = 0; i < 30 * 60 * 5 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(1, 'cautious');
  });
  await expect(page.locator('.plunder')).toBeVisible();
  // (Its keys are heard once it has drawn.)
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(page.locator('.deed-standard')).toBeVisible();
  await page.keyboard.press('Enter');
  // Home: off the harbour, Space enters it.
  await page.evaluate((home) => {
    const p = window.__corsair.ports().find((x) => x.id === home)!;
    for (let r = 1; r < 6; r++)
      for (let a = 0; a < 360; a += 30) {
        const [x, y] = [p.x + r * Math.cos((a * Math.PI) / 180), p.y + r * Math.sin((a * Math.PI) / 180)];
        if (!window.__corsair.land(x, y)) {
          window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x, y } as never);
          return;
        }
      }
  }, v.home);
  await expect(page.locator('.hud-prompt')).toContainText('Enter Port Royal');
  await page.keyboard.press(' ');
  await expect(page.locator('.port')).toBeVisible();
  return errors;
}

test('chapter 3, home with a prize: three buildings, each for one thing; the first sale, a full battery, the plunder shared; then the governor', async ({ page }) => {
  const errors = await toHome(page);
  expect((await voyageOf(page)) as Voyage & { ashore?: boolean }).toMatchObject({ step: 'home', ashore: true });
  // What each building is for; the governor not yet.
  await expect(page.locator('.port-spot', { hasText: 'Merchant' }).locator('.spot-need')).toContainText('sugar to sell');
  await expect(page.locator('.port-spot', { hasText: 'Shipwright' }).locator('.spot-need')).toContainText('guns to mount');
  await expect(page.locator('.port-spot', { hasText: 'Tavern' }).locator('.spot-need')).toContainText('to share');
  await expect(page.locator('.port-spot.shut', { hasText: 'Governor' })).toContainText("He's heard of your prize");
  await expect(page.locator('.voyage-orders')).toContainText('Sell the sugar');
  await expect(page.locator('.voyage-ned')).toContainText('Sell the sugar first, Captain');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/voyage-home.png' });
  // The merchant: one good, one button.
  await page.locator('.port-spot', { hasText: 'Merchant' }).click();
  await expect(page.locator('.first-sale')).toContainText("I don't ask");
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.first-sale img')].every((i) => i.complete));
  await page.screenshot({ path: 'test-results/voyage-first-sale.png' });
  await page.locator('.first-sale-go').click();
  await expect(page.locator('.deed-standard .deed-title')).toHaveText('First cargo sold');
  await page.screenshot({ path: 'test-results/voyage-sold.png' });
  await dismissDeeds(page);
  // His whole market now.
  await expect(page.locator('.merchant')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.port-spot', { hasText: 'Merchant' }).locator('.spot-need.done')).toHaveText('Sold');
  // The shipwright: fill the gun deck.
  await page.locator('.port-spot', { hasText: 'Shipwright' }).click();
  await page.locator('.shipwright').getByRole('button', { name: 'See the guns' }).click();
  await page.locator('.shipwright').getByRole('button', { name: /^Fill the gun deck/ }).click();
  await expect(page.locator('.deed-standard .deed-title')).toHaveText('A full battery');
  await dismissDeeds(page);
  await page.keyboard.press('Escape');
  // The tavern: share out the plunder.
  await page.locator('.port-spot', { hasText: 'Tavern' }).click();
  await page.getByRole('button', { name: 'Divide the plunder' }).click();
  await expect.poll(async () => (await voyageOf(page)).step).toBe('governor');
  await dismissDeeds(page);
  await page.keyboard.press('Escape');
  // The governor's door open, and Ned says so.
  await expect(page.locator('.port-spot.shut')).toHaveCount(0);
  await expect(page.locator('.voyage-ned')).toContainText("He'll see you now");
  await expect(page.locator('.voyage-order.now')).toContainText('See the governor');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/voyage-governor-open.png' });
  expect(errors).toEqual([]);
});

/** Close the deed cards up now (one deed often completes a goal too, each its own card). */
async function dismissDeeds(page: Page) {
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(150);
    if (!(await page.locator('.deed-standard').count())) return;
    await page.keyboard.press('Enter');
  }
}
