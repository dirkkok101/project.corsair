import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The screens and keys world.spec.ts leaves out (the e2e coverage audit): every key in the F1 help, the battle's
// keys, the plunder screen by hand, the shipwright's orders, the tavern's people, the letters, the log's pages, the
// title screen's steps and files, and the toasts. Driven through the real UI; window.__corsair confirms the effect.

/** In port: back to the harbour (Esc), then the building's hotspot (storyboard 2.1: the painting is the menu). */
async function openService(page: Page, name: string) {
  await page.keyboard.press('Escape');
  await page.locator('.port-spot', { hasText: new RegExp(`^${name}`) }).click();
}

/** Without a seed a new career opens on the difficulty pick: take the default, and read the governor's letter. */
async function setSail(page: Page, url: string) {
  if (url.includes('seed=')) return;
  // A new career: the flag (England unless changed), then the sea.
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  // Then how well she knows the sea: these tests sail as a veteran (the First Voyage has its own).
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await page.locator('.know-card', { hasText: 'I know these waters' }).click();
  await page.getByRole('button', { name: 'Set sail' }).click();
  await page.locator('.moment-opening').waitFor();
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
}

/** Start a new career. It begins docked in port; most checks set sail first (`inPort` keeps her there). */
async function boot(page: Page, url = '/', { inPort = false } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The game as tuned (navigation.json), not the playtest's defaults (main.tsx PLAYTEST).
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}pace=1&turn=1`);
  await setSail(page, url);
  await page.waitForFunction(() => Boolean(window.__corsair));
  // The loading screen has faded once the first frames are drawn.
  // Eight browsers start at once: the first frames can take longer than the usual wait.
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30_000 });
  // Freeze the clock so every check below steps the sim explicitly.
  await page.evaluate(() => window.__corsair.sim.pause());
  if (!inPort) {
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(1));
    // A frame has seen her at sea (making port again autosaves only after one has).
    await expect(page.locator('.port')).toHaveCount(0);
  }
  return errors;
}

/** Let the page draw `n` frames: the renderer and the HUD catch up with a clock the test holds. */
const frames = (page: Page, n = 2) =>
  page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

type Ship = { id: string; x: number; y: number; headingDeg: number; speed: number; sails: string; helm: number; hull?: number; crew: number; guns?: number; classId: string; fouling?: number; cargo: Record<string, number>; docked?: string; assist?: { mode: string; portId?: string; targetId?: string } };
type Captain = { gold: number; nation: string; standing: Record<string, number>; fleet?: { id: string; name: string; classId: string }[]; laidUp?: unknown[]; heard: string[] };
const player = (page: Page) => page.evaluate(() => window.__corsair.state.get('ships.player') as Ship);
const captain = (page: Page) => page.evaluate(() => window.__corsair.state.get('captain') as Captain);
const tick = (page: Page) => page.evaluate(() => window.__corsair.state.get('tick') as number);

/**
 * The career as it stands, with some of it changed (W23's way: there is no debug command for gold or a fleet),
 * saved and continued from the title screen. Changes go into the captain and her ship; the clock is held again.
 */
async function continueWith(page: Page, patch: { captain?: Record<string, unknown>; player?: Record<string, unknown> }) {
  await page.evaluate(
    (p) =>
      new Promise<void>((resolve, reject) => {
        const save = window.__corsair.snapshot.save();
        const ships = save.state.ships;
        save.state = { ...save.state, captain: { ...save.state.captain!, ...p.captain }, ships: { ...ships, player: { ...ships.player!, ...p.player } } };
        const req = indexedDB.open('corsair', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('saves');
        req.onsuccess = () => {
          const tx = req.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(save, 'career');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    patch,
  );
  await page.goto('/?pace=1&turn=1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  // Eight browsers start at once: the first frames can take longer than the usual wait.
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(() => window.__corsair.sim.pause());
}

/** A ship of `role` out of Port Royal, the player put alongside her once she is clear of the port: her id. */
const alongside = (page: Page, role: 'merchant' | 'pirate', steps = 90) =>
  page.evaluate(
    ({ role, steps }) => {
      window.__corsair.cmd.send({ type: 'SpawnShip', role, from: 'town.port_royal', to: 'town.cartagena' });
      window.__corsair.sim.step(1);
      const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: { role: string } }>;
      const id = Object.keys(ships).filter((k) => ships[k]!.ai?.role === role).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
      window.__corsair.sim.step(steps);
      const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
      for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
        window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx!, y: s.y + dy! });
        window.__corsair.sim.step(1);
        const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
        if (Math.hypot(p.x - s.x, p.y - s.y) < 3) break;
      }
      return id;
    },
    { role, steps },
  );

/** Alongside a merchant out of Port Royal, hail her (Space) and open fire (F): the battle view. */
async function attackMerchant(page: Page) {
  const id = await alongside(page, 'merchant');
  await page.keyboard.press(' ');
  await expect(page.locator('.hail')).toBeVisible();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  return id;
}

/** A pirate out at sea, the player put beside her: she falls on her (W30's way), into the battle view. */
async function pirateFallsOn(page: Page) {
  await alongside(page, 'pirate', 1500);
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__corsair.sim.step(1));
      return page.evaluate(() => window.__corsair.view());
    })
    .toBe('battle');
}

const battle = (page: Page) => page.evaluate(() => window.__corsair.battle.state()!);
const battleStep = (page: Page, n = 1) => page.evaluate((k) => window.__corsair.battle.step(k), n);

test('F1 at sea: the help lists every key group as it really works, holds the world while it is read, and F1 and Esc close it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const help = page.locator('.hud-help');
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await expect(help.locator('.hud-help-group .k-who')).toHaveText(['Sailing', 'At sea', 'Controller', 'Battle', 'The captain']);
  // The arrows are the helm and the sails too; E goes into a port in reach at sea; Esc never leaves port.
  const row = (k: string) => help.locator('.hud-help-row', { has: page.locator('.k-key', { hasText: new RegExp(`^${k}$`) }) });
  await expect(row('A D ← →')).toContainText('steer');
  await expect(row('W S ↑ ↓')).toContainText('more or less sail');
  await expect(row('E')).toContainText('enter the port in reach');
  await expect(row('C')).toContainText('in battle too');
  await expect(row('M')).toContainText('Enter sets the course');
  await expect(help).toContainText('leave the wreck');
  await expect(help).toContainText('close a letter or a moment');
  await expect(help).not.toContainText('leave port');
  // The world waits while the help is read (as it does in port, a hail, the chart, the log or a moment)...
  const before = await tick(page);
  await page.evaluate(() => window.__corsair.sim.resume());
  await frames(page, 20);
  expect(await tick(page)).toBe(before);
  await page.screenshot({ path: 'test-results/help-sea.png' });
  // ...and Esc closes it, and only it: she is still at sea, and the world runs on again.
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect.poll(() => tick(page)).toBeGreaterThan(before);
  await page.evaluate(() => window.__corsair.sim.pause());
  // Over the chart, Esc closes the help and leaves the chart open.
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeVisible();
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(page.locator('.chart')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeHidden();
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await page.keyboard.press('F1');
  await expect(help).toHaveCount(0);
  // Its own button too.
  await page.keyboard.press('F1');
  await help.getByRole('button', { name: 'Close · F1' }).click();
  await expect(help).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('F1 in battle: the same help over the fight, which holds while it is read; F1 and Esc close it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await attackMerchant(page);
  const help = page.locator('.battle .hud-help');
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await expect(help.locator('.hud-help-group .k-who')).toHaveText(['Sailing', 'At sea', 'Controller', 'Battle', 'The captain']);
  await expect(help.locator('.hud-help-group', { has: page.locator('.k-who', { hasText: /^Battle$/ }) })).toContainText('fire port or starboard');
  // The fight holds while the help is read (a broadside doesn't wait for a reader otherwise)...
  const before = (await battle(page)).tick;
  await page.evaluate(() => window.__corsair.sim.resume());
  await frames(page, 20);
  expect((await battle(page)).tick).toBe(before);
  await page.screenshot({ path: 'test-results/help-battle.png' });
  // ...and runs on once it is closed.
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect.poll(async () => (await battle(page)).tick).toBeGreaterThan(before);
  await page.evaluate(() => window.__corsair.sim.pause());
  expect(await page.evaluate(() => window.__corsair.view())).toBe('battle');
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await page.keyboard.press('F1');
  await expect(help).toHaveCount(0);
  // M does not open the chart over a fight (it would run on beneath it).
  await page.keyboard.press('m');
  await frames(page);
  await expect(page.locator('.chart')).toBeHidden();
  expect(errors).toEqual([]);
});

test('battle keys: 1 to 3 load the shot, S and W and the sails button set the sails, G closes to board, Q and E fire a side', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await pirateFallsOn(page);
  const shot = async (key: string) => {
    await page.keyboard.press(key);
    await battleStep(page);
    return (await battle(page)).ships.player.ammo;
  };
  expect(await shot('2')).toBe('chain');
  await expect(page.locator('.battle-ammo .active')).toContainText('Chain');
  expect(await shot('3')).toBe('grape');
  expect(await shot('1')).toBe('round');
  // The sails: S takes some in, W sets more; the gun bar's button says which, and changes them.
  const sails = async (key: string) => {
    await page.keyboard.press(key);
    await battleStep(page);
    return (await battle(page)).ships.player.sails;
  };
  expect(await sails('s')).toBe('half');
  await expect(page.locator('.battle-sails')).toHaveText('Half sail');
  // Hove to, the button says so.
  expect(await sails('s')).toBe('furled');
  await expect(page.locator('.battle-sails')).toHaveText('Furled');
  expect(await sails('w')).toBe('half');
  expect(await sails('w')).toBe('full');
  await expect(page.locator('.battle-sails')).toHaveText('Full sail');
  await page.locator('.battle-sails').click();
  await battleStep(page);
  expect((await battle(page)).ships.player.sails).toBe('half');
  await page.locator('.battle-sails').click();
  await battleStep(page);
  expect((await battle(page)).ships.player.sails).toBe('full');
  // G: close to board, and G again to stop.
  await page.keyboard.press('g');
  await battleStep(page);
  expect((await battle(page)).boarding).toBe(true);
  await page.keyboard.press('g');
  await battleStep(page);
  expect((await battle(page)).boarding).toBe(false);
  // Closing to gun range (the cautious autopilot at the helm, out of range so it fires nothing), then holding on
  // until a broadside bears (the gun bar says Ready).
  const ready = (label: string) => page.locator('.battle-gun', { hasText: label }).locator('b.ready').count();
  let bears: 'port' | 'starboard' | undefined;
  for (let i = 0; i < 600 && !bears && !(await page.evaluate(() => window.__corsair.battle.result())); i++) {
    await page.evaluate(() => {
      const s = window.__corsair.battle.state()!.ships;
      window.__corsair.battle.step(2, Math.hypot(s.enemy.x - s.player.x, s.enemy.y - s.player.y) > 7 ? 'cautious' : undefined);
    });
    await frames(page, 1);
    const [p, sb] = [await ready('Port'), await ready('Starboard')];
    if (p !== sb) bears = p ? 'port' : 'starboard';
  }
  expect(bears).toBeDefined();
  const key = { port: 'q', starboard: 'e' } as const;
  const other = bears === 'port' ? 'starboard' : 'port';
  const fromPlayer = async () => (await battle(page)).shots.filter((s) => s.from === 'player').length;
  // The side that doesn't bear fires nothing; the one that does fires, and starts reloading.
  const shots = await fromPlayer();
  await page.keyboard.press(key[other]);
  await battleStep(page);
  expect(await fromPlayer()).toBe(shots);
  await page.keyboard.press(key[bears!]);
  await battleStep(page);
  expect(await fromPlayer()).toBeGreaterThan(shots);
  expect((await battle(page)).ships.player.reload[bears!]).toBeGreaterThan(0);
  expect((await battle(page)).ships.player.reload[other]).toBe(0);
  expect(errors).toEqual([]);
});

test('a wreck: sunk, she leaves barrels and men in the water; Enter leaves the wreck, the report says so, and where to mend her', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A pirate out at sea, and an earlier brush with her (settled straight through the sim) that left her barely
  // afloat and the player's hull hurt.
  const id = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'pirate', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: { role: string } }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai?.role === 'pirate').sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(1500);
    // None of the player's men lost (more than she has); her crew and guns as they were.
    window.__corsair.cmd.send({
      type: 'BattleEnded',
      shipId: 'player',
      targetId: id,
      result: { outcome: 'escaped', player: { hull: 30, sailCondition: 100, crew: 1000, guns: 10 }, enemy: { hull: 6, sailCondition: 100 } },
    } as never);
    window.__corsair.sim.step(1);
    const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + 1.5, y: s.y });
    window.__corsair.sim.step(1);
    return id;
  });
  expect((await player(page)).hull).toBe(30);
  // Alongside, she falls on her all the same.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__corsair.sim.step(1));
      return page.evaluate(() => window.__corsair.view());
    })
    .toBe('battle');
  // Fought at a distance (the cautious autopilot), a broadside home sends her down.
  await page.evaluate(() => {
    for (let i = 0; i < 30 * 600 && !window.__corsair.battle.state()!.wreck && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(1, 'cautious');
  });
  expect((await battle(page)).wreck).toBeDefined();
  await frames(page);
  await expect(page.locator('.battle-wreck')).toContainText('Enter to leave the wreck');
  await page.screenshot({ path: 'test-results/wreck.png' });
  await page.keyboard.press('Enter');
  await battleStep(page);
  expect(await page.evaluate(() => window.__corsair.battle.result()?.outcome)).toBe('sunk');
  await expect(page.locator('.battle-report-title')).toHaveText('She went down!');
  // Hurt (hull under 60%): the report says where the nearest shipwright is.
  await expect(page.locator('.battle-advice')).toContainText('The nearest shipwright is at');
  await page.screenshot({ path: 'test-results/wreck-report.png' });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'BattleOver' }).at(-1)?.payload.outcome)).toBe('sunk');
  expect(await page.evaluate((i) => (window.__corsair.state.get('ships') as Record<string, unknown>)[i], id)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('plunder by hand: choose the goods, throw some of your own over the side, put her men ashore, and sink her', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A laden merchant already under way (one fresh out of port carries nothing but her purse).
  const id = await page.evaluate(() => {
    type S = { x: number; y: number; cargo: Record<string, number>; ai?: { role: string; nation: string; route: unknown[]; waitUntil?: number } };
    // A day on: the merchants are out of port and on their way with their cargoes.
    window.__corsair.sim.step(771);
    const ships = window.__corsair.state.get('ships') as Record<string, S>;
    const me = ships.player!;
    const [id, her] = Object.entries(ships)
      .filter(([, s]) => s.ai?.role === 'merchant' && s.ai.nation === 'england' && s.ai.route.length && s.ai.waitUntil == null && Object.values(s.cargo).some((n) => n > 0))
      .sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]!;
    for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: her.x + dx!, y: her.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      const now = (window.__corsair.state.get('ships') as Record<string, S>)[id]!;
      if (Math.hypot(p.x - now.x, p.y - now.y) < 3) break;
    }
    return id;
  });
  await page.keyboard.press(' ');
  await expect(page.locator('.hail')).toBeVisible();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  // A merchant beaten strikes or is carried: taken, not sunk.
  expect(outcome).toMatch(/^(boarded|struck)$/);
  await expect(page.locator('.plunder')).toBeVisible();
  const before = await player(page);
  // Sink her (kept, all her hold comes too, and there is nothing to choose).
  await page.locator('.fate-sink').click();
  await page.locator('.plunder-toggle').click();
  await expect(page.locator('.plunder-toggle')).toHaveText('Take the best for me');
  const hand = page.locator('.plunder-hand');
  await expect(hand).toBeVisible();
  // Her first good: one step less than the best choice.
  const n = async (row: ReturnType<typeof hand.locator>) => Number((await row.locator('.plunder-n').innerText()).match(/\d+/)![0]);
  const first = hand.locator('.plunder-take').first();
  const best = await n(first);
  await first.getByRole('button', { name: '−' }).click();
  expect(await n(first)).toBeLessThan(best);
  // Some of her own food over the side.
  const throwRow = hand.locator('.plunder-throw', { hasText: 'Food' });
  await throwRow.getByRole('button', { name: '+' }).click();
  const thrown = await n(throwRow);
  expect(thrown).toBeGreaterThan(0);
  // What the screen says she takes of each good (goods are named as their ids, capitalised).
  const taking: Record<string, number> = {};
  for (const row of await hand.locator('.plunder-take').all()) taking[(await row.locator('td').first().innerText()).trim().toLowerCase()] = await n(row);
  // Her men put ashore, not signed on.
  const sign = page.getByRole('checkbox', { name: 'Sign on her men' });
  await expect(sign).toBeChecked();
  await sign.uncheck();
  await expect(page.locator('.plunder-sign')).toContainText('they are put ashore');
  // Sunk: the card says what it costs, and the big button says what it does.
  await expect(page.locator('.fate-sink')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.plunder-fate-note')).toContainText('thinks worse of you');
  await expect(page.locator('.plunder-go')).toContainText(/sink her · Enter/i);
  await page.screenshot({ path: 'test-results/plunder-by-hand.png' });
  const england = (await captain(page)).standing.england!;
  await page.locator('.plunder-go').click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  const after = await player(page);
  // Her hold as chosen by hand, and the food over the side.
  for (const [g, k] of Object.entries(taking)) if (g !== 'food') expect((after.cargo[g] ?? 0) - (before.cargo[g] ?? 0)).toBe(k);
  expect(after.cargo.food ?? 0).toBe((before.cargo.food ?? 0) - thrown + (taking.food ?? 0));
  // Her men put ashore: the crew is as it was.
  expect(after.crew).toBe(before.crew);
  expect(await page.evaluate((i) => (window.__corsair.state.get('ships') as Record<string, unknown>)[i], id)).toBeUndefined();
  // Sunk, not let go: England thinks worse of her.
  expect((await captain(page)).standing.england).toBeLessThan(england);
  expect(await page.evaluate(() => window.__corsair.state.get('prize'))).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a hail: buy food from her stores, and Sail on parts company', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await alongside(page, 'merchant');
  // Sail ho! calls her out as "An English", not "A English".
  await expect(page.locator('.hud-banner')).toContainText('An English fluyt');
  await page.keyboard.press(' ');
  const hail = page.locator('.hail');
  await expect(hail).toBeVisible();
  const before = await player(page);
  const gold = (await captain(page)).gold;
  const buy = hail.locator('.hail-food').getByRole('button', { name: /^Buy \d+ food/ });
  const [units, price] = (await buy.innerText()).match(/\d+/g)!.map(Number);
  expect(units).toBeGreaterThan(0);
  await buy.click();
  expect((await player(page)).cargo.food).toBe((before.cargo.food ?? 0) + units!);
  expect((await captain(page)).gold).toBe(gold - price!);
  // What she can spare is less now.
  await expect(hail.locator('.hail-food')).toContainText(units! >= 30 ? 'no more food to spare' : `up to ${30 - units!}`);
  // M does not open the chart over a hail.
  await page.keyboard.press('m');
  await frames(page);
  await expect(page.locator('.chart')).toBeHidden();
  await hail.getByRole('button', { name: /^Sail on/ }).click();
  await expect(hail).toHaveCount(0);
  // The world runs again once she sails on.
  const t = await tick(page);
  await page.evaluate(() => window.__corsair.sim.resume());
  await expect.poll(() => tick(page)).toBeGreaterThan(t);
  await page.evaluate(() => window.__corsair.sim.pause());
  expect(errors).toEqual([]);
});

test("a famous pirate's demand: he calls on her to strike, Fight on puts it aside, and Y strikes her colours", async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A famous pirate under way (W22's way: days pass by Port Royal until one is at sea), the player put beside her.
  const famous = await page.evaluate(() => {
    type S = { id: string; x: number; y: number; ai?: { famous?: string; waitUntil?: number; route: unknown[] } };
    const atSea = () => Object.values(window.__corsair.state.get('ships') as Record<string, S>).find((s) => s.ai?.famous && !(s.ai.waitUntil != null && !s.ai.route.length));
    for (let d = 0; d < 30 && !atSea(); d++) {
      const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
      window.__corsair.sim.step(771);
    }
    const her = atSea()!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: her.x + 1.5, y: her.y });
    window.__corsair.sim.step(1);
    return her.ai!.famous!;
  });
  // Her moment first (seen the first time), then hail her and open fire.
  await expect(page.locator('.moment')).toContainText('A famous pirate');
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect(page.locator('.hail')).toBeVisible();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  // She closes; within reach, her veterans outmatch the player's boarders and he calls on her to strike.
  const called = await page.evaluate(async () => {
    for (let i = 0; i < 900 && !window.__corsair.battle.result(); i++) {
      window.__corsair.battle.step(3);
      await new Promise((r) => requestAnimationFrame(r));
      if (document.querySelector('.battle-demand')) return true;
    }
    return false;
  });
  expect(called).toBe(true);
  const demand = page.locator('.battle-demand');
  await expect(demand.locator('.battle-demand-title')).toContainText('calls on you to strike!');
  await expect(demand).toContainText('If you strike');
  await expect(demand).toContainText('If you fight on');
  await page.screenshot({ path: 'test-results/famous-demand.png' });
  // Fight on: the demand goes, the fight goes on.
  await demand.getByRole('button', { name: 'Fight on' }).click();
  await expect(demand).toHaveCount(0);
  expect(await page.evaluate(() => window.__corsair.battle.result())).toBeUndefined();
  // His call still stands: Y strikes her colours. She keeps her ship and her men.
  await page.keyboard.press('y');
  await battleStep(page);
  expect(await page.evaluate(() => window.__corsair.battle.result()?.outcome)).toBe('yielded');
  await expect(page.locator('.battle-report-title')).toHaveText('You struck');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  const over = await page.evaluate(() => window.__corsair.log.query({ type: 'BattleOver' }).at(-1)!);
  expect(over.payload.outcome).toBe('yielded');
  // Her own ship still, and not a man lost.
  expect((await player(page)).classId).toBe('ship.brig');
  expect(over.payload.menLost).toBe(0);
  expect(famous).toBeTruthy();
  expect(errors).toEqual([]);
});

test('the shipwright: mend a hurt ship, careen a foul one, sell a gun, take back a laid-up ship, buy one, and shift the flag', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // A career further on: a fat purse, her hull holed and her bottom foul, a prize in company, and a ship of hers
  // retaken from pirates lying here.
  await continueWith(page, {
    captain: {
      gold: 50000,
      fleet: [{ id: 'fleet.0.ship.fluyt', name: 'Hope', classId: 'ship.fluyt', hull: 20, sailCondition: 60 }],
      laidUp: [{ id: 'fleet.1.ship.sloop', name: 'Kestrel', classId: 'ship.sloop', hull: 30, sailCondition: 80, settlementId: 'town.port_royal', fee: 200 }],
    },
    player: { hull: 40, fouling: 0.05 },
  });
  await openService(page, 'Shipwright');
  const yard = page.locator('.shipwright');
  // Her gold less what goals done paid (the patched purse puts her in the Top Ten on her first deed here).
  const gold = async () => {
    const c = (await captain(page)) as { gold: number; honours?: { kind: string; gold?: number }[] };
    return c.gold - (c.honours ?? []).filter((h) => h.kind === 'goal').reduce((n, h) => n + (h.gold ?? 0), 0);
  };
  // Mending: the whole fleet, for what the button says.
  await expect(yard.locator('.yard-row').first()).toContainText('hull 40 of 85');
  const mend = yard.locator('.yard-rows').getByRole('button', { name: /^Mend · / });
  const cost = Number((await mend.innerText()).replace(/[^\d]/g, ''));
  let purse = await gold();
  await mend.click();
  expect((await player(page)).hull).toBe(85);
  expect(await gold()).toBe(purse - cost);
  await expect(yard.locator('.yard-row').first()).toContainText('sound');
  // Careening: her bottom clean, for its price.
  const careen = yard.getByRole('button', { name: /^Careen · / });
  const careenCost = Number((await careen.innerText()).replace(/[^\d]/g, ''));
  purse = await gold();
  await careen.click();
  expect((await player(page)).fouling).toBe(0);
  expect(await gold()).toBe(purse - careenCost);
  await expect(yard).toContainText('her bottom is clean');
  // Fitting out: a gun sold off her deck.
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Fit out' }).click();
  purse = await gold();
  await yard.getByRole('button', { name: /^Sell 1 · / }).click();
  expect((await player(page)).guns).toBe(9);
  expect(await gold()).toBe(purse + 75);
  await expect(yard).toContainText('Guns 9 of 18');
  // Your ships: the laid-up sloop taken back, her salvage paid.
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Your ships' }).click();
  purse = await gold();
  await yard.locator('.laid-up').getByRole('button', { name: /^Take her back · 200 gold salvage/ }).click();
  expect(((await captain(page)).fleet ?? []).map((f) => f.name)).toEqual(['Hope', 'Kestrel']);
  expect((await captain(page)).laidUp ?? []).toEqual([]);
  expect(await gold()).toBe(purse - 200);
  // Ships for sale: a war sloop bought into the fleet.
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Ships for sale' }).click();
  purse = await gold();
  await yard.locator('.ship-card', { hasText: 'war sloop' }).getByRole('button').click();
  const fleet = (await captain(page)).fleet ?? [];
  expect(fleet).toHaveLength(3);
  expect(fleet.at(-1)!.classId).toBe('ship.war_sloop');
  expect(await gold()).toBe(purse - 4500);
  // The flag shifts to the fluyt; the brig sails in company.
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Your ships' }).click();
  await yard.locator('.yard-ship', { hasText: 'Hope' }).getByRole('button', { name: 'Make flagship' }).click();
  expect((await player(page)).classId).toBe('ship.fluyt');
  expect(((await captain(page)).fleet ?? []).map((f) => f.classId)).toContain('ship.brig');
  await expect(yard.locator('.yard-ship.flagship')).toContainText('fluyt');
  await page.screenshot({ path: 'test-results/shipwright-orders.png' });
  expect(errors).toEqual([]);
});

test('at sea: W and S and the arrows set the sails and the helm, = and − the cruise speed, C the camera, and the minimap shows', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const sails = async (key: string) => {
    await page.keyboard.press(key);
    await page.evaluate(() => window.__corsair.sim.step(1));
    return (await player(page)).sails;
  };
  expect((await player(page)).sails).toBe('full');
  expect(await sails('s')).toBe('half');
  expect(await sails('ArrowDown')).toBe('furled');
  expect(await sails('ArrowUp')).toBe('half');
  expect(await sails('w')).toBe('full');
  const helm = async (key: string) => {
    await page.keyboard.down(key);
    await page.evaluate(() => window.__corsair.sim.step(1));
    const held = (await player(page)).helm;
    await page.keyboard.up(key);
    await page.evaluate(() => window.__corsair.sim.step(1));
    return [held, (await player(page)).helm];
  };
  expect(await helm('ArrowRight')).toEqual([1, 0]);
  expect(await helm('ArrowLeft')).toEqual([-1, 0]);
  expect(await helm('d')).toEqual([1, 0]);
  expect(await helm('a')).toEqual([-1, 0]);
  // Cruise speed: 1x to 4x, said on its button.
  const cruise = page.getByRole('button', { name: 'Cruise speed' });
  await expect(cruise).toHaveText('2×');
  await page.keyboard.press('=');
  await expect(cruise).toHaveText('4×');
  await page.keyboard.press('=');
  await expect(cruise).toHaveText('4×');
  await page.keyboard.press('-');
  await expect(cruise).toHaveText('2×');
  await page.keyboard.press('-');
  await expect(cruise).toHaveText('1×');
  await page.keyboard.press('-');
  await expect(cruise).toHaveText('1×');
  await cruise.click();
  await expect(cruise).toHaveText('2×');
  // The minimap: a window on the chart in the corner.
  const minimap = page.locator('canvas.minimap');
  await expect(minimap).toBeVisible();
  expect((await minimap.boundingBox())!.width).toBeGreaterThan(50);
  // C: from astern, the view turns with her heading; C again, north up overhead.
  const viewDeg = () => page.evaluate(() => (window as unknown as { __corsair3d: { viewDeg: () => number } }).__corsair3d.viewDeg());
  expect(await viewDeg()).toBe(0);
  const heading = (await player(page)).headingDeg;
  expect(heading % 360).not.toBe(0);
  await page.keyboard.press('c');
  await expect.poll(viewDeg).not.toBe(0);
  await page.keyboard.press('c');
  await expect.poll(viewDeg).toBe(0);
  expect(errors).toEqual([]);
});

test('the wind keys are a tuning aid: dead in play, live with ?debug=1', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const winds = () => page.evaluate(() => window.__corsair.log.query({ type: 'WindChanged' }).length);
  const before = await winds();
  for (const key of [']', '[', '3', '5']) await page.keyboard.press(key);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await winds()).toBe(before);
  const again = await boot(page, '/?seed=3&debug=1');
  const start = await winds();
  await page.keyboard.press(']');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('5');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await winds()).toBe(start + 2);
  expect((await page.evaluate(() => window.__corsair.log.query({ type: 'WindChanged' }).at(-1)!)).payload.strength).toBe('gale');
  expect([...errors, ...again]).toEqual([]);
});

test('K careens her on a beach: days pass and her bottom is clean; out of reach of a shore it says so', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Days at sea, hove to, foul her bottom.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'furled' });
    window.__corsair.sim.step(771 * 5);
  });
  expect((await player(page)).fouling).toBeGreaterThan(0.01);
  // Open water, far from any shore: no beach.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('w');
  await page.keyboard.press('w');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).sails).toBe('full');
  let t = await tick(page);
  await page.keyboard.press('k');
  await expect(page.locator('.hud-toast', { hasText: 'No beach' })).toContainText('close the shore first');
  expect(await tick(page)).toBe(t);
  expect((await player(page)).fouling).toBeGreaterThan(0.01);
  // Refused, she keeps her sails set.
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).sails).toBe('full');
  // Close in by Port Royal's coast: open water a tile or so off the land.
  await page.evaluate(() => {
    const me = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    const shore = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (window.__corsair.land(x + dx, y + dy)) return true;
      return false;
    };
    for (let r = 3; r < 40; r++)
      for (let a = 0; a < 360; a += 10) {
        const [x, y] = [Math.round(me.x + r * Math.cos((a * Math.PI) / 180)) + 0.5, Math.round(me.y + r * Math.sin((a * Math.PI) / 180)) + 0.5];
        if (!window.__corsair.land(x, y) && shore(x, y)) {
          window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x, y });
          window.__corsair.sim.step(1);
          return;
        }
      }
  });
  t = await tick(page);
  await page.keyboard.press('k');
  await expect(page.locator('.hud-toast', { hasText: 'Careened on a beach' })).toContainText('her bottom is clean');
  expect(await tick(page)).toBe(t + Math.round(771 * 3));
  expect((await player(page)).sails).toBe('furled');
  // Clean: out of the water while hove down, her bottom gathers nothing on the beach.
  expect((await player(page)).fouling).toBe(0);
  expect(errors).toEqual([]);
});

test('the tavern: the sailors sign on for a bounty each, and the barmaid tells what she has heard', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Tavern');
  await page.locator('.tavern-person', { hasText: 'Sailors' }).click();
  const signOn = page.locator('.recruit').getByRole('button', { name: /^Sign on \d+ · \d+ gold/ });
  const [men, price] = (await signOn.innerText()).match(/\d+/g)!.map(Number);
  expect(men).toBeGreaterThan(0);
  const crew = Number((await page.locator('.recruit .tavern-sub-head b').innerText()).trim());
  const gold = (await captain(page)).gold;
  await signOn.click();
  expect((await player(page)).crew).toBe(crew + men!);
  expect((await captain(page)).gold).toBe(gold - price!);
  await expect(page.locator('.recruit .tavern-sub-head b')).toHaveText(String(crew + men!));
  await page.locator('.tavern-person', { hasText: 'Barmaid' }).click();
  await expect(page.locator('.tavern-person.active')).toContainText('Barmaid');
  await expect(page.locator('.tavern-card')).toContainText('The barmaid');
  await expect(page.locator('.tavern-card .k-say').first()).not.toHaveText('');
  expect(errors).toEqual([]);
});

test("letters: war's letter takes her to the governor, and peace comes as a letter of its own", async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const makePort = async () => {
    await page.evaluate(() => {
      const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
      window.__corsair.sim.step(1);
    });
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(1));
  };
  await page.evaluate(() => window.__corsair.cmd.send({ type: 'SetRelation', a: 'england', b: 'france', war: true }));
  await makePort();
  const letter = page.locator('.moment-letter');
  await expect(letter.locator('.moment-headline')).toHaveText('War!');
  await letter.getByRole('button', { name: 'To the governor' }).click();
  await expect(page.locator('.moment')).toHaveCount(0);
  await expect(page.locator('.governor')).toBeVisible();
  expect((await captain(page)).heard).toHaveLength(1);
  // Out again; peace is made while she is at sea, and she hears it as a letter when she makes port.
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.port')).toHaveCount(0);
  await page.evaluate(() => window.__corsair.cmd.send({ type: 'SetRelation', a: 'england', b: 'france', war: false }));
  await makePort();
  await expect(letter.locator('.moment-headline')).toHaveText('Peace');
  await expect(letter.locator('.moment-who')).toContainText('England and France');
  // No governor to see about a peace: Enter puts it in the log.
  await expect(letter.getByRole('button', { name: 'To the governor' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  expect((await captain(page)).heard).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("the log's pages: the career's score, paging back through the log, and a place in it plots a course there", async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // Twenty lines in the log (two spreads of eight a page), the oldest about Cartagena.
  await continueWith(page, {
    captain: {
      logbook: Array.from({ length: 20 }, (_, i) => ({ tick: i, kind: 'deed', text: `Deed number ${i + 1}`, ...(i === 0 ? { place: 'town.cartagena' } : {}) })),
    },
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('l');
  const log = page.locator('.log');
  await expect(log).toBeVisible();
  await log.locator('.log-tabs').getByRole('button', { name: 'Career' }).click();
  await expect(log.locator('.career-score')).toContainText('Trade fame');
  await expect(log.locator('.book-title')).toHaveText('Your career');
  await log.locator('.log-tabs').getByRole('button', { name: 'Log' }).click();
  // Newest first: a spread of sixteen lines, then the rest.
  await expect(log.locator('.logbook-line').first()).toContainText('Deed number 20');
  await expect(log.locator('.book-turn')).toContainText('1 of 2');
  await expect(log.getByRole('button', { name: 'Newer' })).toBeDisabled();
  await log.getByRole('button', { name: 'Older' }).click();
  await expect(log.locator('.book-turn')).toContainText('2 of 2');
  await expect(log.getByRole('button', { name: 'Older' })).toBeDisabled();
  await expect(log.locator('.logbook-line').last()).toContainText('Deed number 1');
  await log.getByRole('button', { name: 'Newer' }).click();
  await expect(log.locator('.book-turn')).toContainText('1 of 2');
  await log.getByRole('button', { name: 'Older' }).click();
  // The place by a line plots a course there, and the book closes.
  await log.locator('.logbook-place', { hasText: 'Cartagena' }).click();
  await expect(log).toHaveCount(0);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).assist).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  expect(errors).toEqual([]);
});

test('the chart: a double click on a port sets course there, Enter on a port picked does too, and + and − zoom', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Open water, out of Port Royal's reach (in reach, Space would take her in).
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeVisible();
  const sheet = page.locator('.chart-sheet');
  const width = async () => (await sheet.boundingBox())!.width;
  const zoom = page.locator('.chart-zoom');
  const w0 = await width();
  await zoom.getByRole('button', { name: '+' }).click();
  await frames(page);
  const w1 = await width();
  expect(w1).toBeGreaterThan(w0);
  await zoom.getByRole('button', { name: '−' }).click();
  await frames(page);
  expect(await width()).toBeLessThan(w1);
  await zoom.getByRole('button', { name: 'Whole Caribbean' }).click();
  // A double click: the port is the destination, ringed on the chart, and its card shows.
  await page.locator('.chart-port', { hasText: /^Cartagena$/ }).dblclick();
  await expect(page.locator('.chart-port.selected')).toHaveText('Cartagena');
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeHidden();
  await expect(page.locator('.hud-prompt')).toContainText('Follow the course to Cartagena');
  // A click picks another port (its card); Enter sets course to it.
  await page.keyboard.press('m');
  await zoom.getByRole('button', { name: 'Whole Caribbean' }).click();
  await page.locator('.chart-port', { hasText: /^Havana$/ }).click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.chart-port.selected')).toHaveText('Havana');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.chart')).toBeHidden();
  await expect(page.locator('.hud-prompt')).toContainText('Follow the course to Havana');
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).assist).toMatchObject({ mode: 'course', portId: 'town.havana' });
  expect(errors).toEqual([]);
});

test("the chart's Follow course: the course set, its card's button (or Space) sails it and closes the chart", async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.keyboard.press('m');
  await page.locator('.chart-zoom').getByRole('button', { name: 'Whole Caribbean' }).click();
  await page.locator('.chart-port', { hasText: /^Havana$/ }).click();
  await page.keyboard.press('Enter');
  const follow = page.locator('.chart-card-follow');
  await expect(follow).toHaveText(/Follow course/);
  await page.screenshot({ path: 'test-results/chart-follow.png' });
  await follow.click();
  await expect(page.locator('.chart')).toBeHidden();
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).assist).toMatchObject({ mode: 'course', portId: 'town.havana' });
  // Space on the chart does the same.
  await page.evaluate(() => window.__corsair.cmd.send({ type: 'SetAssist', shipId: 'player', assist: 'off' } as never));
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await page.locator('.chart-zoom').getByRole('button', { name: 'Whole Caribbean' }).click();
  await page.locator('.chart-port', { hasText: /^Cartagena$/ }).dblclick();
  await page.keyboard.press(' ');
  await expect(page.locator('.chart')).toBeHidden();
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).assist).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  expect(errors).toEqual([]);
});

test('the map moment: a piece of a treasure map plots a course to the ring', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Tavern');
  // The stranger sits in the corner some weeks (W18's way: wait them out in port).
  const stranger = page.locator('.tavern-person', { hasText: 'Stranger' });
  for (let w = 0; w < 16 && !(await stranger.count()); w++) {
    await page.evaluate(() => window.__corsair.sim.step(7 * 771));
    await frames(page);
  }
  await stranger.click();
  await page.locator('.stranger').getByRole('button', { name: /^Buy the piece/ }).click();
  const moment = page.locator('.moment-map');
  await expect(moment).toContainText('press Space to dig');
  await moment.getByRole('button', { name: 'Plot a course to the ring' }).click();
  await expect(page.locator('.moment')).toHaveCount(0);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect((await player(page)).assist?.mode).toBe('course');
  expect(errors).toEqual([]);
});

/** Keep the career (Ctrl+S) and go back to the title screen, where a stored career offers Continue. */
async function toTitle(page: Page) {
  await page.keyboard.press('Control+s');
  await expect(page.locator('.hud-saved')).toBeVisible();
  await page.goto('/?pace=1&turn=1');
  await expect(page.getByRole('button', { name: /^Continue/ })).toBeVisible();
}

test("the title screen: Back from each step of a new career, and another flag makes her that nation's captain", async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await toTitle(page);
  await page.getByRole('button', { name: 'New career' }).click();
  await expect(page.locator('.start-h2')).toHaveText('Under whose flag?');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /^Continue/ })).toBeVisible();
  await page.getByRole('button', { name: 'New career' }).click();
  const france = page.locator('.flag-card', { hasText: 'France' });
  await france.click();
  await expect(france).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  await expect(page.locator('.start-h2')).toHaveText('How hard a sea?');
  const chip = page.locator('.flag-chip');
  await expect(chip).toContainText("Under France's flag");
  const home = (await chip.textContent())!.split('·')[1]!.trim();
  // Back keeps the flag picked.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.start-h2')).toHaveText('Under whose flag?');
  await expect(france).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  // Then how well she knows the sea: these tests sail as a veteran (the First Voyage has its own).
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await page.locator('.know-card', { hasText: 'I know these waters' }).click();
  await page.getByRole('button', { name: 'Set sail' }).click();
  await page.locator('.moment-opening').waitFor();
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  await page.waitForFunction(() => Boolean(window.__corsair));
  expect((await captain(page)).nation).toBe('france');
  await expect(page.locator('.port-name')).toContainText(home);
  expect(errors).toEqual([]);
});

test('the title screen: Load from file brings back a career saved to a file', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // The career as a file, with a purse no new career has.
  const file = await page.evaluate(() => {
    const save = window.__corsair.snapshot.save();
    save.state = { ...save.state, captain: { ...save.state.captain!, gold: 4242 } };
    return JSON.stringify(save);
  });
  await toTitle(page);
  await expect(page.locator('.start-continue')).toContainText('1,000 gold');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load from file' }).click();
  await (await chooser).setFiles({ name: 'corsair.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(page.locator('.start-continue')).toContainText('4,242 gold');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  // Eight browsers start at once: the first frames can take longer than the usual wait.
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 30_000 });
  expect((await captain(page)).gold).toBe(4242);
  // A file that is no save says why, and keeps the career it had.
  await toTitle(page);
  const bad = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load from file' }).click();
  await (await bad).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator('.start-menu .start-warn')).not.toHaveText('');
  await expect(page.locator('.start-continue')).toContainText('4,242 gold');
  expect(errors).toEqual([]);
});

test('toasts: the food gone, and men starving, say how to get more', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // A career with nothing in the hold.
  await continueWith(page, { player: { cargo: {} } });
  await page.keyboard.press('e');
  await page.evaluate(() => {
    window.__corsair.sim.step(1);
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  const hunger = page.locator('.hud-toast', { hasText: 'Warning: hunger' });
  await expect(hunger).toContainText('The food is gone');
  // The keys it names are ones that work: pick her, then Space.
  await expect(hunger).toContainText('hail a passing ship (pick her, Space)');
  // Past a few days' grace without food, men die of it. A little at a time, each drawn: the sea's one note goes to
  // the last thing that happened, and a fight come into sight in the same frame would take it.
  await page.evaluate(async () => {
    for (let i = 0; i < 200 && !window.__corsair.log.query({ type: 'MenStarved' }).length; i++) {
      window.__corsair.sim.step(50);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await expect(page.locator('.hud-toast', { has: page.locator('.hud-toast-kind', { hasText: /^Starving$/ }) })).toContainText('died of hunger: make port, or hail a ship (pick her, Space) and buy food');
  expect(errors).toEqual([]);
});

test('toasts: rent from her land, a pirate haven found, and running aground', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // A Baron of England: a hundred acres, rent every thirty days.
  await continueWith(page, { captain: { marques: ['england'], merit: { england: 75 } } });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  const gold = (await captain(page)).gold;
  // Up to the eve of rent day, a frame drawn (the month's other news shown and gone by), then past it: the HUD has
  // one note at a time, the last of a frame's events, so rent comes alone in its frame.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'furled' });
    const t = window.__corsair.state.get('tick') as number;
    window.__corsair.sim.step(30 * 771 - t - 10);
  });
  await frames(page, 2);
  await page.evaluate(() => window.__corsair.sim.step(12));
  await expect(page.locator('.hud-toast', { hasText: 'Rent' })).toContainText('Rent from your land: +100 gold');
  expect((await captain(page)).gold).toBeGreaterThanOrEqual(gold + 100);
  // A cove not yet on her chart, come within sight: said, and charted.
  const cove = await page.evaluate(() => {
    const known = new Set((window.__corsair.state.get('captain') as { knownHavens?: string[] }).knownHavens ?? []);
    const h = window.__corsair.ports().find((p) => p.id.startsWith('haven.') && !known.has(p.id))!;
    for (let r = 3; r < 12; r++)
      for (let a = 0; a < 360; a += 20) {
        const [x, y] = [h.x + r * Math.cos((a * Math.PI) / 180), h.y + r * Math.sin((a * Math.PI) / 180)];
        if (window.__corsair.land(x, y)) continue;
        window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x, y });
        window.__corsair.sim.step(2);
        return h;
      }
    return h;
  });
  await expect(page.locator('.hud-toast', { hasText: 'Haven found' })).toContainText(`A pirate haven: ${cove.name}`);
  expect((await captain(page) as unknown as { knownHavens: string[] }).knownHavens).toContain(cove.id);
  // A course set straight at the land: she runs aground, and is told to take the helm.
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    let land: [number, number] | undefined;
    let sea: [number, number] | undefined;
    for (let r = 3; r < 40 && !(land && sea); r++)
      for (let a = 0; a < 360 && !(land && sea); a += 10) {
        const [x, y] = [pr.x + r * Math.cos((a * Math.PI) / 180), pr.y + r * Math.sin((a * Math.PI) / 180)];
        const [ox, oy] = [x + 4 * Math.cos((a * Math.PI) / 180), y + 4 * Math.sin((a * Math.PI) / 180)];
        if (window.__corsair.land(x, y) && !window.__corsair.land(ox, oy)) [land, sea] = [[x, y], [ox, oy]];
      }
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: sea![0], y: sea![1] });
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'full' });
    window.__corsair.cmd.send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: land![0], y: land![1], route: [] } as never);
    for (let i = 0; i < 3000 && !window.__corsair.log.query({ type: 'AssistEnded' }).some((e) => e.payload.reason === 'aground'); i++) window.__corsair.sim.step(1);
  });
  await expect(page.locator('.hud-toast', { hasText: 'Aground' })).toContainText('Take the helm');
  expect(errors).toEqual([]);
});

test('a tour of the port: every building and everyone in it opens, with no errors', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Merchant');
  await expect(page.locator('.merchant')).toBeVisible();
  await openService(page, 'Tavern');
  await expect(page.locator('.tavern-room')).toBeVisible();
  for (const who of await page.locator('.tavern-person').allInnerTexts()) {
    const name = who.replace(/\d+$/, '').trim();
    await page.locator('.tavern-person', { hasText: name }).click();
    await expect(page.locator('.tavern-person.active')).toContainText(name);
    await expect(page.locator('.tavern-card .k-speech, .tavern-card .stranger').first()).toBeVisible();
  }
  await openService(page, 'Governor');
  await expect(page.locator('.governor')).toBeVisible();
  await openService(page, 'Shipwright');
  for (const tab of ['Ships for sale', 'Fit out', 'Your ships']) {
    await page.locator('.shipwright-tabs').getByRole('button', { name: tab }).click();
    await expect(page.locator('.shipwright-tabs .active')).toHaveText(tab);
  }
  await expect(page.locator('.yard-ships')).toBeVisible();
  // The docks: retiring, and back.
  await page.keyboard.press('Escape');
  await page.locator('.port-docks').click();
  await expect(page.locator('.harbour-docks')).toContainText('The docks');
  await expect(page.locator('.harbour-docks').getByRole('button', { name: 'Retire…' })).toBeVisible();
  await page.screenshot({ path: 'test-results/port-tour.png' });
  expect(errors).toEqual([]);
});

test('F2 shows the frame rate (and the resolution the sea is drawn at), F2 hides it, and ?fps=1 shows it from the start', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const fps = page.locator('.fps');
  await expect(fps).toBeHidden();
  await page.keyboard.press('F2');
  await expect(fps).toBeVisible();
  // The world's clock is held here, but frames are still drawn: the readout fills in within a second.
  await expect(fps).toHaveText(/^\d+ fps · \d+\.\d ms \(slowest \d+\) · view [\d.]+×$/);
  await page.screenshot({ path: 'test-results/fps.png' });
  await page.keyboard.press('F2');
  await expect(fps).toBeHidden();
  // The help lists it.
  await page.keyboard.press('F1');
  await expect(page.locator('.hud-help-row', { has: page.locator('.k-key', { hasText: /^F2$/ }) })).toContainText('frame rate');
  await page.keyboard.press('F1');
  // A player asked to report it can open the game with it showing.
  await page.goto('/?seed=3&fps=1&pace=1&turn=1');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.fps')).toHaveText(/ fps · /);
  expect(errors).toEqual([]);
});

test('a goal done in port is a deed card: said in the past tense, paid, what next, kept on the Deeds page', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // One gun short of a full battery: the last one completes the career's first goal, in port.
  await continueWith(page, { player: { guns: 17 } });
  await openService(page, 'Shipwright');
  await page.locator('.shipwright').getByRole('button', { name: 'See the guns' }).click();
  const gold = await page.evaluate(() => window.__corsair.state.get('captain.gold') as number);
  await page.locator('.shipwright').getByRole('button', { name: /^Buy 1/ }).click();
  await page.evaluate(() => window.__corsair.sim.step(1));
  const card = page.locator('.deed-standard');
  await expect(card).toBeVisible();
  await expect(card.locator('.deed-kind')).toHaveText(/goal done/i);
  await expect(card.locator('.deed-title')).toHaveText('A full battery');
  // The figure counts up to the goal's pay, which is in her purse.
  await expect(card.locator('.deed-gold')).toHaveText('+100');
  await expect(card.locator('.deed-into')).toHaveText('gold into your purse');
  await expect(card.locator('.deed-next')).toContainText('Next:');
  expect(await page.evaluate(() => window.__corsair.state.get('captain.gold') as number)).toBe(gold - 150 + 100);
  // Top centre, over the harbour and the building.
  const box = (await card.boundingBox())!;
  const view = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(4);
  await page.screenshot({ path: 'test-results/deed-port.png' });
  // It stays until dismissed: Escape closes the card, and only the card (the shipwright stays open).
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('.shipwright')).toBeVisible();
  // The log keeps it on its Deeds page.
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await page.locator('.log-mark', { hasText: 'Deeds' }).click();
  await expect(page.locator('.deeds-line').first()).toContainText('Goal done: a full battery');
  await expect(page.locator('.deeds-line').first().locator('.deeds-figure')).toHaveText('+100');
  await page.screenshot({ path: 'test-results/deeds-page.png' });
  expect(errors).toEqual([]);
});

/** Put her in `name`'s harbour: on open water off its quay, then E (a port in reach). */
async function dockAt(page: Page, name: string) {
  const id = await page.evaluate((n) => {
    const p = window.__corsair.ports().find((x) => x.name === n)!;
    for (let r = 1; r < 6; r++)
      for (let a = 0; a < 360; a += 30) {
        const [x, y] = [p.x + r * Math.cos((a * Math.PI) / 180), p.y + r * Math.sin((a * Math.PI) / 180)];
        if (window.__corsair.land(x, y)) continue;
        window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x, y });
        window.__corsair.sim.step(1);
        return p.id;
      }
    return p.id;
  }, name);
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect.poll(() => page.evaluate(() => window.__corsair.state.get('ships.player.docked'))).toBe(id);
}

test("a courier's letter: marked on the chart, a quarter paid on delivery, the reply marked home, the rest into her purse", async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  const ids = await page.evaluate(() => Object.fromEntries(window.__corsair.ports().map((p) => [p.name, p.id])));
  const letter = { id: 'm.test', kind: 'courier', from: ids['Port Royal'], nation: 'england', to: ids['Bridgetown'], reward: 800, merit: 1, tick: 0, endTick: 10_000_000 };
  await continueWith(page, { captain: { missions: [letter] } });
  const gold = async () => (await page.evaluate(() => window.__corsair.state.get('captain'))) as { gold: number; chest?: number };
  // The chart rings Bridgetown: the letter's to go there.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await expect(page.locator('.chart-ring-label')).toContainText("Port Royal's letter: deliver it to Bridgetown");
  await page.keyboard.press('m');
  // Handed over: the governor of Bridgetown says so, and pays a quarter for the trouble.
  await dockAt(page, 'Bridgetown');
  const before = (await gold()).gold;
  await openService(page, 'Governor');
  await expect(page.locator('.governor')).toContainText('A letter from the governor of Port Royal');
  await expect(page.locator('.governor')).toContainText('200 gold for your trouble');
  expect((await gold()).gold - before).toBe(200);
  // And a deed card says it, with what is still to come.
  const card = page.locator('.deed-standard');
  await expect(card.locator('.deed-title')).toHaveText('Letter delivered, Bridgetown');
  await expect(card.locator('.deed-gold')).toHaveText('+200');
  await expect(card).toContainText('600 more when the reply is home');
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).toHaveCount(0);
  // Now the chart marks the way home.
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await expect(page.locator('.chart-ring-label')).toContainText("Bridgetown's reply: bring it to Port Royal");
  await page.keyboard.press('m');
  // Home: the rest, into the purse, not the crew's chest.
  await dockAt(page, 'Port Royal');
  await openService(page, 'Governor');
  await expect(page.locator('.governor-bounty')).toContainText('600 gold for the work done, into your purse');
  const home = await gold();
  await page.locator('.governor-bounty').getByRole('button', { name: /Collect your reward/ }).click();
  await page.evaluate(() => window.__corsair.sim.step(1));
  const paid = await gold();
  // (A goal it completes, the Top Ten at this purse, pays a little more of its own.)
  const goals = ((await page.evaluate(() => window.__corsair.state.get('captain.honours'))) as { kind: string; gold?: number }[]).filter((h) => h.kind === 'goal');
  expect(paid.gold - home.gold - goals.reduce((n, h) => n + (h.gold ?? 0), 0)).toBe(600);
  expect(paid.chest ?? 0).toBe(home.chest ?? 0);
  // The letter carried: the pay into her purse, the merit it earned with England, and the bar it moved.
  await expect(card.locator('.deed-title')).toHaveText('The letter carried');
  await expect(card.locator('.deed-gold')).toHaveText('+600');
  await expect(card.locator('.deed-into')).toHaveText('gold into your purse');
  await expect(card).toContainText('+1 merit with England');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/deed-letter.png' });
  expect(errors).toEqual([]);
});

test('deeds at sea: her first prize stays until dismissed, then a goal it completed slides in small and away', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // In a sloop, so any pirate is her own size.
  await continueWith(page, { player: { classId: 'ship.sloop', guns: 6, crew: 60 } });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.port')).toHaveCount(0);
  // A pirate brought alongside, and the fight settled straight through the sim (the battle has its own tests).
  const id = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'pirate', from: 'town.tortuga', to: 'town.port_royal' } as never);
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { ai?: { name: string } }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    return { id, name: ships[id]!.ai!.name };
  });
  await page.evaluate((targetId) => {
    window.__corsair.cmd.send({
      type: 'BattleEnded',
      shipId: 'player',
      targetId,
      result: { outcome: 'struck', player: { hull: 80, sailCondition: 90, crew: 55, guns: 6 }, enemy: { hull: 10, sailCondition: 40, crew: 5, guns: 4 } },
    } as never);
    window.__corsair.sim.step(1);
  }, id.id);
  const card = page.locator('.deed-standard');
  await expect(card.locator('.deed-title')).toHaveText('First prize taken');
  await expect(card.locator('.deed-kind')).toHaveText(/a first/i);
  await expect(card).toContainText(`The ${id.name} struck`);
  // The prize goal is this card's too: its pay is a line here, not a second card.
  await expect(card).toContainText('+100 gold: a goal done');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/deed-prize.png' });
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  // A pirate of her own rung beaten is the next goal done: a small card, in the notes' corner, gone by itself.
  const small = page.locator('.deed-small');
  await expect(small.locator('.deed-title')).toHaveText('A pirate your own size beaten');
  await expect(small.locator('.deed-note')).toContainText('gold into your purse');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/deed-small.png' });
  await expect(small).toHaveCount(0, { timeout: 8000 });
  expect(errors).toEqual([]);
});

test('gold paid in rises off the purse: a sale shows +N over the gold', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Merchant');
  const row = page.locator('.port .market tr', { hasText: 'Sugar' });
  await row.getByRole('button', { name: 'Buy 10' }).click();
  await page.evaluate(() => window.__corsair.sim.step(1));
  // Buying takes gold out: nothing rises.
  await frames(page, 2);
  await expect(page.locator('.k-stat-rise')).toHaveCount(0);
  const before = (await page.evaluate(() => window.__corsair.state.get('captain.gold'))) as number;
  await row.getByRole('button', { name: 'Sell all' }).click();
  await page.evaluate(() => window.__corsair.sim.step(1));
  const after = (await page.evaluate(() => window.__corsair.state.get('captain.gold'))) as number;
  expect(after).toBeGreaterThan(before);
  // On the merchant's ledger, where the player is looking (the sea's strip has its own, hidden in port).
  const rise = page.locator('.merchant-gold .k-stat-rise');
  await expect(rise).toBeVisible();
  await expect(rise).toHaveText(`+${(after - before).toLocaleString('en-US')}`);
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/purse-rise.png', clip: { x: 30, y: 600, width: 420, height: 140 } });
  // And it is gone again a moment later.
  await expect(rise).toHaveCount(0, { timeout: 4000 });
  expect(errors).toEqual([]);
});
