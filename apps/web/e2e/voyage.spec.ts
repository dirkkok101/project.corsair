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
  await expect(letter.locator('.moment-fate')).toContainText('If you retired today');
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
/** One of the HUD's hints at sea ("Salvage the wreck · E"): its key cap is `.k-key`. */
const hint = (page: Page, text: string | RegExp) => page.locator('.hud-prompts .hud-prompt', { hasText: text });

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
  // One prompt at a time: steer (its keys shown), unless she left harbour with her head on the smoke already.
  const prompt = page.locator('.voyage-prompt');
  await expect(prompt).toContainText(/Steer her toward the smoke|More sail/);
  await expect(page.locator('.voyage-sea .voyage-orders')).toContainText(/Sail out to Gallows Cay\s*\d+ km/);
  await expect(page.locator('.voyage-cay')).toContainText('Gallows Cay · smoke');
  // The goal pill and the port's own prompt keep quiet.
  await expect(page.locator('.hud-goal')).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/voyage-steer.png' });
  if ((await prompt.innerText()).includes('Steer')) {
    await expect(prompt.locator('.k-key')).toHaveText(['A', 'D']);
    await page.keyboard.down('d');
    await page.waitForTimeout(400);
    await page.keyboard.up('d');
  }
  await expect(prompt).toContainText("More sail: she'll go faster");
  await expect(page.locator('.voyage-pip.done')).toHaveText(['Steer']);
  await page.screenshot({ path: 'test-results/voyage-sail.png' });
  await page.keyboard.press('w');
  await expect(prompt).toHaveCount(0);
  expect((await voyageOf(page)).lessons).toEqual(expect.arrayContaining(['steer', 'sail']));
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
  // Come up to the wreck she heaves to: the order is done (no banner), and E salvages it.
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.sails'))).toBe('furled');
  await expect(page.locator('.hud-order')).toHaveCount(0);
  await expect(hint(page, 'Salvage the wreck').locator('.k-key')).toHaveText('E');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/voyage-cay.png' });
  await page.keyboard.press('e');
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
  await expect(hint(page, 'Salvage the wreck').locator('.k-key')).toHaveText('E');
  await page.keyboard.press('e');
  await expect(page.locator('.deed-standard')).toBeVisible();
  await page.keyboard.press('Enter');
  // Sail ho: the pirate and the boat she harries, the quartermaster's word, and her order.
  const v = (await voyageOf(page)) as Voyage & { pirateId: string; pirate: string };
  expect(v.pirate).toBe('Salt Rat');
  await expect(page.locator('.voyage-ned')).toContainText("She's no great guns, Captain: take her.");
  await expect(page.locator('.voyage-order.now')).toContainText('Take the pirate Salt Rat');
  // Her order is the pirate, waiting on Space.
  await expect(page.locator('.hud-order')).toContainText('After the pirate Salt Rat');
  await expect(page.locator('.hud-order')).toContainText('paused');
  await expect(hint(page, 'Chase the pirate Salt Rat').locator('.k-key')).toHaveText('Space');
  await expect(page.locator('.hud-picked, .ship-card').first()).toContainText('Salt Rat');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/voyage-sailho.png' });
  // Space sails the order: she makes sail and goes after her.
  await page.keyboard.press(' ');
  await expect(page.locator('.hud-order')).toContainText('sailing it');
  await expect(hint(page, 'Chase the pirate Salt Rat')).toHaveCount(0);
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'intercept', targetId: v.pirateId });
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.sails'))).not.toBe('furled');
  // Alongside, the chase opens the fight of itself (or F attacks her, if she came alongside another way).
  await alongside(page, v.pirateId);
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => window.__corsair.battle.active()))) {
    await expect(hint(page, 'Attack the pirate Salt Rat').locator('.k-key')).toHaveText('F');
    await page.keyboard.press('f');
  }
  await expect.poll(() => page.evaluate(() => window.__corsair.battle.active())).toBe(true);
  // Ned's word as it begins, the arc lesson, and round shot only.
  await expect(page.locator('.battle-ned')).toContainText('put your side to her');
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
  // Home is her order now: Space sails it.
  await expect(page.locator('.hud-order')).toContainText('Home to Port Royal');
  await expect(hint(page, 'Sail home to Port Royal').locator('.k-key')).toHaveText('Space');
  await page.keyboard.press(' ');
  await expect(page.locator('.hud-order')).toContainText('sailing it');
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'course', portId: v.home });
  expect(errors).toEqual([]);
});

/** Chapters 1 and 2 played quickly (each has its own test): salvaged, the pirate taken, and home in port. */
async function toHome(page: Page) {
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);
  const { cay } = await voyageOf(page);
  await page.evaluate(({ x, y }) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: x + 1.5, y } as never), cay);
  await expect(hint(page, 'Salvage the wreck')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.locator('.deed-standard')).toBeVisible();
  await page.keyboard.press('Enter');
  const v = (await voyageOf(page)) as Voyage & { pirateId: string };
  await alongside(page, v.pirateId);
  await expect(hint(page, 'Attack the pirate')).toBeVisible();
  await page.keyboard.press('f');
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
  // Home: off the harbour, E enters it.
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
  await expect(hint(page, 'Enter Port Royal').locator('.k-key')).toHaveText('E');
  await page.keyboard.press('e');
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

/** Chapter 3's chores done quickly (it has its own test): sold, a full battery, the plunder shared. */
async function toGovernor(page: Page) {
  const errors = await toHome(page);
  await page.evaluate(() => {
    const send = (c: unknown) => window.__corsair.cmd.send(c as never);
    send({ type: 'Sell', shipId: 'player', good: 'sugar', quantity: 1000 });
    send({ type: 'BuyGuns', shipId: 'player', count: 20 });
    send({ type: 'DividePlunder', shipId: 'player' });
    window.__corsair.sim.step(1);
  });
  await expect.poll(async () => (await voyageOf(page)).step).toBe('governor');
  await dismissDeeds(page);
  return errors;
}

test('chapter 4, the governor: a letter of marque with its ceremony, then three matters on his desk; one taken, the voyage done', async ({ page }) => {
  const errors = await toGovernor(page);
  await page.locator('.port-spot', { hasText: 'Governor' }).click();
  // The ceremony: her first rung.
  const moment = page.locator('.moment-promotion');
  await expect(moment).toContainText('Letter of marque');
  await expect(moment).toContainText('in the service of England');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/voyage-marque.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  // His three matters, in character.
  const desk = page.locator('.commissions');
  await expect(desk.locator('.commissions-title')).toHaveText('Three matters on his desk');
  await expect(desk.locator('.commission')).toHaveCount(3);
  await expect(desk.locator('.commission-courier')).toContainText('Carry a letter');
  await expect(desk.locator('.commission-trade')).toContainText('Run a cargo');
  await expect(desk.locator('.commission-hunt')).toContainText('Lighter than your ship');
  await expect(desk).not.toContainText(/course/i);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/voyage-commissions.png' });
  // A letter to carry: the mission taken, the voyage done, said out loud.
  await desk.getByRole('button', { name: "I'll carry it" }).click();
  await expect.poll(async () => (await voyageOf(page)).step).toBe('done');
  const missions = (await page.evaluate(() => window.__corsair.state.get('captain.missions'))) as { kind: string }[];
  expect(missions.map((m) => m.kind)).toEqual(['courier']);
  await expect(page.locator('.deed-standard .deed-title')).toHaveText('The First Voyage sailed');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/voyage-done.png' });
  await dismissDeeds(page);
  // Off the voyage: his own screen again, every building open, no orders.
  await expect(page.locator('.governor')).toBeVisible();
  await expect(page.locator('.voyage-orders')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('chapter 4, the cargo run: the hold filled and the course plotted for where it sells', async ({ page }) => {
  await toGovernor(page);
  await page.locator('.port-spot', { hasText: 'Governor' }).click();
  await expect(page.locator('.moment-promotion')).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  const card = page.locator('.commission-trade');
  const line = await card.locator('.commission-line').first().innerText();
  const [, units, good] = /^Buy (\d+) (\w+)/.exec(line)!;
  await card.getByRole('button', { name: "I'll run it" }).click();
  await expect.poll(async () => (await voyageOf(page)).step).toBe('done');
  const cargo = (await page.evaluate(() => window.__corsair.state.get('ships.player.cargo'))) as Record<string, number>;
  expect(cargo[good!.toLowerCase()]).toBe(Number(units));
});

test('chapter 4, the hunt: a pirate lighter than her match put on the sea', async ({ page }) => {
  await toGovernor(page);
  await page.locator('.port-spot', { hasText: 'Governor' }).click();
  await expect(page.locator('.moment-promotion')).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.locator('.commission-hunt').getByRole('button', { name: "I'll hunt her" }).click();
  await expect.poll(async () => (await voyageOf(page)).step).toBe('done');
  const missions = (await page.evaluate(() => window.__corsair.state.get('captain.missions'))) as { kind: string; classId: string }[];
  expect(missions).toMatchObject([{ kind: 'hunt', classId: 'ship.sloop' }]);
});

test('the quartermaster can be sent ashore from the log: asked once, then every port open', async ({ page }) => {
  const errors = await voyageBegun(page);
  await page.keyboard.press('l');
  await page.getByRole('button', { name: 'Send the quartermaster ashore' }).click();
  await expect(page.locator('.log-ashore')).toContainText('End the First Voyage?');
  await page.screenshot({ path: 'test-results/voyage-ashore.png' });
  await page.getByRole('button', { name: 'Send him ashore' }).click();
  await expect.poll(async () => (await voyageOf(page)).step).toBe('done');
  await page.keyboard.press('l');
  await expect(page.locator('.port-spot.shut')).toHaveCount(0);
  await expect(page.locator('.voyage-orders')).toHaveCount(0);
  await expect(page.locator('.voyage-ned')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The playtests sail on the real clock with a newcomer's keys: a tool for judging the voyage's pace, run alone
// (PLAYTEST=1 npx playwright test -g playtest --workers=1), not with the gate's eight browsers at once.
test('playtest, chapter 1 as a newcomer: out of harbour and to the smoke with A, D and W alone, on the real clock', async ({ page }) => {
  test.skip(!process.env.PLAYTEST, 'run with PLAYTEST=1 --workers=1');
  test.setTimeout(240_000);
  const errors = await voyageBegun(page);
  const started = Date.now();
  await page.keyboard.press('e');
  await expect.poll(async () => (await voyageOf(page)).step).toBe('helm');
  const seen = new Set<string>();
  let reached = false;
  let held: string | undefined;
  for (let i = 0; i < 1200 && !reached; i++) {
    const s = await page.evaluate(() => {
      const me = window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number; sails: string };
      const v = window.__corsair.state.get('captain.voyage') as { step: string; cay: { x: number; y: number } };
      const prompt = document.querySelector('.voyage-prompt')?.textContent ?? '';
      const wind = (document.querySelector('.voyage-ned')?.textContent ?? '').includes('Too close to the wind');
      return { me, v, prompt, wind };
    });
    if (s.prompt) seen.add(s.prompt.replace(/^[A-Z ]+(?=[A-Z][a-z])/, ''));
    // A moment (a sighting, a letter) is read and put away, as a player would.
    if (await page.locator('.moment').count()) await page.keyboard.press('Enter');
    if (s.wind) seen.add('the wind');
    if (s.v.step !== 'helm') {
      reached = true;
      break;
    }
    // A newcomer's helm: point her at the smoke (the sea's own channels round the land are the lanes' job, not his).
    const want = ((Math.atan2(s.v.cay.x - s.me.x, -(s.v.cay.y - s.me.y)) * 180) / Math.PI + 360) % 360;
    const off = ((want - s.me.headingDeg + 540) % 360) - 180;
    const key = Math.abs(off) < 8 ? undefined : off > 0 ? 'd' : 'a';
    if (key !== held) {
      if (held) await page.keyboard.up(held);
      if (key) await page.keyboard.down(key);
      held = key;
    }
    // He sets more sail when told to.
    if (s.prompt.includes('More sail')) await page.keyboard.press('w');
    await page.waitForTimeout(150);
  }
  if (held) await page.keyboard.up(held);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`PLAYTEST chapter 1: reached the cay in ${seconds}s; prompts seen: ${[...seen].join(' | ')}`);
  expect(reached).toBe(true);
  // More sail; or, pointed into the wind on the way, the wind's lesson in its place.
  // (The helm's prompt only if she left harbour off the smoke's bearing: on it, there is nothing to steer.)
  expect(seen.has("More sail: she'll go faster") || seen.has('the wind')).toBe(true);
  // Long enough to learn the helm, short enough not to bore.
  expect(seconds).toBeLessThan(150);
  await page.screenshot({ path: 'test-results/playtest-cay.png' });
  expect(errors).toEqual([]);
});

test('playtest, chapter 2 as a newcomer: Space to chase, F to attack, then side to her and Space held, on the real clock', async ({ page }) => {
  test.skip(!process.env.PLAYTEST, 'run with PLAYTEST=1 --workers=1');
  test.setTimeout(300_000);
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect.poll(async () => (await voyageOf(page)).step).toBe('helm');
  const { cay } = await voyageOf(page);
  await page.evaluate(({ x, y }) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: x + 1.5, y } as never), cay);
  await expect(hint(page, 'Salvage the wreck')).toBeVisible();
  await page.keyboard.press('e');
  await dismissDeeds(page);
  const started = Date.now();
  // Space chases her (her order); alongside, F attacks.
  await expect(hint(page, 'Chase the pirate')).toBeVisible();
  await page.keyboard.press(' ');
  await expect(hint(page, 'Attack the pirate')).toBeVisible({ timeout: 90_000 });
  const chased = Math.round((Date.now() - started) / 1000);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__corsair.battle.active())).toBe(true);
  const fought = Date.now();
  // In battle: keep her abeam and hold Space (fire as the guns bear).
  await page.keyboard.down(' ');
  let held: string | undefined;
  for (let i = 0; i < 1200; i++) {
    const b = await page.evaluate(() => {
      const s = window.__corsair.battle.state();
      return s ? { me: s.ships.player, her: s.ships.enemy, done: Boolean(window.__corsair.battle.result()), lesson: document.querySelector('.battle-lesson')?.textContent ?? '' } : undefined;
    });
    if (!b || b.done) break;
    const to = ((Math.atan2(b.her.x - b.me.x, -(b.her.y - b.me.y)) * 180) / Math.PI + 360) % 360;
    // As the lesson says: steer for her while she is out of reach, else her abeam to starboard.
    const want = b.lesson.startsWith('Steer for her') ? to : (to - 90 + 360) % 360;
    const off = ((want - b.me.headingDeg + 540) % 360) - 180;
    const key = Math.abs(off) < 10 ? undefined : off > 0 ? 'd' : 'a';
    if (key !== held) {
      if (held) await page.keyboard.up(held);
      if (key) await page.keyboard.down(key);
      held = key;
    }
    await page.waitForTimeout(150);
  }
  if (held) await page.keyboard.up(held);
  await page.keyboard.up(' ');
  const outcome = await page.evaluate(() => window.__corsair.battle.result()?.outcome);
  const seconds = Math.round((Date.now() - fought) / 1000);
  console.log(`PLAYTEST chapter 2: chased in ${chased}s, fought ${seconds}s, she ${outcome}`);
  expect(outcome).toBe('struck');
  expect(seconds).toBeLessThan(120);
  expect(errors).toEqual([]);
});

/** Put her alongside a ship, on open water (the cay's reefs refuse a ship put on them). */
async function alongside(page: Page, id: string) {
  await page.evaluate((target) => {
    const s = (window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[target]!;
    for (const [dx, dy] of [[1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]] as const) {
      if (window.__corsair.land(s.x + dx, s.y + dy)) continue;
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx, y: s.y + dy } as never);
      return;
    }
  }, id);
}

test("on the voyage, a course of her own on the chart: Space follows it (not the voyage's next order) and the chart closes", async ({ page }) => {
  const errors = await voyageBegun(page);
  await page.keyboard.press('e');
  await expect.poll(async () => (await voyageOf(page)).step).toBe('helm');
  await page.keyboard.press('m');
  await page.locator('.chart-zoom').getByRole('button', { name: 'Whole Caribbean' }).click();
  await page.locator('.chart-port', { hasText: /^Tortuga$/ }).dblclick();
  await page.keyboard.press(' ');
  await expect(page.locator('.chart')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window.__corsair.state.get('ships.player.assist') as { portId?: string } | undefined)?.portId)).toBe('town.tortuga');
  await expect(page.locator('.hud-order')).toContainText('Course to Tortuga');
  await expect(page.locator('.hud-order')).toContainText('sailing it');
  expect((await page.locator('.hud-prompt').allInnerTexts()).join(' ')).not.toContain('Sail home');
  expect(errors).toEqual([]);
});
