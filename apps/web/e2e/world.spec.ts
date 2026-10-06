import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import music from '../../../packages/data/content/music.json' with { type: 'json' };

const musicTitles = music.tunes.map((t) => t.title);

// Drives the real game through window.__corsair (PRD section 16): the debug API confirms behaviour,
// screenshots confirm rendering.

/** Start a new career. It begins docked in port; most checks set sail first (`inPort` keeps her there). */
async function boot(page: Page, url = '/', { inPort = false } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__corsair));
  // Freeze the clock so every check below steps the sim explicitly.
  await page.evaluate(() => window.__corsair.sim.pause());
  if (!inPort) {
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(1));
  }
  return errors;
}

const player = (page: Page) =>
  page.evaluate(() => window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number; speed: number });

test('a new career starts docked in port, under-gunned, and the shipwright outfits her', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  await page.locator('.port-tabs').getByRole('button', { name: 'Shipwright' }).click();
  await expect(page.locator('.shipwright')).toContainText('Guns 10 / 18');
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await page.locator('.shipwright').getByRole('button', { name: /^Buy 1/ }).click();
  await expect(page.locator('.shipwright')).toContainText('Guns 11 / 18');
  await page.locator('.upgrades tr', { hasText: 'Triple hammocks' }).getByRole('button', { name: /^Buy/ }).click();
  await expect(page.locator('.upgrades tr', { hasText: 'Triple hammocks' })).toContainText('installed');
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(gold - 150 - 400);
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.upgrades'))).toEqual(['hammocks']);
  await page.screenshot({ path: 'test-results/shipwright.png' });
  expect(errors).toEqual([]);
});

test('boots onto the Caribbean at 960x540, scaled 2x, with no errors', async ({ page }) => {
  const errors = await boot(page);
  const canvas = page.locator('canvas').first();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height, c.style.width])).toEqual([960, 540, '1920px']);
  expect(await page.evaluate(() => typeof window.__corsair.seed)).toBe('number');
  await expect(page.locator('.hud')).toContainText('1660');
  await expect(page.locator('.label', { hasText: 'Port Royal' })).toBeVisible();
  await page.screenshot({ path: 'test-results/boot.png' });
  expect(errors).toEqual([]);
});

test('sails and steers: the ship moves and the helm turns it', async ({ page }) => {
  await boot(page);
  const start = await player(page);
  await page.evaluate(() => window.__corsair.sim.step(90));
  const moved = await player(page);
  expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(1);

  await page.keyboard.down('d');
  await page.evaluate(() => window.__corsair.sim.step(30));
  await page.keyboard.up('d');
  await page.evaluate(() => window.__corsair.sim.step(1));
  const turned = await player(page);
  expect(turned.headingDeg).toBeGreaterThan(start.headingDeg + 15);
});

test('opens the sea chart with every port', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeVisible();
  await expect(page.locator('.chart-port')).toHaveCount(45);
  await page.screenshot({ path: 'test-results/chart.png' });
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeHidden();
});

test('weather: days pass and a storm over the ship takes over the wind', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__corsair.sim.step(1080 * 2));
  await expect(page.locator('.hud')).toContainText('3 March 1660');

  await page.evaluate(() => {
    const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
    window.__corsair.cmd.send({ type: 'SpawnStorm', x: p.x + 6, y: p.y });
    window.__corsair.sim.step(1);
  });
  await expect(page.locator('.hud-storm')).toBeVisible();
  await page.screenshot({ path: 'test-results/storm.png' });
  const formed = await page.evaluate(() => window.__corsair.log.query({ type: 'StormFormed' }).length);
  expect(formed).toBe(1);
});

test('tacking aid and destination: B beats, T tacks, a chart click sets a course', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('b');
  await page.evaluate(() => window.__corsair.sim.step(150));
  const beating = await page.evaluate(() => window.__corsair.state.get('ships.player.assist') as { tack: string });
  expect(beating).toBeTruthy();
  await expect(page.locator('.hud')).toContainText('Beating');

  await page.keyboard.press('t');
  await page.evaluate(() => window.__corsair.sim.step(1));
  const tacked = await page.evaluate(() => window.__corsair.state.get('ships.player.assist') as { tack: string });
  expect(tacked.tack).not.toBe(beating.tack);

  await page.keyboard.press('m');
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await page.keyboard.press('m');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.hud')).toContainText('To');
  await expect(page.locator('.hud')).toContainText('Cartagena');
  await page.screenshot({ path: 'test-results/assist.png' });
});

test('sound starts on the first key, plays, and V mutes it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__corsair));
  expect(await page.evaluate(() => window.__corsair.audio.levels().state)).toBe('locked');
  await expect(page.locator('.hud-sound')).toContainText('Press any key');
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__corsair.audio.levels().rms > 0.001);
  await expect(page.locator('.hud-sound')).toHaveCount(0);
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.__corsair.audio.levels().rms < 0.0005);
  await expect(page.locator('.hud-sound')).toContainText('Sound off');
});

test('the band plays audibly while the game keeps running, and N silences the music', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__corsair));
  // A career opens in port, where the clock stands still: set sail so it runs.
  await page.keyboard.press('e');
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => Boolean(window.__corsair.audio.levels().nowPlaying), undefined, { timeout: 20_000 });
  const title = await page.evaluate(() => window.__corsair.audio.levels().nowPlaying);
  expect(musicTitles).toContain(title);

  // The real frame loop, not stepped by hand: the clock must keep moving while notes play.
  const tick0 = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  const loudness = async () => {
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      sum += await page.evaluate(() => window.__corsair.audio.levels().rms);
      await page.waitForTimeout(100);
    }
    return sum / 15;
  };
  const withMusic = await loudness();
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBeGreaterThan(tick0 + 20);

  await page.keyboard.press('n');
  expect(await page.evaluate(() => window.__corsair.audio.levels().music)).toBe(false);
  await page.waitForTimeout(1200);
  const without = await loudness();
  expect(withMusic).toBeGreaterThan(without * 1.15);
  expect(errors).toEqual([]);
});

test('sea life: dolphins, flying fish, a whale and birds appear on demand', async ({ page }) => {
  const errors = await boot(page);
  // The renderer keeps drawing while the sim is paused, so spawned animals animate.
  for (const kind of ['dolphins', 'flyingFish', 'whale', 'pelicans', 'frigatebird'] as const) {
    await page.evaluate((k) => window.__corsair.wildlife.spawn(k), kind);
  }
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__corsair.wildlife.count)).toBeGreaterThan(5);
  await page.screenshot({ path: 'test-results/wildlife.png' });
  expect(errors).toEqual([]);
});

test('trade loop: dock with E, buy sugar in Bridgetown, sell it dearer in Port Royal', async ({ page }) => {
  // A fixed world keeps the prices checked below the same from run to run.
  const errors = await boot(page, '/?seed=3');
  expect(await page.evaluate(() => window.__corsair.seed)).toBe(3);
  // A new career opens within reach of Port Royal.
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.hud-prompt')).toContainText('Enter Port Royal');

  const goTo = async (name: string) => {
    await page.evaluate((n) => {
      const port = window.__corsair.ports().find((p) => p.name === n)!;
      // Try the water tiles around the port until one takes the ship.
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
        window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: port.x + dx!, y: port.y + dy! });
        window.__corsair.sim.step(1);
        const s = window.__corsair.state.get('ships.player') as { x: number; y: number };
        if (Math.hypot(s.x - port.x, s.y - port.y) < 3) return;
      }
    }, name);
    // The test holds the clock, so step once to let the dock command land.
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(1));
    await expect(page.locator('.port-name')).toHaveText(name);
  };
  const gold = () => page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);

  await goTo('Bridgetown');
  const startGold = await gold();
  // What the port makes and needs is common knowledge, and the rows say which way to trade.
  await expect(page.locator('.port-lean')).toContainText('exports Sugar');
  const sugar = page.locator('.port .market tr', { hasText: 'Sugar' });
  await expect(sugar).toContainText('buy here');
  // Food is a staple: never worth carrying, so it gets no trade tag. Every good shows how much its market takes.
  await expect(page.locator('tr', { hasText: 'Food' }).locator('.trend')).toHaveCount(0);
  // This port's own depth comes first; a remembered best sale elsewhere shows its depth too.
  await expect(sugar.locator('.takes').first()).toHaveText(/^~\d+$/);
  await page.locator('.port .market tr', { hasText: 'Sugar' }).getByRole('button', { name: 'Max' }).click();
  await expect(sugar.locator('.paid')).toContainText('@');
  const bought = await page.evaluate(() => (window.__corsair.state.get('ships.player.cargo') as Record<string, number>).sugar);
  expect(bought).toBeGreaterThan(10);
  await page.screenshot({ path: 'test-results/port.png' });
  // Put the market away to see the harbour, then open it again from the merchant's building.
  await page.keyboard.press('Escape');
  await expect(page.locator('.port-spot', { hasText: 'Merchant' })).toBeVisible();
  await page.screenshot({ path: 'test-results/harbour.png' });
  await page.locator('.port-spot', { hasText: 'Merchant' }).click();
  await expect(page.locator('.market')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);

  await goTo('Port Royal');
  const sugarHere = page.locator('.port .market tr', { hasText: 'Sugar' });
  await expect(sugarHere).toContainText('sells well');
  // Selling above what the hold cost shows as a gain; Bridgetown is now a remembered price.
  await expect(sugarHere.locator('td.num.gain')).toHaveCount(1);
  await expect(sugarHere.locator('.best')).toContainText('Bridgetown');
  await expect(sugarHere.locator('.best .takes')).toHaveText(/^~\d+$/);
  await page.screenshot({ path: 'test-results/port-trade.png' });
  await page.locator('.port .market tr', { hasText: 'Sugar' }).getByRole('button', { name: 'All' }).click();
  expect(await gold()).toBeGreaterThan(startGold);
  expect(errors).toEqual([]);
});

test('saves: docking autosaves, a reload offers Continue, and the career comes back as it was', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  // Docking autosaved; let that flash pass so the next one is the Ctrl+S save landing.
  await expect(page.locator('.hud-saved')).toBeVisible();
  await expect(page.locator('.hud-saved')).toHaveCount(0);
  await page.locator('tr', { hasText: 'Food' }).getByRole('button', { name: '10' }).click();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.hud-saved')).toBeVisible();
  const before = await page.evaluate(() => ({ hash: window.__corsair.state.hash(), seed: window.__corsair.seed }));

  await page.reload();
  await expect(page.locator('.start')).toContainText('In port at Port Royal');
  await page.screenshot({ path: 'test-results/start.png' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  const after = await page.evaluate(() => ({ hash: window.__corsair.state.hash(), seed: window.__corsair.seed }));
  expect(after).toEqual(before);

  await page.reload();
  await page.getByRole('button', { name: 'New career' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(1000);
  expect(errors).toEqual([]);
});

test('sea chart: hovering a port shows the prices last seen there, or that none are known', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('m');
  // The career began in Port Royal, so its prices are known; a port never visited shows none.
  await page.locator('.chart-port', { hasText: 'Tortuga' }).hover();
  await expect(page.locator('.chart-prices')).toContainText('Prices unknown');

  await page.keyboard.press('m');
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1080 * 2));
  await page.mouse.move(0, 0);
  await page.keyboard.press('m');
  await expect(page.locator('.chart-prices')).toBeHidden();
  await page.locator('.chart-port', { hasText: 'Port Royal' }).hover();
  await expect(page.locator('.chart-prices')).toContainText('Prices seen 2 days ago');
  await expect(page.locator('.chart-prices')).toContainText('Sugar');
  await page.screenshot({ path: 'test-results/chart-prices.png' });
  await page.locator('.chart-port', { hasText: 'Havana' }).hover();
  await expect(page.locator('.chart-prices')).toContainText('Prices unknown');

  // The goods filter marks makers and buyers everywhere, with prices only where the captain has been.
  await page.locator('.chart-goods').getByRole('button', { name: 'Sugar' }).click();
  await expect(page.locator('.chart-port.lean-exports', { hasText: 'Bridgetown' })).toHaveText('Bridgetown');
  await expect(page.locator('.chart-port.lean-wants', { hasText: 'Port Royal' })).toHaveText(/^Port Royal \d+$/);
  await page.screenshot({ path: 'test-results/chart-sugar.png' });
});

test('harbour scenes: a pirate haven has its own scene, and night falls on it too', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const port = window.__corsair.ports().find((p) => p.name === 'Tortuga')!;
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: port.x + dx!, y: port.y + dy! });
      window.__corsair.sim.step(1);
      const s = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(s.x - port.x, s.y - port.y) < 3) return;
    }
  });
  await page.keyboard.press('e');
  // 14 hours on from 08:00: the debug step runs the clock even in port.
  await page.evaluate(() => window.__corsair.sim.step(1080 * (14 / 24)));
  await expect(page.locator('.port-name')).toHaveText('Tortuga');
  await page.keyboard.press('Escape');
  // A haven has no governor.
  await expect(page.locator('.port-spot')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/haven-night.png' });
  expect(errors).toEqual([]);
});

test('saves: an unreadable save is never silently replaced; it can still be saved to a file', async ({ page }) => {
  await boot(page);
  // Plant a save from a future format in the career slot.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('corsair', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('saves');
        req.onsuccess = () => {
          const tx = req.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put({ format: 99, seed: 7, state: { tick: 1 }, note: 'keep me' }, 'career');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.locator('.start')).toContainText("can't be opened");
  await expect(page.locator('.start')).toContainText('format 99');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save to file' }).click()]);
  const saved = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  expect(saved.note).toBe('keep me');
  await page.screenshot({ path: 'test-results/start-unreadable.png' });
});

test('ships lying in port are listed in the tavern with when each sails', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A new world's ships start in their home ports: find a port with ships in it and dock there.
  const port = await page.evaluate(() => {
    type S = { x: number; y: number; ai?: { from: string; waitUntil?: number; route: unknown[] } };
    const ships = Object.values(window.__corsair.state.get('ships') as Record<string, S>).filter((s) => s.ai?.waitUntil !== undefined && !s.ai.route.length);
    const at = ships[0]!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: at.x, y: at.y });
    window.__corsair.sim.step(1);
    return { id: at.ai!.from, moored: ships.filter((s) => s.ai!.from === at.ai!.from).length };
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.locator('.port-tabs').getByRole('button', { name: /^Tavern/ }).click();
  await expect(page.locator('.harbour-ships > div:not(.age)')).toHaveCount(port.moored);
  await expect(page.locator('.harbour-ships')).toContainText('sails');
  await page.screenshot({ path: 'test-results/harbour-ships.png' });
  expect(errors).toEqual([]);
});

test('news: a shock is talked about in the tavern, then shows on the chart', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // News is known at once where it happens, so a shock in the port we're at needs no waiting.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShock', settlementId: 'town.port_royal', good: 'sugar', kind: 'shortage' });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  const tab = page.locator('.port-tabs').getByRole('button', { name: 'Tavern (1)' });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator('.tavern li')).toHaveCount(1);
  await expect(page.locator('.tavern')).toContainText('Port Royal has run short of sugar');
  await expect(page.locator('.tavern .trend')).toHaveText('new');
  await page.screenshot({ path: 'test-results/tavern.png' });
  // Heard now: the badge goes, and the rumour is in the captain's memory.
  await expect(page.locator('.port-tabs').getByRole('button', { name: 'Tavern', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { heard: string[] }).heard)).toHaveLength(1);

  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await page.locator('.chart-port', { hasText: 'Port Royal' }).hover();
  await expect(page.locator('.chart-rumour')).toContainText('run short of sugar');
  expect(errors).toEqual([]);
});

test('leaving port: E sets sail back to the sea view, pointing out of the harbour', async ({ page }) => {
  // The game runs here (no pause), as a player has it. A new career opens docked in Port Royal.
  await page.goto('/?seed=3');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('harbour');

  await page.keyboard.press('e');
  await expect(page.locator('.port')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  // Under way and opening the distance from the town.
  const away = () =>
    page.evaluate(() => {
      const p = window.__corsair.ports().find((x) => x.name === 'Port Royal')!;
      const s = window.__corsair.state.get('ships.player') as { x: number; y: number };
      return Math.hypot(s.x - p.x, s.y - p.y);
    });
  const start = await away();
  await expect.poll(away, { timeout: 5000 }).toBeGreaterThan(start + 1);
  await page.screenshot({ path: 'test-results/left-port.png' });
});

test('ships at sea: AI ships sail, a ship alongside can be hailed, and the chart marks ships seen', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const count = await page.evaluate(() => Object.values(window.__corsair.state.get('ships') as Record<string, { ai?: unknown }>).filter((s) => s.ai).length);
  expect(count).toBe(34);

  // An English merchant sets out from Port Royal; bring the player alongside her.
  const id = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    const newest = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    // Clear of Port Royal's reach (half pace since the sailing slice), so the hail is the prompt.
    window.__corsair.sim.step(240);
    const s = (window.__corsair.state.get('ships') as typeof ships)[newest]!;
    for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx!, y: s.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      const now = (window.__corsair.state.get('ships') as typeof ships)[newest]!;
      if (Math.hypot(p.x - now.x, p.y - now.y) < 3) break;
    }
    return newest;
  });
  await expect(page.locator('.hud-prompt')).toContainText('Hail the English fluyt');
  await page.keyboard.press('h');
  await expect(page.locator('.hail')).toContainText('bound for Cartagena');
  // Firing on a nation's ship is allowed, with a warning of what it costs.
  await expect(page.locator('.hail').getByRole('button', { name: /Attack/ })).toContainText('angers the English');
  await page.screenshot({ path: 'test-results/hail.png' });
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'Hailed' }).length)).toBe(1);
  await page.keyboard.press('h');
  await expect(page.locator('.hail')).toHaveCount(0);

  await page.keyboard.press('m');
  await expect(page.locator('.chart-ship').first()).toBeVisible();
  expect(id).toMatch(/^ai\./);
  expect(errors).toEqual([]);
});

test('sea battle: attack a ship from the hail panel, fight it out, and the outcome reaches the world', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(90);
    const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
    for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx!, y: s.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - s.x, p.y - s.y) < 3) break;
    }
  });
  await page.keyboard.press('h');
  await page.locator('.hail').getByRole('button', { name: /Attack/ }).click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  await expect(page.locator('.battle-card').first()).toContainText('Hull');
  // With the clock running the battle advances on its own, and both ship cards sit inside the view.
  const startTick = await page.evaluate(() => window.__corsair.battle.state()!.tick);
  await page.evaluate(() => window.__corsair.sim.resume());
  await expect.poll(() => page.evaluate(() => window.__corsair.battle.state()!.tick)).toBeGreaterThan(startTick + 10);
  await page.evaluate(() => window.__corsair.sim.pause());
  const viewport = page.viewportSize()!;
  for (const card of await page.locator('.battle .battle-card').all()) {
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  await page.evaluate(() => window.__corsair.battle.step(30 * 4, 'cautious'));
  await page.screenshot({ path: 'test-results/battle.png' });

  // Run until she is out of sight: the sea runs on, a marker on the edge points to her, and the HUD warns.
  await page.evaluate(() => {
    const apart = () => {
      const s = window.__corsair.battle.state()!.ships;
      return Math.hypot(s.enemy.x - s.player.x, s.enemy.y - s.player.y);
    };
    for (let i = 0; i < 30 * 60 && apart() < 31 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(1, 'runner');
  });
  expect(await page.evaluate(() => window.__corsair.battle.result())).toBeUndefined();
  await expect(page.locator('.battle-marker')).toBeVisible();
  await expect(page.locator('.battle-parting')).toContainText('Drawing apart');
  await page.screenshot({ path: 'test-results/battle-apart.png' });

  // Fight it out under autopilot.
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  expect(outcome).toBeDefined();
  await expect(page.locator('.battle-report')).toBeVisible();
  await page.screenshot({ path: 'test-results/battle-report.png' });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'BattleOver' }).length)).toBe(1);
  // Firing on an English ship cost standing with England.
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { standing: Record<string, number> }).standing.england)).toBe(-20);
  expect(errors).toEqual([]);
});

test('privateering: a letter of marque at war, a lawful attack, and a bounty at the governor', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.locator('.port-tabs').getByRole('button', { name: 'Governor' }).click();
  // 1660: Spain is at war with England beyond the line, so the governor sells a letter of marque.
  await expect(page.locator('.governor')).toContainText('at war with Spain');
  await page.locator('.governor').getByRole('button', { name: /Letter of marque/ }).click();
  await expect(page.locator('.governor')).toContainText('You hold an English letter of marque');
  await page.screenshot({ path: 'test-results/governor.png' });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));

  // A Spanish merchant, and the player alongside her.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.santo_domingo', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(90);
    const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
    for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx!, y: s.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - s.x, p.y - s.y) < 3) break;
    }
  });
  await page.keyboard.press('h');
  await expect(page.locator('.hail').getByRole('button', { name: /Attack/ })).toContainText('lawful under your English letter');
  await page.locator('.hail').getByRole('button', { name: /Attack/ }).click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  await page.keyboard.press('Enter');
  const standing = await page.evaluate(() => (window.__corsair.state.get('captain') as { standing: Record<string, number> }).standing);
  expect(standing.spain).toBeLessThan(0);
  expect(standing.england).toBeGreaterThan(0);

  if (outcome === 'struck' || outcome === 'boarded' || outcome === 'sunk') {
    // Back to Port Royal to collect the bounty for a Spanish ship taken in a lawful war.
    await page.evaluate(() => {
      const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
      window.__corsair.sim.step(1);
    });
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(1));
    await page.locator('.port-tabs').getByRole('button', { name: 'Governor' }).click();
    await page.locator('.governor').getByRole('button', { name: /Collect bounties/ }).click();
    await expect(page.locator('.governor')).toContainText('No bounty owed here');
  }
  expect(errors).toEqual([]);
});

test('sailing: cruises at 2x on empty sea, calls a sail in sight and drops to 1x, I intercepts, the chart shows the wind', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Open water south of Jamaica, away from every coast.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 880, y: 700 });
    window.__corsair.sim.step(1);
  });
  // Clear the nearby sea so cruising isn't held by a passing sail.
  const far = await page.evaluate(() => {
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    return Object.values(ships).filter((s) => s.ai && Math.hypot(s.x - 880, s.y - 700) < 15).length;
  });
  if (far === 0) await expect(page.locator('.hud-date').first()).toContainText('2×');

  // A merchant out of Port Royal, a few hours on her way: put the player near her.
  const target = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ids = Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.'));
    const id = ids.sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(1080 / 4);
    const at = { ...(window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[id]!, id };
    for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, -6]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: at.x + dx!, y: at.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - at.x, p.y - at.y) < 12) break;
    }
    return at.id;
  });
  await expect(page.locator('.hud-prompt')).toContainText('Sail ho!');
  // Cruising holds at 1x (here the coast may hold it too: either reason drops it).
  await expect(page.locator('.hud-date').first()).toContainText('1×,');
  await page.keyboard.press('i');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'intercept', targetId: target });

  await page.keyboard.press('m');
  const inked = await page.locator('.chart-wind').evaluate(async (c: HTMLCanvasElement) => {
    await new Promise((r) => setTimeout(r, 200));
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(500);
  await page.screenshot({ path: 'test-results/chart-wind.png' });
  expect(errors).toEqual([]);
});
