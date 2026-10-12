import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import music from '../../../packages/data/content/music.json' with { type: 'json' };

const musicTitles = music.tunes.map((t) => t.title);

// Drives the real game through window.__corsair (PRD section 16): the debug API confirms behaviour,
// screenshots confirm rendering.

/** In port: back to the harbour (Esc), then the building's hotspot (storyboard 2.1: the painting is the menu). */
async function openService(page: Page, name: string) {
  await page.keyboard.press('Escape');
  await page.locator('.port-spot', { hasText: new RegExp(`^${name}`) }).click();
}

/** Without a seed a new career opens on the difficulty pick: take the default, and read the governor's letter. */
async function setSail(page: Page, url: string) {
  if (url.includes('seed=')) return;
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
  await page.goto(url);
  await setSail(page, url);
  await page.waitForFunction(() => Boolean(window.__corsair));
  // The loading screen has faded once the first frames are drawn.
  await expect(page.locator('.loading')).toHaveCount(0);
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

const player = (page: Page) =>
  page.evaluate(() => window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number; speed: number });

test('a new career starts docked in port, under-gunned, and the shipwright outfits her', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  await openService(page, 'Shipwright');
  // She is sound, so the shipwright speaks of the room on her gun deck, and his button goes to the guns.
  await expect(page.locator('.shipwright .k-say')).toContainText('room on her deck for 8 more guns');
  await page.locator('.shipwright').getByRole('button', { name: 'See the guns' }).click();
  await expect(page.locator('.shipwright-tabs .active')).toHaveText('Fit out');
  await expect(page.locator('.shipwright')).toContainText('Guns 10 / 18');
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await page.locator('.shipwright').getByRole('button', { name: /^Buy 1/ }).click();
  await expect(page.locator('.shipwright')).toContainText('Guns 11 / 18');
  const hammocks = page.locator('.fit-card', { hasText: 'Triple hammocks' });
  // The fit says its upside and its downside.
  await expect(hammocks.locator('.fit-up')).toHaveText('+25% crew berths');
  await expect(hammocks.locator('.fit-down')).toHaveText('more men to feed and pay');
  await hammocks.getByRole('button', { name: /^Buy/ }).click();
  await expect(hammocks).toContainText('installed');
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(gold - 150 - 400);
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.upgrades'))).toEqual(['hammocks']);
  await page.screenshot({ path: 'test-results/shipwright.png' });
  expect(errors).toEqual([]);
});

test('boots onto the Caribbean in 3D, filling the window, with no errors', async ({ page }) => {
  const errors = await boot(page);
  const sea = page.locator('canvas.sea3d');
  await expect(sea).toBeVisible();
  expect(await sea.evaluate((c: HTMLCanvasElement) => [c.style.width, c.style.height])).toEqual(['1920px', '1080px']);
  expect(await page.evaluate(() => typeof window.__corsair.seed)).toBe('number');
  await expect(page.locator('.hud')).toContainText('1660');
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
  await page.evaluate(() => window.__corsair.sim.step(771 * 2));
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
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.hud')).toContainText('To');
  await expect(page.locator('.hud')).toContainText('Cartagena');
  await page.screenshot({ path: 'test-results/assist.png' });
});

test('the title stays up after the loading screen has faded, until a career is chosen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Set sail' })).toBeVisible();
  // Well past the loading screen's fade, which once took the title away with it.
  await page.waitForTimeout(1500);
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set sail' })).toBeVisible();
});

test('sound starts on the first key, plays, and V mutes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Set sail' }).click();
  await page.locator('.moment-opening').waitFor();
  // Nothing pressed in the game yet: the sound waits.
  expect(await page.evaluate(() => window.__corsair.audio.levels().state)).toBe('locked');
  await expect(page.locator('.hud-sound')).toContainText('Press any key');
  // The first key (Enter, to the harbour from the governor's letter) starts it.
  await page.keyboard.press('Enter');
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
  await setSail(page, '/');
  await page.waitForFunction(() => Boolean(window.__corsair));
  // A career opens in port, where the clock stands still: set sail so it runs, and let her get under way.
  await page.keyboard.press('e');
  await page.waitForTimeout(4000);
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => Boolean(window.__corsair.audio.levels().nowPlaying), undefined, { timeout: 20_000 });
  const title = await page.evaluate(() => window.__corsair.audio.levels().nowPlaying);
  expect(musicTitles).toContain(title);

  // The real frame loop, not stepped by hand: the clock must keep moving while notes play.
  const tick0 = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  // Meter the band's own bus, not the whole mix: the sea alone drifts between two windows by as much as
  // a gentle tune adds to it, so comparing the whole mix with music on and off was flaky.
  const bandLevel = async () => {
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      sum += await page.evaluate(() => window.__corsair.audio.levels().musicRms);
      await page.waitForTimeout(100);
    }
    return sum / 15;
  };
  // Tunes measure 0.05 to 0.12 here; a band too quiet to hear would be well under this.
  expect(await bandLevel()).toBeGreaterThan(0.02);
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBeGreaterThan(tick0 + 20);

  await page.keyboard.press('n');
  expect(await page.evaluate(() => window.__corsair.audio.levels().music)).toBe(false);
  await page.waitForTimeout(1200);
  expect(await bandLevel()).toBeLessThan(0.001);
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
    await openService(page, 'Merchant');
  };
  const gold = () => page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);

  await goTo('Bridgetown');
  const startGold = await gold();
  // What the port makes and needs is common knowledge: the rows say which way to trade.
  const sugar = page.locator('.port .market tr', { hasText: 'Sugar' });
  await expect(sugar).toContainText('made here');
  // Food is a staple: never worth carrying, so it gets no trade tag. Every good shows how much its market takes.
  await expect(page.locator('tr', { hasText: 'Food' }).locator('.trend')).toHaveCount(0);
  // A good's row says one verdict; clicking it says why, how much the market takes included.
  await expect(sugar.locator('.verdict')).not.toHaveText('');
  await sugar.click();
  await expect(page.locator('.ledger-why')).toContainText('He takes about');
  await page.locator('.port .market tr', { hasText: 'Sugar' }).getByRole('button', { name: 'Buy max' }).click();
  await expect(sugar.locator('.ledger-hint')).toContainText('you paid');
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
  await expect(sugarHere).toContainText('needed here');
  // Selling above what the hold cost: it sells well here, and the hint says what each unit makes.
  await expect(sugarHere.locator('.verdict')).toHaveText('sells well here');
  await expect(sugarHere.locator('.ledger-hint')).toContainText('a unit now');
  await page.screenshot({ path: 'test-results/port-trade.png' });
  await page.locator('.port .market tr', { hasText: 'Sugar' }).getByRole('button', { name: 'Sell all' }).click();
  expect(await gold()).toBeGreaterThan(startGold);
  // The sale is in the captain's log, which opens in port too: one line, with what it made.
  await page.keyboard.press('l');
  await expect(page.locator('.log-mark.active')).toHaveText('Log');
  await expect(page.locator('.logbook-line').first()).toContainText(/Sold \d+ sugar at Port Royal for [\d,]+ gold: \+/);
  await page.screenshot({ path: 'test-results/logbook.png' });
  await page.keyboard.press('l');
  await expect(page.locator('.log')).toHaveCount(0);
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
  await openService(page, 'Merchant');
  await page.locator('tr', { hasText: 'Food' }).getByRole('button', { name: 'Buy 10' }).click();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.hud-saved')).toBeVisible();
  const before = await page.evaluate(() => ({ hash: window.__corsair.state.hash(), seed: window.__corsair.seed }));

  await page.reload();
  await expect(page.locator('.start')).toContainText(/in port at Port Royal/i);
  await page.screenshot({ path: 'test-results/start.png' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  const after = await page.evaluate(() => ({ hash: window.__corsair.state.hash(), seed: window.__corsair.seed }));
  expect(after).toEqual(before);

  await page.reload();
  await page.getByRole('button', { name: 'New career' }).click();
  // A new career picks its difficulty, each level saying what it changes.
  await page.getByRole('button', { name: 'Rogue' }).click();
  await expect(page.locator('.level-card.picked')).toContainText('the wind shifts in battle');
  await page.screenshot({ path: 'test-results/start-difficulty.png' });
  await page.getByRole('button', { name: 'Set sail' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  // The governor's letter opens the career, with its first goal.
  const letter = page.locator('.moment-opening');
  await expect(letter).toContainText("Your uncle's brig is yours, with 10 guns and 75 men");
  await expect(letter).toContainText('the Spanish are at war with us');
  await expect(letter.locator('.moment-goal')).toContainText('Mount a full battery');
  // The loading screen has faded from over it.
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/opening-letter.png' });
  await letter.getByRole('button', { name: /To the harbour/ }).click();
  await expect(page.locator('.moment')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(1000);
  expect(await page.evaluate(() => window.__corsair.state.get('difficulty'))).toBe('rogue');
  expect(errors).toEqual([]);
});

test("sea chart: a port's card says what it means for you, with the prices last seen there, or that none are known", async ({ page }) => {
  await boot(page);
  await page.keyboard.press('m');
  // The career began in Port Royal, so its prices are known; a port never visited shows none.
  // A crowded name may be hidden; the port's pin always shows, and clicking it does the same.
  await page.locator('.chart-dot[title="Tortuga"]').click();
  await expect(page.locator('.chart-card')).toContainText('Prices unknown');

  await page.keyboard.press('m');
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(771 * 2));
  await page.keyboard.press('m');
  await expect(page.locator('.chart-card')).toBeHidden();
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  // What it makes cheap, with the age of the price; every price folded away beneath.
  await expect(page.locator('.chart-card')).toContainText('Rum is cheap');
  await expect(page.locator('.chart-card')).toContainText('All prices, seen 2 days ago');
  await expect(page.locator('.chart-card')).toContainText('Sugar');
  await page.screenshot({ path: 'test-results/chart-prices.png' });
  await page.locator('.chart-card').getByRole('button', { name: 'Close' }).click();
  await page.locator('.chart-port', { hasText: 'Havana' }).click();
  await expect(page.locator('.chart-card')).toContainText('Prices unknown');
  await page.locator('.chart-card').getByRole('button', { name: 'Close' }).click();

  // The goods filter marks makers and buyers everywhere, with prices only where the captain has been.
  await page.locator('.chart-goods').getByRole('button', { name: 'Sugar' }).click();
  await expect(page.locator('.chart-port', { hasText: 'Bridgetown' }).locator('.chart-mark')).toHaveText('cheap');
  await expect(page.locator('.chart-port', { hasText: 'Port Royal' }).locator('.chart-mark')).toHaveText(/^wanted · \d+$/);
  // The title strip says who is at war in 1660.
  await expect(page.locator('.chart-hint-wars')).toContainText('England–Spain');
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
  await page.evaluate(() => window.__corsair.sim.step(771 * (14 / 24)));
  await expect(page.locator('.port-name')).toHaveText('Tortuga');
  await page.keyboard.press('Escape');
  // A haven has no governor: merchant, tavern and shipwright, and the docks.
  await expect(page.locator('.port-spot')).toHaveCount(4);
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
  // The ships in harbour are at the docks.
  await page.locator('.port-docks').click();
  await expect(page.locator('.harbour-ships > div:not(.age)')).toHaveCount(port.moored);
  await expect(page.locator('.harbour-ships')).toContainText('sails');
  await page.screenshot({ path: 'test-results/harbour-ships.png' });
  expect(errors).toEqual([]);
});

test("the captain's goals: L opens the log at the next three, with progress and a course to where each is done", async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await page.keyboard.press('e');
  // Out on open water south of Jamaica.
  await page.evaluate(() => {
    window.__corsair.sim.step(1);
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('l');
  await page.locator('.log-tabs').getByRole('button', { name: 'Goals' }).click();
  const goals = page.locator('.goal');
  await expect(goals).toHaveCount(3);
  await expect(goals.first()).toContainText('Mount a full battery');
  await expect(goals.first()).toContainText('10 / 18 guns');
  await page.screenshot({ path: 'test-results/goals.png' });
  // One click plots the course to a shipwright that sells cannon.
  await goals.first().getByRole('button', { name: /^Plot a course to/ }).click();
  await expect(page.locator('.log')).toHaveCount(0);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => (window.__corsair.state.get('ships.player') as { assist?: { mode: string } }).assist?.mode)).toBe('course');
  expect(errors).toEqual([]);
});

test('the Top Ten: the log ranks the famous pirates by wealth, and the captain below them to start', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('l');
  await page.locator('.log-tabs').getByRole('button', { name: /^Top Ten/ }).click();
  const list = page.locator('.top-ten li');
  await expect(list).toHaveCount(11);
  await expect(list.first()).toContainText('Henry Morgan');
  await expect(list.first()).toContainText('9,000 gold');
  // A new captain's 1,000 gold is less than the poorest of them: eleventh, under them, and told how to make the list.
  await expect(page.locator('.top-ten li.you')).toContainText('11');
  await expect(page.locator('.top-ten li.you')).toContainText('1,000 gold');
  await expect(page.locator('.top-foot')).toContainText('to make the list');
  await page.screenshot({ path: 'test-results/top-ten.png' });
  expect(errors).toEqual([]);
});

test("treasure maps: the tavern stranger sells a piece, the log draws the map, and the chart rings the search", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Tavern');
  // He sits in the corner some weeks: wait them out in port.
  const stranger = page.locator('.tavern-person', { hasText: 'Stranger' });
  for (let w = 0; w < 16 && !(await stranger.count()); w++) {
    await page.evaluate(() => window.__corsair.sim.step(7 * 771));
    await page.waitForTimeout(50);
  }
  await stranger.click();
  await expect(page.locator('.stranger')).toBeVisible();
  await page.screenshot({ path: 'test-results/tavern-stranger.png' });
  await page.locator('.stranger').getByRole('button', { name: /^Buy the piece/ }).click();
  // The map moment: the parchment as far as the piece shows it, the stranger's line, and where to search.
  const moment = page.locator('.moment-map');
  await expect(moment).toContainText("That's all I know, captain");
  await expect(moment).toContainText('1 of 4 pieces');
  await expect(moment.locator('.parchment')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/map-moment.png' });
  await moment.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('.moment')).toHaveCount(0);
  await expect(page.locator('.stranger')).toHaveCount(0);
  const pieces = await page.evaluate(() => (window.__corsair.state.get('captain') as { mapPieces?: Record<string, number> }).mapPieces);
  expect(Object.values(pieces ?? {})).toEqual([1]);
  // At sea, L opens the log at the map: a parchment of the coast, and what it is worth.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('l');
  await expect(page.locator('.log')).toBeVisible();
  await page.locator('.log-tabs').getByRole('button', { name: /^Maps/ }).click();
  await expect(page.locator('.parchment')).toHaveCount(1);
  await expect(page.locator('.log-map')).toContainText('1 of 4 pieces');
  await page.screenshot({ path: 'test-results/treasure-map.png' });
  await page.keyboard.press('l');
  await expect(page.locator('.log')).toHaveCount(0);
  // The chart rings the search area.
  await page.keyboard.press('m');
  await expect(page.locator('.chart-ring')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/treasure-chart.png' });
  expect(errors).toEqual([]);
});

test('digging: off the hoard\'s coast G puts the men ashore, and the gold comes up', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Tavern');
  const stranger = page.locator('.tavern-person', { hasText: 'Stranger' });
  for (let w = 0; w < 16 && !(await stranger.count()); w++) {
    await page.evaluate(() => window.__corsair.sim.step(7 * 771));
    await page.waitForTimeout(50);
  }
  await stranger.click();
  await page.locator('.stranger').getByRole('button', { name: /^Buy the piece/ }).click();
  await expect(page.locator('.moment-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.moment')).toHaveCount(0);
  await page.keyboard.press('e');
  // Off the hoard's own beach (the test knows where it is; the captain only has the ring).
  const hoard = await page.evaluate(() => {
    const famous = window.__corsair.state.get('famous') as Record<string, { hoard?: { landing: [number, number]; value: number } }>;
    const h = Object.values(famous).find((f) => f.hoard)!.hoard!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: h.landing[0], y: h.landing[1] });
    window.__corsair.sim.step(1);
    return h;
  });
  // A goal just done shows first, for 7 seconds; the dig prompt follows.
  await expect(page.locator('.hud-prompt')).toContainText('go ashore and dig', { timeout: 10_000 });
  const tick = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  await page.keyboard.press('g');
  // The hoard moment, over everything; Enter puts the gold in the chest.
  await expect(page.locator('.moment')).toContainText('gold to the plunder chest');
  await page.screenshot({ path: 'test-results/hoard-moment.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { chest?: number }).chest)).toBe(hoard.value);
  // Half a day went by.
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBeGreaterThanOrEqual(tick + Math.round(771 / 2));
  await page.screenshot({ path: 'test-results/dig.png' });
  await page.keyboard.press('l');
  await page.locator('.log-tabs').getByRole('button', { name: /^Maps/ }).click();
  await expect(page.locator('.log-map')).toContainText('dug up');
  expect(errors).toEqual([]);
});

test('the tavern: news from another port shows where it is on a small chart, and plots a course there', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // A shortage at Santiago de Cuba, and the days for word of it to cross to Port Royal.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShock', settlementId: 'town.santiago_de_cuba', good: 'cloth', kind: 'shortage' });
    window.__corsair.sim.step(771 * 6);
  });
  await openService(page, 'Tavern');
  await page.locator('.tavern-person', { hasText: 'Old salt' }).click();
  const card = page.locator('.tavern-card');
  for (let k = 0; k < 12 && !(await card.locator('.k-say', { hasText: 'Santiago de Cuba' }).count()); k++) {
    await card.getByRole('button', { name: /Anything else|From the start/ }).click();
  }
  await expect(card.locator('.k-say')).toContainText('Santiago de Cuba');
  await card.getByRole('button', { name: 'See it on the chart' }).click();
  await expect(card.locator('.chart-inset')).toBeVisible();
  await page.screenshot({ path: 'test-results/tavern-chart.png' });
  await card.getByRole('button', { name: 'Plot a course to Santiago de Cuba' }).click();
  await expect(card.locator('.tavern-plotted')).toContainText('Course set for Santiago de Cuba');
  // She sails it when she sets sail.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => (window.__corsair.state.get('ships.player') as { assist?: { mode: string; portId?: string } }).assist)).toMatchObject({
    mode: 'course',
    portId: 'town.santiago_de_cuba',
  });
  expect(errors).toEqual([]);
});

test('moments: war comes as a letter in port, and a famous pirate seen the first time stops the world', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // England declares war on France; Port Royal hears of it at once, and the captain when she makes port.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SetRelation', a: 'england', b: 'france', war: true });
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  const letter = page.locator('.moment-letter');
  await expect(letter).toContainText('War!');
  await expect(letter).toContainText('England and France are at war');
  await expect(letter.locator('.moment-means')).toContainText("England's governors will grant a letter of marque against France");
  await page.screenshot({ path: 'test-results/moment-letter.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
  // Read, the news is heard and written in the log: it isn't a letter again.
  const captain = await page.evaluate(() => window.__corsair.state.get('captain') as { heard: string[]; logbook: { kind: string; text: string }[] });
  expect(captain.heard).toHaveLength(1);
  expect(captain.logbook.at(-1)).toMatchObject({ kind: 'news', text: expect.stringContaining('England and France are at war') });

  // Out to sea, and alongside a famous pirate under way: the world waits on her moment.
  await page.keyboard.press('e');
  const famous = await page.evaluate(() => {
    type S = { id: string; x: number; y: number; ai?: { famous?: string; waitUntil?: number; route: unknown[] } };
    const atSea = () => Object.values(window.__corsair.state.get('ships') as Record<string, S>).find((s) => s.ai?.famous && !(s.ai.waitUntil !== undefined && !s.ai.route.length));
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
  const moment = page.locator('.moment');
  await expect(moment).toContainText('A famous pirate');
  await expect(moment).toContainText('on the Top Ten');
  await page.screenshot({ path: 'test-results/moment-famous.png' });
  const tick = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBe(tick);
  await page.keyboard.press('Enter');
  await expect(moment).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { famousSeen: string[] }).famousSeen)).toContain(famous);
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
  // The tavern's badge says one piece of news waits there.
  const tab = page.locator('.port-spot', { hasText: /^Tavern/ });
  await expect(tab.locator('.spot-badge')).toHaveText('1');
  await tab.click();
  // Market news is the old salt's: he has something new, so he speaks first, the governor's contract before the talk.
  await expect(page.locator('.tavern-person.active')).toContainText('Old salt');
  await expect(page.locator('.tavern-person.active .spot-badge')).toHaveText('1');
  const card = page.locator('.tavern-card');
  await expect(card.locator('.tavern-telling.contract')).toContainText('The governor of Port Royal pays');
  await expect(card).toContainText('sugar landed there');
  await expect(card).toContainText('1 of 2');
  await card.getByRole('button', { name: 'Anything else?' }).click();
  await expect(card).toContainText('Port Royal has run short of sugar');
  await expect(card.locator('.k-tag.new')).toHaveText('new');
  // Told now: his badge counts it off, though the telling keeps its mark for the visit.
  await expect(page.locator('.tavern-person.active .spot-badge')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/tavern.png' });
  // Heard now: the badge goes, and the rumour is in the captain's memory.
  await page.keyboard.press('Escape');
  await expect(page.locator('.port-spot', { hasText: /^Tavern/ }).locator('.spot-badge')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { heard: string[] }).heard)).toHaveLength(1);

  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  await expect(page.locator('.chart-rumour')).toContainText('run short of sugar');
  // The planner lists the contract she has heard of.
  await expect(page.locator('.chart-plan')).toContainText('Contracts you have heard of');
  await expect(page.locator('.chart-plan')).toContainText('sugar for Port Royal: buy at');
  await page.screenshot({ path: 'test-results/contract-plan.png' });
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

test('sea life and gun smoke on the 3D sea: dolphins, flying fish, a whale and gulls appear on demand', async ({ page }) => {
  const errors = await boot(page);
  // The renderer keeps drawing while the sim is paused, so the animals move.
  for (const kind of ['dolphins', 'flyingFish', 'whale', 'gulls'] as const) {
    await page.evaluate((k) => window.__corsair.wildlife.spawn(k), kind);
  }
  await page.evaluate(() => {
    const me = window.__corsair.state.get('ships.player') as { x: number; y: number };
    (window as unknown as { __corsair3d: { seaFight(x: number, y: number): void } }).__corsair3d.seaFight(me.x + 4, me.y + 2);
  });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__corsair.wildlife.count)).toBeGreaterThan(5);
  await page.screenshot({ path: 'test-results/wildlife.png' });
  expect(errors).toEqual([]);
});

test('ships at sea: AI ships sail, a ship alongside can be hailed, and the chart marks ships seen', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const count = await page.evaluate(() => Object.values(window.__corsair.state.get('ships') as Record<string, { ai?: unknown }>).filter((s) => s.ai).length);
  expect(count).toBe(50);

  // An English merchant sets out from Port Royal; bring the player alongside her.
  const id = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    const newest = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    // Clear of Port Royal's reach, so the hail is the prompt.
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
  // Her name rides under her on the 3D sea.
  await expect(page.locator('.ship-label', { hasText: 'English fluyt' })).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.locator('.hail')).toContainText('bound for Cartagena');
  // Firing on a nation's ship is allowed, with a warning of what it costs.
  await expect(page.locator('.hail-attack')).toContainText('angers the English');
  // Her captain speaks on a card, his bust beside it.
  await expect(page.locator('.hail .k-bust')).toBeVisible();
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
  // Tab switches shot at once (no reload); Space fires only a broadside that bears, so nothing yet.
  // Commands land on the next step (the test holds the clock).
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.__corsair.battle.step(1));
  expect(await page.evaluate(() => window.__corsair.battle.state()!.ships.player.ammo)).toBe('chain');
  expect(await page.evaluate(() => window.__corsair.battle.state()!.ships.player.reload)).toEqual({ port: 0, starboard: 0 });
  await expect(page.locator('.battle-ammo .active')).toContainText('Chain');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Tab');
    await page.evaluate(() => window.__corsair.battle.step(1));
  }
  expect(await page.evaluate(() => window.__corsair.battle.state()!.ships.player.ammo)).toBe('round');
  // The gun bar's shot buttons load it too.
  await page.locator('.battle-ammo').getByRole('button', { name: /Grape/ }).click();
  await page.evaluate(() => window.__corsair.battle.step(1));
  expect(await page.evaluate(() => window.__corsair.battle.state()!.ships.player.ammo)).toBe('grape');
  await page.locator('.battle-ammo').getByRole('button', { name: /Round/ }).click();
  await page.evaluate(() => window.__corsair.battle.step(1));
  const bearing = await page.evaluate(() => window.__corsair.battle.state()!.ships.player.reload);
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.battle.step(1));
  if (bearing.port === 0 && bearing.starboard === 0) {
    const fired = await page.evaluate(() => window.__corsair.battle.state()!.shots.filter((s) => s.from === 'player').length);
    // Seated 24 tiles off: out of range, so Space fires nothing.
    expect(fired).toBe(0);
  }
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

  // Run until she draws off: the sea runs on (the camera keeps both ships in view), and the HUD warns.
  await page.evaluate(() => {
    const apart = () => {
      const s = window.__corsair.battle.state()!.ships;
      return Math.hypot(s.enemy.x - s.player.x, s.enemy.y - s.player.y);
    };
    for (let i = 0; i < 30 * 60 && apart() < 31 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(1, 'runner');
  });
  expect(await page.evaluate(() => window.__corsair.battle.result())).toBeUndefined();
  await expect(page.locator('.battle-parting')).toContainText('Drawing apart');
  await page.screenshot({ path: 'test-results/battle-apart.png' });

  // Fight it out under autopilot.
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  expect(outcome).toBeDefined();
  // The after-action report says what the fight changed; a prize waits on the plunder screen.
  await expect(page.locator('.battle-report')).toBeVisible();
  await expect(page.locator('.battle-standing')).toContainText('England (for the attack) -20');
  await expect(page.locator('.battle-report-picture')).toBeVisible();
  // The hull, sails and men say how they are in words.
  await expect(page.locator('.battle-report-title')).not.toHaveText('');
  await page.screenshot({ path: 'test-results/battle-report.png' });
  if (outcome === 'struck' || outcome === 'boarded') {
    // The report leads to her hold: one button does the sensible thing, a merchant let go by default, saying what that means.
    await page.keyboard.press('Enter');
    await expect(page.locator('.plunder-go')).toContainText(/let her go · Enter/i);
    await expect(page.locator('.plunder')).toContainText('thinks a little better of you');
    expect(await page.evaluate(() => window.__corsair.state.get('prize'))).toBeDefined();
    await page.screenshot({ path: 'test-results/plunder.png' });
  }
  // Enter takes the best of her hold and lets her go, or with no prize carries on.
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'BattleOver' }).length)).toBe(1);
  // Firing on an English ship cost standing with England (less the goodwill for letting a prize go).
  const england = await page.evaluate(() => (window.__corsair.state.get('captain') as { standing: Record<string, number> }).standing.england);
  expect(england).toBe(outcome === 'struck' || outcome === 'boarded' ? -20 + 2 : -20);
  expect(errors).toEqual([]);
});

test('privateering: a letter of marque at war, a lawful attack, and a bounty at the governor', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await openService(page, 'Governor');
  // 1660: Spain is at war with England beyond the line, so the governor offers a letter of marque, saying what it means.
  await expect(page.locator('.governor')).toContainText('at war with Spain');
  await expect(page.locator('.governor .k-say').first()).toContainText("So you're the captain they talk of");
  await expect(page.locator('.governor-offer')).toContainText('Their ships become lawful prizes');
  await page.locator('.governor-offer').getByRole('button', { name: /^Take the letter/ }).click();
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
  await expect(page.locator('.hail-attack')).toContainText('lawful under your English letter');
  await page.locator('.hail').getByRole('button', { name: /Attack/ }).click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  await expect(page.locator('.battle-report')).toBeVisible();
  // The report, and the plunder screen too when she was taken: Enter through to the sea.
  for (let i = 0; i < 3 && (await page.evaluate(() => window.__corsair.view())) === 'battle'; i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
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
    await openService(page, 'Governor');
    // Since the last call: the governor names what you did for him.
    await expect(page.locator('.governor .k-say').first()).toContainText('Spanish ship');
    await page.screenshot({ path: 'test-results/governor-bounty.png' });
    await page.locator('.governor').getByRole('button', { name: /Collect bounties/ }).click();
    await expect(page.locator('.governor')).toContainText('No bounty owed here');
  }
  expect(errors).toEqual([]);
});

test('sailing: cruises at 2x on empty sea, calls a sail in sight and drops to 1x, I intercepts', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Open water south of Jamaica, away from every coast.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  // Clear the nearby sea so cruising isn't held by a passing sail.
  const far = await page.evaluate(() => {
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
    return Object.values(ships).filter((s) => s.ai && Math.hypot(s.x - 1320, s.y - 1050) < 15).length;
  });
  if (far === 0) {
    await expect(page.getByRole('button', { name: 'Cruise speed' })).toHaveText('2×');
    await expect(page.locator('.hud-date').first()).not.toContainText('1×');
  }

  // A merchant out of Port Royal, a few hours on her way: put the player near her.
  const target = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ids = Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.'));
    const id = ids.sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(771 / 4);
    const at = { ...(window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[id]!, id };
    for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, -6]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: at.x + dx!, y: at.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - at.x, p.y - at.y) < 12) break;
    }
    return at.id;
  });
  await expect(page.locator('.hud-banner')).toContainText('Sail ho!');
  // Cruising holds at 1x (here the coast may hold it too: either reason drops it).
  await expect(page.locator('.hud-date').first()).toContainText('1×,');
  await page.keyboard.press('i');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'intercept', targetId: target });

  expect(errors).toEqual([]);
});


test('course line: a port picked on the chart gets a route by sea, the HUD measures it, and F follows it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('m');
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  // The route is re-plotted about once a second; the HUD reads its length and the next leg's bearing.
  await expect(page.locator('.hud')).toContainText(/Cartagena · \d+ km · bear \d+°/);
  await expect(page.locator('.hud')).toContainText('F to follow');
  await page.screenshot({ path: 'test-results/course-line.png' });
  await page.keyboard.press('f');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await expect(page.locator('.hud')).toContainText('following');
  // Steering by hand takes the helm back; the route stays plotted.
  await page.keyboard.down('a');
  await page.evaluate(() => window.__corsair.sim.step(2));
  await page.keyboard.up('a');
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toBeUndefined();
  await expect(page.locator('.hud')).toContainText('F to follow');
  expect(errors).toEqual([]);
});

test('chart planner: the trades worth sailing from here, from prices seen, and a click sets the course', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Call at Bridgetown to learn its prices (Port Royal's are known from the start).
  await page.evaluate(() => {
    const bt = window.__corsair.ports().find((p) => p.name === 'Bridgetown')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: bt.x + 1, y: bt.y + 2 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('m');
  await expect(page.locator('.chart-plan')).toContainText('Voyages from here');
  const trade = page.locator('.chart-plan-row:not(.lead)').first();
  await expect(trade).toContainText(/buy at .*, sell at .*about \+[\d,]+ gold a hold/);
  await page.screenshot({ path: 'test-results/chart-planner.png' });
  await trade.click();
  await expect(page.locator('.chart-port.selected')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('crew: the food goes day by day at sea, and the tavern pays the wages owed', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const food = () => page.evaluate(() => (window.__corsair.state.get('ships.player.cargo') as Record<string, number>).food ?? 0);
  const before = await food();
  await expect(page.locator('.hud-strip')).toContainText('days');
  // Three days hove to off Port Royal, under its guns where pirates don't come (the clock stops in port).
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'furled' });
    window.__corsair.sim.step(771 * 3);
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
    window.__corsair.sim.step(1);
  });
  expect(await page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await food()).toBeLessThan(before);
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await openService(page, 'Tavern');
  await page.locator('.tavern-person', { hasText: 'Sailors' }).click();
  // Nothing taken yet: the chest is empty, but three days' wages are owed.
  await expect(page.locator('.crew-pay').getByRole('button', { name: /Divide the plunder/ })).toBeDisabled();
  const pay = page.locator('.crew-pay').getByRole('button', { name: /Pay wages/ });
  const owed = Number((await pay.textContent())!.match(/(\d+) gold/)![1]);
  expect(owed).toBeGreaterThan(0);
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await pay.click();
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(gold - owed);
  await expect(page.locator('.crew-pay')).toContainText('unpaid 0 days');
  await page.screenshot({ path: 'test-results/crew-pay.png' });
  expect(errors).toEqual([]);
});

test('a pirate falls on a merchant within sight: they heave to and fight it out, and the HUD calls it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // The player in open water south of Jamaica; a merchant and a pirate put down further south, the pirate
  // beyond seeing the player but in sight of the merchant.
  const ids = await page.evaluate(() => {
    const last = () => Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.')).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    // Hove to, so she watches from where she is.
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'furled' });
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const merchant = last();
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'pirate', from: 'town.tortuga', to: 'town.port_royal' });
    window.__corsair.sim.step(1);
    const pirate = last();
    window.__corsair.cmd.send({ type: 'Teleport', shipId: merchant, x: 1320, y: 1072 });
    window.__corsair.cmd.send({ type: 'Teleport', shipId: pirate, x: 1320, y: 1077 });
    window.__corsair.sim.step(1);
    return { merchant, pirate };
  });
  await page.evaluate(() => {
    for (let i = 0; i < 60 && !window.__corsair.log.query({ type: 'SkirmishBegun' }).length; i++) window.__corsair.sim.step(10);
  });
  const skirmish = await page.evaluate((id) => (window.__corsair.state.get('ships') as Record<string, { ai?: { skirmish?: { with: string } } }>)[id]?.ai?.skirmish, ids.pirate);
  expect(skirmish?.with).toBe(ids.merchant);
  // Called with the way to look (the two rejoin their lanes before they meet, so wherever that falls).
  await expect(page.locator('.hud-prompt')).toContainText(/Gunfire to the (north|south|east|west)\w*!/);
  await page.screenshot({ path: 'test-results/skirmish.png' });
  // Some hours on it's settled, one way or the other.
  await page.evaluate(() => window.__corsair.sim.step(771));
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'SeaFight' }).length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a course to a port takes her in when she comes within reach, without pressing E', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Out to sea a little way off Port Royal.
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    for (const [dx, dy] of [[0, 8], [2, 8], [-2, 8], [0, 10], [4, 6], [-4, 6]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + dx!, y: pr.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - pr.x - dx!, p.y - pr.y - dy!) < 0.5) break;
    }
  });
  await page.keyboard.press('m');
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await page.keyboard.press('f');
  // A couple of ticks a frame, as in play: the game docks her on the frame after she arrives.
  const docked = await page.evaluate(async () => {
    for (let i = 0; i < 1500; i++) {
      window.__corsair.sim.step(2);
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__corsair.state.get('ships.player.docked')) return true;
    }
    return false;
  });
  expect(docked).toBe(true);
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  // The course ended with it: setting sail doesn't put her straight back in.
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toBeUndefined();
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(30));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.docked'))).toBeFalsy();
  expect(errors).toEqual([]);
});

test('fleets: keep a prize, she shows on the ship card, and the shipwright sells her', async ({ page }) => {
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
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  test.skip(outcome !== 'boarded' && outcome !== 'struck', `no prize this run (${outcome})`);
  await page.getByRole('button', { name: /^To her hold/ }).click();
  await page.locator('.plunder-fate').getByRole('button', { name: 'Keep her' }).click();
  await expect(page.locator('.plunder')).toContainText('joins your fleet');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { fleet?: unknown[] }).fleet?.length)).toBe(1);
  // The HUD says the pace she holds the fleet to.
  await expect(page.locator('.hud-fleet')).toContainText('held to');
  await page.evaluate(() => window.__corsair.sim.step(60));
  await page.screenshot({ path: 'test-results/fleet-at-sea.png' });

  // Into Port Royal, where she can be sold.
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  // The log's Fleet page, in port: her state, and selling her.
  await page.getByRole('button', { name: /^Log/ }).click();
  await page.locator('.log-tabs').getByRole('button', { name: 'Fleet' }).click();
  const prize = page.locator('.fleet-row:not(.flagship)');
  await expect(prize).toContainText('fluyt');
  await page.screenshot({ path: 'test-results/fleet-log.png' });
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await prize.getByRole('button', { name: /^Sell/ }).click();
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBeGreaterThan(gold);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { fleet?: unknown[] }).fleet?.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('ships change hands: a pirate takes your fleet ship, shows her in tow, and taking her wins her back', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Fights are settled straight through the sim here (the battle itself has its own tests): one won to keep a
  // merchant, one lost to a pirate, one won back.
  const alongside = (role: string, from: string, to: string) =>
    page.evaluate(
      ({ role, from, to }) => {
        window.__corsair.cmd.send({ type: 'SpawnShip', role, from, to } as never);
        window.__corsair.sim.step(1);
        const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: unknown }>;
        const id = Object.keys(ships).filter((k) => ships[k]!.ai).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
        // Out of harbour and a little way down her lane (a ship in port is out of reach and unlabelled).
        const at = () => (window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: { route: unknown[]; along: number } }>)[id]!;
        for (let i = 0; i < 40 && !(at().ai!.route.length && at().ai!.along > 8); i++) window.__corsair.sim.step(90);
        const s = at();
        for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, -1]]) {
          window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + dx!, y: s.y + dy! });
          window.__corsair.sim.step(1);
          const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
          if (Math.hypot(p.x - s.x, p.y - s.y) < 3) break;
        }
        return id;
      },
      { role, from, to },
    );
  const settle = (targetId: string, outcome: string) =>
    page.evaluate(
      ({ targetId, outcome }) => {
        window.__corsair.cmd.send({
          type: 'BattleEnded',
          shipId: 'player',
          targetId,
          result: { outcome, player: { hull: 80, sailCondition: 90, crew: 70, guns: 18 }, enemy: { hull: 10, sailCondition: 40, crew: 5, guns: 6 } },
        } as never);
        window.__corsair.sim.step(1);
      },
      { targetId, outcome },
    );
  const fleet = () => page.evaluate(() => ((window.__corsair.state.get('captain') as { fleet?: { name: string }[] }).fleet ?? []).map((f) => f.name));

  const merchant = await alongside('merchant', 'town.port_royal', 'town.cartagena');
  await settle(merchant, 'boarded');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false, keep: true } as never);
    window.__corsair.sim.step(1);
  });
  const [kept] = await fleet();
  expect(kept).toBeTruthy();

  const pirate = await alongside('pirate', 'town.tortuga', 'town.port_royal');
  await settle(pirate, 'lost');
  expect(await fleet()).toEqual([]);
  // At sea, hailing her says the prize she has in tow is yours.
  await page.keyboard.press('h');
  await expect(page.locator('.hail')).toContainText(`your fluyt ${kept}`);
  await page.screenshot({ path: 'test-results/prize-in-tow.png' });
  await page.keyboard.press('h');

  await settle(pirate, 'boarded');
  expect(await fleet()).toEqual([kept]);
  expect(errors).toEqual([]);
});

test('the shipyard: new ships for sale, and why one can\'t be bought yet', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A new career starts in Port Royal's harbour, a city: its yard builds most classes.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await openService(page, 'Shipwright');
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Ships' }).click();
  const yard = page.locator('.ships-for-sale');
  await expect(yard).toContainText('war sloop');
  await expect(yard).toContainText('merchantman');
  await expect(yard).not.toContainText('galleon');
  await page.screenshot({ path: 'test-results/shipyard.png' });
  // A new career's purse (1,000 gold) buys no ship yet, and the button says so (buying is the economy tests').
  // Each card compares her with yours.
  await expect(yard.locator('.ship-card', { hasText: 'war sloop' }).locator('.ship-card-compare')).toContainText('Against your brig: faster');
  const barque = yard.locator('.ship-card', { hasText: 'barque' }).getByRole('button');
  await expect(barque).toBeDisabled();
  await expect(barque).toHaveAttribute('title', /Not enough gold/);
  expect(errors).toEqual([]);
});


test('retiring in port scores the career, ends it, and the start screen says how it ended', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  // Retiring is at the docks.
  await page.locator('.port-docks').click();
  await page.getByRole('button', { name: 'Retire…' }).click();
  await expect(page.locator('.career-score')).toContainText('Trade fame');
  await expect(page.locator('.career-total')).toContainText('the next fate at');
  await page.screenshot({ path: 'test-results/retire-confirm.png' });
  await page.getByRole('button', { name: 'Not yet' }).click();
  await expect(page.locator('.career-score')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retire…' }).click();
  await page.getByRole('button', { name: 'Retire now' }).click();
  // The fate's painting, what became of him, and the score.
  await expect(page.locator('.ending .moment-title')).toHaveText('A beggar on the quays of Port Royal');
  await expect(page.locator('.ending-number')).toHaveText(/^\d+$/);
  await page.screenshot({ path: 'test-results/retired.png' });
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { retired?: unknown }).retired)).toBeTruthy();
  await expect(page.locator('.hud-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new career' }).click();
  await expect(page.locator('.start')).toContainText('Retired:');
  expect(errors).toEqual([]);
});
