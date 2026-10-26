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

/** Let the page draw `n` frames: the renderer and the HUD catch up with a clock the test holds. */
const frames = (page: Page, n = 2) =>
  page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

/** The chart opens close about her ship: the whole Caribbean, to reach a port across it. */
/** One of the HUD's hints at sea ("Enter Port Royal · E"): its key cap is `.k-key`. */
const hint = (page: Page, text: string | RegExp) => page.locator('.hud-prompts .hud-prompt', { hasText: text });
const wholeChart = (page: Page) => page.locator('.chart-zoom').getByRole('button', { name: 'Whole Caribbean' }).click();

const player = (page: Page) =>
  page.evaluate(() => window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number; speed: number });

test('a new career starts docked in port, under-gunned, and the shipwright outfits her', async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await expect(page.locator('.port-name')).toHaveText('Port Royal');
  // The arrival line says what kind of news it is; the ships lying here are said by the date.
  await expect(page.locator('.harbour-news b').first()).toHaveText(/^(Prices|News|Trade):$/);
  await expect(page.locator('.harbour-date')).toContainText('in harbour');
  await openService(page, 'Shipwright');
  // Beside the way out, what there is to spend and to fill: the purse, her guns, her men, the fleet.
  await expect(page.locator('.interior-holdings')).toContainText('1,000 gold');
  await expect(page.locator('.interior-holdings')).toContainText('10 of 18 guns');
  // She is sound, so the shipwright speaks of the room on her gun deck, and his button goes to the guns.
  await expect(page.locator('.shipwright .k-say')).toContainText('room on her deck for 8 more guns');
  // Beneath his word, the mending and careening, each with her state.
  await expect(page.locator('.yard-row').first()).toContainText('hull 85 of 85');
  await page.locator('.shipwright').getByRole('button', { name: 'See the guns' }).click();
  await expect(page.locator('.shipwright-tabs .active')).toHaveText('Fit out');
  await expect(page.locator('.shipwright')).toContainText('Guns 10 of 18');
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await page.locator('.shipwright').getByRole('button', { name: /^Buy 1/ }).click();
  await expect(page.locator('.shipwright')).toContainText('Guns 11 of 18');
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
  // The nations' ports, Tortuga, and a cove drawn from each region of the pirate havens (havens.json).
  await expect(page.locator('.chart-port')).toHaveCount(50);
  // The coves are hidden until found: a new career knows only Tortuga among the havens.
  await expect(page.locator('.chart-port.unknown')).toHaveCount(7);
  await expect(page.locator('.chart-port', { hasText: 'Tortuga' })).toBeVisible();
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
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(page.locator('.hud-order')).toContainText('Course to Cartagena');
  await page.screenshot({ path: 'test-results/assist.png' });
});

test('the title stays up after the loading screen has faded, until a career is chosen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Next: how hard a sea' })).toBeVisible();
  // Past the loading screen's fade (it is gone once faded), which once took the title away with it.
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next: how hard a sea' })).toBeVisible();
});

test('sound starts on the first key, plays, and V mutes it', async ({ page }) => {
  await page.goto('/?pace=1&turn=1');
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  // Then how well she knows the sea: these tests sail as a veteran (the First Voyage has its own).
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await page.locator('.know-card', { hasText: 'I know these waters' }).click();
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
  await page.goto('/?pace=1&turn=1');
  await setSail(page, '/');
  await page.waitForFunction(() => Boolean(window.__corsair));
  // A career opens in port, where the clock stands still: set sail so it runs, and the band strikes up once she is under way.
  await page.keyboard.press('e');
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => Boolean(window.__corsair.audio.levels().nowPlaying), undefined, { timeout: 20_000 });
  const title = await page.evaluate(() => window.__corsair.audio.levels().nowPlaying);
  expect(musicTitles).toContain(title);

  // The real frame loop, not stepped by hand: the clock must keep moving while notes play.
  const tick0 = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  // Meter the band's own bus, not the whole mix: the sea alone drifts between two windows by as much as
  // a gentle tune adds to it, so comparing the whole mix with music on and off was flaky.
  // The meter is real sound, so real time must pass: a second's samples ride over the rests in a tune.
  const bandLevel = async (samples: number) => {
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      sum += await page.evaluate(() => window.__corsair.audio.levels().musicRms);
      await page.waitForTimeout(100);
    }
    return sum / samples;
  };
  // Tunes measure 0.05 to 0.12 here; a band too quiet to hear would be well under this.
  expect(await bandLevel(10)).toBeGreaterThan(0.02);
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBeGreaterThan(tick0 + 20);

  await page.keyboard.press('n');
  expect(await page.evaluate(() => window.__corsair.audio.levels().music)).toBe(false);
  // The music fades out over a moment; once it has, it stays silent.
  await page.waitForFunction(() => window.__corsair.audio.levels().musicRms < 0.001);
  expect(await bandLevel(5)).toBeLessThan(0.001);
  expect(errors).toEqual([]);
});

test('trade loop: dock with E, buy sugar in Bridgetown, sell it dearer in Port Royal', async ({ page }) => {
  // A fixed world keeps the prices checked below the same from run to run.
  const errors = await boot(page, '/?seed=3');
  expect(await page.evaluate(() => window.__corsair.seed)).toBe(3);
  // A new career opens within reach of Port Royal.
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(hint(page, 'Enter Port Royal').locator('.k-key')).toHaveText('E');

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
  // Food is a staple: never worth carrying, so it gets no trade hint.
  await expect(page.locator('tr', { hasText: 'Food' })).not.toContainText('made here');
  // A good's row says one verdict; clicking it says why, how much the market takes included.
  await expect(sugar.locator('.verdict')).not.toHaveText('');
  // Every trade on the row; the sells wait until some is in the hold.
  await expect(sugar.getByRole('button')).toHaveCount(4);
  await expect(sugar.getByRole('button', { name: 'Sell all' })).toBeDisabled();
  await sugar.click();
  await expect(page.locator('.ledger-why')).toContainText('He takes about');
  await sugar.getByRole('button', { name: 'Buy max' }).click();
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
  // The log opens with the command taken.
  await expect(page.locator('.logbook-line').last()).toContainText('Took command of the brig Swallow at Port Royal.');
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
  // A new career picks its flag first: four cards alike in size, each its home port and its wars.
  const flags = page.locator('.flag-card');
  await expect(flags).toHaveCount(4);
  const sizes = await flags.evaluateAll((cards) => cards.map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`));
  expect(new Set(sizes).size).toBe(1);
  await expect(page.locator('.flag-card.picked')).toContainText('Port Royal');
  await expect(page.locator('.flag-card.picked')).toContainText('At war with Spain');
  await page.screenshot({ path: 'test-results/start-flag.png' });
  await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
  // Then its difficulty, each level saying what it changes.
  await page.getByRole('button', { name: 'Rogue' }).click();
  await expect(page.locator('.level-card.picked')).toContainText('the wind shifts in battle');
  await page.screenshot({ path: 'test-results/start-difficulty.png' });
  // Then how well she knows the sea: these tests sail as a veteran (the First Voyage has its own).
  await page.getByRole('button', { name: 'Next: how well you know the sea' }).click();
  await page.locator('.know-card', { hasText: 'I know these waters' }).click();
  await page.getByRole('button', { name: 'Set sail' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  // The governor's letter opens the career, with its first goal.
  const letter = page.locator('.moment-opening');
  await expect(letter).toContainText("Your uncle's brig is yours, with 10 guns and 75 men");
  await expect(letter).toContainText('the Spanish are at war with us');
  // The first goal her purse can pay for (a full battery costs more than she has): her crew.
  await expect(letter.locator('.moment-goal')).toContainText('Sign on a full crew');
  // It says where the goal gets done, and the harbour's own labels make way for it.
  await expect(letter.locator('.moment-goal')).toContainText('the tavern at Port Royal');
  // The career's end in view from its first letter: what she would retire to today, and the next fate up.
  await expect(letter.locator('.moment-fate')).toContainText('If you retired today');
  await expect(letter.locator('.moment-fate')).toContainText('a beggar on the quays of Port Royal · score 10 makes you keeper of a waterfront tavern');
  await expect(page.locator('.harbour-head')).toBeHidden();
  // The loading screen has faded from over it.
  await expect(page.locator('.loading')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/opening-letter.png' });
  await letter.getByRole('button', { name: /To the harbour/ }).click();
  await expect(page.locator('.moment')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(1000);
  expect(await page.evaluate(() => window.__corsair.state.get('difficulty'))).toBe('rogue');
  // The flag is the career's, and its governors know her.
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { nation: string; standing: Record<string, number> }))).toMatchObject({ nation: 'england', standing: { england: 20 } });
  expect(errors).toEqual([]);
});

test("sea chart: a port's card says what it means for you, with the prices last seen there, or that none are known", async ({ page }) => {
  await boot(page);
  await page.keyboard.press('m');
  // The career began in Port Royal, so its prices are known; a port never visited shows none.
  // A crowded name may be hidden; the port's pin always shows, and clicking it does the same.
  await wholeChart(page);
  await page.locator('.chart-dot[title="Tortuga"]').click();
  await expect(page.locator('.chart-card')).toContainText('Prices unknown');

  await page.keyboard.press('m');
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(771 * 2));
  await page.keyboard.press('m');
  await expect(page.locator('.chart-card')).toBeHidden();
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  // What it makes cheap, with the age of the price; every price folded away beneath.
  await expect(page.locator('.chart-card')).toContainText('Rum is cheap');
  await expect(page.locator('.chart-card')).toContainText('All prices, seen 2 days ago');
  await expect(page.locator('.chart-card')).toContainText('Sugar');
  // The card opens beside the port, never over its name.
  const [cardBox, nameBox] = [(await page.locator('.chart-card').boundingBox())!, (await page.locator('.chart-port', { hasText: 'Port Royal' }).boundingBox())!];
  const overlaps = cardBox.x < nameBox.x + nameBox.width && cardBox.x + cardBox.width > nameBox.x && cardBox.y < nameBox.y + nameBox.height && cardBox.y + cardBox.height > nameBox.y;
  expect(overlaps).toBe(false);
  // Her own place is ringed and tagged.
  await expect(page.locator('.chart-you')).toContainText('you');
  await page.screenshot({ path: 'test-results/chart-prices.png' });
  await page.locator('.chart-card').getByRole('button', { name: /Voyages/ }).click();
  await expect(page.locator('.chart-plan')).toBeVisible();
  // Picking a port rings it, draws the way there and says how far, beside the chart in the voyages' place.
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Havana' }).click();
  await expect(page.locator('.chart-card')).toContainText('Prices unknown');
  await expect(page.locator('.chart-plan')).toBeHidden();
  await expect(page.locator('.chart-dot.picked')).toHaveAttribute('title', 'Havana');
  // Spain is at war with England in 1660: her ports are closed to an English captain, and say so.
  await expect(page.locator('.chart-card')).toContainText('Closed to you: Spain is at war with England');
  await expect(page.locator('.chart-port.closed', { hasText: 'Havana' })).toHaveCount(1);
  await expect(page.locator('.chart-port.closed', { hasText: 'Port Royal' })).toHaveCount(0);
  await expect(page.locator('.chart-days')).toContainText('days');
  expect(await page.locator('.chart-preview').getAttribute('points')).not.toBe('');
  // Enter sets the course; Esc goes back to the voyages.
  await page.keyboard.press('Enter');
  await expect(page.locator('.chart-card')).toContainText('Your course');
  await expect(page.locator('.chart-port.selected')).toHaveText(/Havana/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.chart-card')).toBeHidden();

  // The goods filter marks makers and buyers everywhere, with prices only where the captain has been.
  await page.locator('.chart-goods').getByRole('button', { name: 'Sugar' }).click();
  await expect(page.locator('.chart-port', { hasText: 'Bridgetown' }).locator('.chart-mark')).toHaveText('cheap');
  await expect(page.locator('.chart-port', { hasText: 'Port Royal' }).locator('.chart-mark')).toHaveText(/^wanted · \d+$/);
  // The title strip says who is at war in 1660.
  await expect(page.locator('.chart-hint-wars')).toContainText('England–Spain');
  await page.screenshot({ path: 'test-results/chart-sugar.png' });
});

test('harbour scenes: a pirate haven has its own scene, and night falls on it too', async ({ page }) => {
  // Night is some 23,000 ticks of the time of day's slow clock away (calendar.json daylight); ?sky shows the harbour
  // at that hour without running the world there.
  const errors = await boot(page, '/?sky=22');
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
  await page.evaluate(() => window.__corsair.sim.step(1));
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
  // Opposite, what she would retire to today, and one click to the career's score.
  await expect(page.locator('.goals-fate')).toContainText('A beggar on the quays of Port Royal');
  await expect(page.locator('.goals-fate')).toContainText('10 makes you keeper of a waterfront tavern');
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
  // Where each is: the captain at sea, the famous pirates at sea or in port.
  await expect(page.locator('.top-ten li.you')).toContainText('at sea');
  await expect(list.first()).toContainText(/at sea from|in port at|sails from/);
  await expect(page.locator('.top-foot')).toContainText('to make the list');
  await page.screenshot({ path: 'test-results/top-ten.png' });
  expect(errors).toEqual([]);
});

test("treasure maps: the tavern stranger sells a piece, the log draws the map, the chart rings the search, and E digs it up", async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Tavern');
  // He sits in the corner some weeks (the town and the week decide which): wait them out in port.
  const stranger = page.locator('.tavern-person', { hasText: 'Stranger' });
  for (let w = 0; w < 16 && !(await stranger.count()); w++) {
    await page.evaluate(() => window.__corsair.sim.step(7 * 771));
    await frames(page);
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
  // The piece just bought is ringed.
  await expect(moment.locator('.moment-quarters .new')).toHaveCount(1);
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
  await page.keyboard.press('m');
  await expect(page.locator('.chart')).toBeHidden();

  // Off the hoard's own beach (the test knows where it is; the captain only has the ring).
  const hoard = await page.evaluate(() => {
    const famous = window.__corsair.state.get('famous') as Record<string, { hoard?: { landing: [number, number]; value: number } }>;
    const h = Object.values(famous).find((f) => f.hoard)!.hoard!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: h.landing[0], y: h.landing[1] });
    window.__corsair.sim.step(1);
    return h;
  });
  // A goal just done shows first, for 7 seconds; the dig prompt follows, on E (the place's key).
  await expect(hint(page, /^E\s*Dig for .+'s hoard on this coast$/)).toBeVisible({ timeout: 10_000 });
  const tick = await page.evaluate(() => window.__corsair.state.get('tick') as number);
  await page.keyboard.press('e');
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
  await expect(letter.locator('.moment-who')).toHaveText('England and France are at war');
  // Port Royal's governor is party to the war: the letter offers the way in to him.
  await expect(letter.getByRole('button', { name: 'To the governor' })).toBeVisible();
  // An English captain's own war: France's ports close to her, and her warships hunt her once she attacks France's ships.
  await expect(letter.locator('.moment-means')).toContainText("France's ports are closed to you now, and once you attack her ships, her warships will hunt you");
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
  await frames(page, 10);
  expect(await page.evaluate(() => window.__corsair.state.get('tick') as number)).toBe(tick);
  await page.keyboard.press('Enter');
  await expect(moment).toHaveCount(0);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { famousSeen: string[] }).famousSeen)).toContain(famous);
  expect(errors).toEqual([]);
});

test('promotion: merit banked before the letter makes him Major when he buys it, as a ceremony', async ({ page }) => {
  await boot(page, '/?seed=3', { inPort: true });
  // A career with a famous pirate's worth of merit with England already, and no letter yet.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const save = window.__corsair.snapshot.save();
        save.state = { ...save.state, captain: { ...save.state.captain!, merit: { england: 15 }, gold: 100000, marques: [] } };
        const req = indexedDB.open('corsair', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('saves');
        req.onsuccess = () => {
          const tx = req.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(save, 'career');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('/?pace=1&turn=1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => Boolean(window.__corsair));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() => {
    window.__corsair.sim.pause();
    window.__corsair.cmd.send({ type: 'BuyMarque', shipId: 'player' });
    window.__corsair.sim.step(1);
  });
  const moment = page.locator('.moment-promotion');
  await expect(moment.locator('.moment-title')).toHaveText('Major');
  // The ladder: the letter and Captain passed on the way, Major his, the rest ahead.
  await expect(moment.locator('.promo-rung.passed')).toHaveCount(2);
  await expect(moment.locator('.promo-rung.new')).toHaveText('Major');
  await expect(moment.locator('.promo-perk')).toHaveCount(3);
  await expect(moment.locator('.promo-perk').first()).toContainText('Repairs 20% cheaper');
  await expect(moment.locator('.promo-perk').last()).toContainText('Upgrades 20% cheaper');
  await expect(moment.locator('.promo-next')).toContainText('Next: Colonel');
  await page.screenshot({ path: 'test-results/moment-promotion.png' });
  await page.keyboard.press('Enter');
  await expect(page.locator('.moment')).toHaveCount(0);
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
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  await expect(page.locator('.chart-rumour')).toContainText('run short of sugar');
  // Back to the voyages: the planner lists the contract she has heard of.
  await page.keyboard.press('Escape');
  await expect(page.locator('.chart-plan')).toContainText('Contracts you have heard of');
  await expect(page.locator('.chart-plan')).toContainText('sugar for Port Royal: buy at');
  await page.screenshot({ path: 'test-results/contract-plan.png' });
  expect(errors).toEqual([]);
});

test('leaving port: E sets sail back to the sea view, pointing out of the harbour', async ({ page }) => {
  // The game runs here (no pause), as a player has it. A new career opens docked in Port Royal.
  await page.goto('/?seed=3&pace=1&turn=1');
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
  await expect.poll(() => page.evaluate(() => window.__corsair.wildlife.count)).toBeGreaterThan(5);
  await page.screenshot({ path: 'test-results/wildlife.png' });
  expect(errors).toEqual([]);
});

test('ships at sea: AI ships sail, a ship alongside can be hailed, and the chart marks ships seen', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const count = await page.evaluate(() => Object.values(window.__corsair.state.get('ships') as Record<string, { ai?: unknown }>).filter((s) => s.ai).length);
  // The population (traffic.json, 90) split by role share, each rounded: 50 merchants, 16 patrols, 23 pirates.
  expect(count).toBe(89);

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
  await expect(hint(page, 'Hail the English fluyt').locator('.k-key')).toHaveText('F');
  // Her nation, name and what she is ride under her on the 3D sea.
  const label = page.locator('.ship-label', { hasText: 'fluyt, merchant' });
  await expect(label).toBeVisible();
  await expect(label.locator('.ship-label-tag')).toHaveText(/english/i);
  await page.keyboard.press('f');
  await expect(page.locator('.hail')).toContainText('bound for Cartagena');
  // The sea's prompt and HUD make way for the hail.
  await expect(page.locator('.hud-prompt')).toBeHidden();
  // Firing on a nation's ship is allowed, with a warning of what it costs.
  await expect(page.locator('.hail-attack')).toContainText('angers the English');
  // Her captain speaks on a card, his bust beside it.
  await expect(page.locator('.hail .k-bust')).toBeVisible();
  await page.screenshot({ path: 'test-results/hail.png' });
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'Hailed' }).length)).toBe(1);
  await page.keyboard.press('Escape');
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
  await page.keyboard.press('f');
  await expect(page.locator('.hail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  await expect(page.locator('.battle-card').first()).toContainText('Hull');
  // A new career's ship sails under her own name; the gun bar is one row, with F1 for every key.
  await expect(page.locator('.battle-card').first()).toContainText('Swallow');
  await expect(page.locator('.battle-guns .battle-help')).toContainText('keys');
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
  // The after-action report says what the fight changed; with a prize, her hold and her fate are on the same screen.
  await expect(page.locator('.battle-report-body')).toBeVisible();
  await expect(page.locator('.battle-standing')).toContainText('England (for the attack) -20');
  // A painting when she got away or went down; with a prize, her hold takes its place.
  if (outcome !== 'struck' && outcome !== 'boarded') await expect(page.locator('.battle-report-picture')).toBeVisible();
  // The hull, sails and men say how they are in words.
  await expect(page.locator('.battle-report-title')).not.toHaveText('');
  // The ship cards make way for the report, which says how her own ship came out of it.
  await expect(page.locator('.battle-card')).toHaveCount(0);
  await expect(page.locator('.battle-ledger')).toContainText('Your ship: hull');
  await page.screenshot({ path: 'test-results/battle-report.png' });
  if (outcome === 'struck' || outcome === 'boarded') {
    // One button does the sensible thing, saying what that means: she is kept when keeping her is best, else a
    // merchant is let go.
    if (await page.locator('.fate-keep.best').count()) {
      await expect(page.locator('.plunder-go')).toContainText(/into the fleet · Enter/i);
      await page.locator('.fate-release').click();
    }
    await expect(page.locator('.plunder-go')).toContainText(/let her go · Enter/i);
    await expect(page.locator('.plunder')).toContainText('thinks a little better of you');
    // Each fate is a card that says what it costs.
    await expect(page.locator('.fate-sink')).toContainText('England');
    await expect(page.locator('.fate-keep')).toContainText('sells for about');
    expect(await page.evaluate(() => window.__corsair.state.get('prize'))).toBeDefined();
    await page.screenshot({ path: 'test-results/plunder.png' });
  }
  // Enter takes the best of her hold and lets her go, or with no prize carries on.
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => window.__corsair.log.query({ type: 'BattleOver' }).length)).toBe(1);
  // Firing on an English ship cost standing with England (less the goodwill for letting a prize go), from the
  // 20 an English captain starts with.
  const england = await page.evaluate(() => (window.__corsair.state.get('captain') as { standing: Record<string, number> }).standing.england);
  expect(england).toBe(20 + (outcome === 'struck' || outcome === 'boarded' ? -20 + 2 : -20));
  expect(errors).toEqual([]);
});

test('a pirate who means to board: the warning, the repel window on the grapple bar, and R throws them back', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'pirate', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: { role: string } }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai?.role === 'pirate').sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    // Out to open water first: by the coast she would spend the fight shying off the land.
    window.__corsair.sim.step(1500);
    const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + 1.5, y: s.y });
    window.__corsair.sim.step(1);
  });
  // Alongside, she falls on her (a hunter closing won't stop to talk).
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__corsair.sim.step(1));
      return page.evaluate(() => window.__corsair.view());
    })
    .toBe('battle');
  // Lying hove to (sails furled), she cripples the rig and comes in to board: warned before the grapples bite.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('s');
    await page.evaluate(() => window.__corsair.battle.step(1));
  }
  expect(await page.evaluate(() => window.__corsair.battle.state()!.ships.player.sails)).toBe('furled');
  // The keys started the sound: the combat clips load with the rest (cannon, the boarders' fight, the cheer).
  await page.waitForFunction(() => window.__corsair.audio.levels().samplesReady, undefined, { timeout: 20_000 });
  const clips = await page.evaluate(() => window.__corsair.audio.levels().sfx);
  for (const id of ['cannon_close', 'cannon_far', 'ball_whistle', 'wood_hit', 'sail_tear', 'mast_crack', 'musket', 'melee', 'shouts', 'cheer', 'explosion']) expect(clips).toContain(id);
  const until = (what: string) =>
    page.evaluate((w) => {
      for (let i = 0; i < 30 * 900; i++) {
        const s = window.__corsair.battle.state()!;
        if (window.__corsair.battle.result() || (w === 'intent' ? s.enemyBoarding && s.grappling === 0 : s.grappling > 0)) return;
        window.__corsair.battle.step(1);
      }
    }, what);
  await until('intent');
  await frames(page);
  await expect(page.locator('.battle-boarder')).toContainText('She means to board!');
  await page.screenshot({ path: 'test-results/boarder.png' });
  await until('grapple');
  await frames(page);
  await expect(page.locator('.battle-grapple')).toContainText('Repel boarders: R');
  await expect(page.locator('.battle-repel-window')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/grapple.png' });
  // Into the gold, then R: the grapples are cut and she sheers off.
  const window_ = await page.evaluate(() => {
    const seconds = 3;
    for (let i = 0; i < 30 * seconds; i++) {
      const s = window.__corsair.battle.state()!;
      const w = (document.querySelector('.battle-repel-window') as HTMLElement | null)?.style.width;
      if (w && s.grappling / seconds >= 1 - (parseFloat(w) / 100) * 0.5) return w;
      window.__corsair.battle.step(1);
    }
    return undefined;
  });
  expect(window_).toBeTruthy();
  await page.keyboard.press('r');
  await page.evaluate(() => window.__corsair.battle.step(1));
  await frames(page);
  await expect(page.locator('.battle-repel')).toContainText('Boarders repelled!');
  expect(await page.evaluate(() => window.__corsair.battle.state()!.grappling)).toBe(0);
  expect(errors).toEqual([]);
});

test("missions: the governor offers work once his letter is settled, and the mission in hand is the sea's goal, in the log and on the chart", async ({ page }) => {
  const errors = await boot(page, '/?seed=3', { inPort: true });
  await openService(page, 'Governor');
  // One offer at a time: his letter first; turn it down and he has work instead.
  await page.locator('.governor-offer').getByRole('button', { name: 'Not now' }).click();
  const offer = page.locator('.governor-offer');
  await expect(offer).toContainText('The work stands 10 weeks');
  await page.screenshot({ path: 'test-results/governor-mission.png' });
  await offer.getByRole('button', { name: 'Accept' }).click();
  const mission = await page.evaluate(() => (window.__corsair.state.get('captain') as { missions: { kind: string; name?: string }[] }).missions[0]!);
  // Taken, it is not offered again this week.
  await expect(page.locator('.governor-offer')).toHaveCount(0);
  await page.keyboard.press('l');
  await page.locator('.log-mark', { hasText: 'Goals' }).click();
  await expect(page.locator('.log')).toContainText('Missions');
  await expect(page.locator('.log .goal', { hasText: mission.kind === 'hunt' ? 'Hunt the pirate' : 'Carry the governor' })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/log-missions.png' });
  await page.keyboard.press('l');

  // At sea the pill says the mission, and a hunt's waters are ringed on the chart.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await frames(page);
  await expect(page.locator('.hud-goal')).toContainText('Mission');
  await page.screenshot({ path: 'test-results/sea-mission.png' });
  if (mission.kind === 'hunt') {
    await page.keyboard.press('m');
    await expect(page.locator('.chart-ring-label')).toContainText(`The ${mission.name}: hunt here`);
    await page.screenshot({ path: 'test-results/chart-mission.png' });
    await page.keyboard.press('m');
  }
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
  // His rank shows as the whole ladder, the letter his first rung.
  await expect(page.locator('.rank-ladder li')).toHaveCount(8);
  await expect(page.locator('.rank-ladder li.now')).toHaveText('Letter of marque');
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
  await page.keyboard.press('f');
  await expect(page.locator('.hail-attack')).toContainText('lawful under your English letter');
  await page.locator('.hail').getByRole('button', { name: /Attack/ }).click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  await expect(page.locator('.battle-report-body')).toBeVisible();
  // The report, or the victory screen when she was taken: Enter through to the sea.
  for (let i = 0; i < 3 && (await page.evaluate(() => window.__corsair.view())) === 'battle'; i++) {
    await page.keyboard.press('Enter');
    await frames(page);
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

test('a fight shakes the camera at each broadside and dips the sea under the guns; the shake can be turned off', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'pirate', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ships = window.__corsair.state.get('ships') as Record<string, { x: number; y: number; ai?: { role: string } }>;
    const id = Object.keys(ships).filter((k) => ships[k]!.ai?.role === 'pirate').sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(1500);
    const s = (window.__corsair.state.get('ships') as typeof ships)[id]!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: s.x + 1.5, y: s.y });
    window.__corsair.sim.step(1);
  });
  await expect
    .poll(async () => {
      await page.evaluate(() => window.__corsair.sim.step(1));
      return page.evaluate(() => window.__corsair.view());
    })
    .toBe('battle');
  // A key starts the sound (half sail, which changes nothing that matters here).
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.__corsair.audio.levels().state === 'running');
  // The first broadside shakes the camera. A few ticks at a time with a frame between, as in play: a long burst of
  // ticks would make the next frame's step so long that a light shake is gone within it.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.__corsair.battle.step(5));
        await frames(page, 1);
        return page.evaluate(() => window.__corsair.battle.shaking());
      },
      { timeout: 60_000, intervals: [0] },
    )
    .toBeGreaterThan(0);
  // A broadside dips the sea's bed under it, and the bed comes back.
  await page.evaluate(() => window.__corsair.audio.battle.broadside(8, 0, 1));
  await page.waitForFunction(() => window.__corsair.audio.levels().duck < 0.5, undefined, { timeout: 2_000 });
  await page.waitForFunction(() => window.__corsair.audio.levels().duck > 0.95, undefined, { timeout: 5_000 });
  // Still: the button turns it off, and the choice is kept.
  const button = page.getByRole('button', { name: 'Camera shake' });
  await expect(button).toHaveText('Shake');
  await button.click();
  await frames(page);
  await expect(button).toHaveText('Still');
  expect(await page.evaluate(() => localStorage.getItem('corsair.shake'))).toBe('off');
  await page.screenshot({ path: 'test-results/battle-shake.png' });
  expect(errors).toEqual([]);
});

test('the gentle wind: a HUD toggle puts it on her ship, and the choice is kept for the next career', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const button = page.getByRole('button', { name: 'Gentle wind' });
  await expect(button).toHaveText('Real');
  await button.click();
  // A frame puts it on her ship; the next step carries the order out.
  await frames(page);
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect(button).toHaveText('Gentle');
  expect(await page.evaluate(() => (window.__corsair.state.get('ships.player') as { gentleWind?: boolean }).gentleWind)).toBe(true);
  await page.screenshot({ path: 'test-results/gentle-wind.png' });
  // Kept in this browser: a new career starts with it on.
  await boot(page, '/?seed=4');
  await frames(page);
  await expect(page.getByRole('button', { name: 'Gentle wind' })).toHaveText('Gentle');
  expect(errors).toEqual([]);
});

test('sailing: cruises at 2x, calls a sail in sight (dropping to 1x only when set to slow), F intercepts', async ({ page }) => {
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
  // Where she lies from the bow, and the key to go after her: F.
  await expect(page.locator('.hud-banner')).toContainText(/dead ahead|astern|(bow|beam|quarter)/);
  await expect(page.locator('.hud-banner')).toContainText('chase');
  await expect(page.locator('.hud-banner .hud-banner-key .k-key')).toHaveText('F');
  // Cruising keeps its speed unless the player asks it to slow near land and sails; then it holds at 1x (here the
  // coast may hold it too: either reason drops it).
  const holds = page.getByRole('button', { name: 'Slow near land and sails' });
  await expect(holds).toHaveText('Steady');
  await expect(page.locator('.hud-date').first()).not.toContainText('1×,');
  await holds.click();
  await frames(page);
  await expect(holds).toHaveText('Slows');
  await expect(page.locator('.hud-date').first()).toContainText('1×,');
  // Space has no order to sail (no course, no chase): it does nothing; F goes after her.
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toBeUndefined();
  await page.keyboard.press('f');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'intercept', targetId: target });
  // The chase is her order now, across the top.
  const name = await page.evaluate((id) => (window.__corsair.state.get('ships') as Record<string, { ai: { name: string } }>)[id]!.ai.name, target);
  await expect(page.locator('.hud-order')).toContainText(`Chasing the ${name}`);
  await expect(page.locator('.hud-order')).toContainText('sailing it');

  expect(errors).toEqual([]);
});


test('the ship key: Sail ho! picks her, F chases her down and she is hailed alongside; Tab, a click on her label and a pad do the same', async ({ page }) => {
  // A pad whose X button (F at sea) the test holds: the game reads it each frame as the browser's standard mapping.
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    (window as unknown as { padX: (on: boolean) => void }).padX = (on) => Object.assign(buttons[2]!, { pressed: on, value: on ? 1 : 0 });
    navigator.getGamepads = () => [{ id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 } as unknown as Gamepad];
  });
  const errors = await boot(page, '/?seed=3');
  // A merchant out of Port Royal, a few hours on her way, with the player some tiles off her.
  const target = await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ids = Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.'));
    const id = ids.sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.sim.step(771 / 4);
    const at = (window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[id]!;
    for (const [dx, dy] of [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, -6]]) {
      window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: at.x + dx!, y: at.y + dy! });
      window.__corsair.sim.step(1);
      const p = window.__corsair.state.get('ships.player') as { x: number; y: number };
      if (Math.hypot(p.x - at.x, p.y - at.y) < 12) break;
    }
    return id;
  });
  await frames(page);
  // Called out, she is the ship picked: her card says who and where, and F chases her (its button names the key).
  await expect(page.locator('.hud-picked')).toBeVisible();
  await expect(hint(page, 'Chase the').locator('.k-key')).toHaveText('F');
  await expect(page.locator('.hud-picked .k-btn.primary')).toContainText('Chase her');
  await expect(page.locator('.hud-picked .k-btn.primary .k-key')).toHaveText('F');
  await page.screenshot({ path: 'test-results/sea-picked.png' });
  // Esc lets her go; Tab picks a ship in sight again, and a click on her label picks her.
  await page.keyboard.press('Escape');
  await frames(page);
  await expect(page.locator('.hud-picked')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await frames(page);
  await expect(page.locator('.hud-picked')).toBeVisible();
  const name = await page.evaluate((id) => (window.__corsair.state.get('ships') as Record<string, { ai: { name: string } }>)[id]!.ai.name, target);
  await page.locator('.ship-label', { hasText: name }).locator('.ship-label-box').click();
  await frames(page);
  await expect(page.locator('.hud-picked')).toContainText(name);
  await expect(page.locator('.ship-label.picked')).toContainText(name);
  // A click on the ship herself picks her too: on her hull, or up in her sails; on open water, she is let go.
  const at = await page.evaluate((id) => {
    const s = (window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[id]!;
    return (window as unknown as { __corsair3d: { project: (x: number, y: number) => { px: number; py: number } } }).__corsair3d.project(s.x, s.y);
  }, target);
  await page.mouse.click(at.px + 300, at.py - 200);
  await frames(page);
  await expect(page.locator('.hud-picked')).toHaveCount(0);
  await page.mouse.click(at.px, at.py);
  await frames(page);
  await expect(page.locator('.hud-picked')).toContainText(name);
  await page.keyboard.press('Escape');
  await page.mouse.click(at.px + 5, at.py - 60);
  await frames(page);
  await expect(page.locator('.hud-picked')).toContainText(name);
  // The pad's X does what F does: she chases her.
  await page.evaluate(() => (window as unknown as { padX: (on: boolean) => void }).padX(true));
  await frames(page, 3);
  await page.evaluate(() => (window as unknown as { padX: (on: boolean) => void }).padX(false));
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'intercept', targetId: target });
  // The chase comes up alongside her and hails her: the hail opens of itself.
  await page.evaluate(async () => {
    for (let i = 0; i < 1500 && !document.querySelector('.hail'); i++) {
      window.__corsair.sim.step(2);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await expect(page.locator('.hail')).toContainText(name);
  await page.screenshot({ path: 'test-results/sea-alongside.png' });
  // Parting ways ends the chase: she doesn't shadow her, and it is no longer her order.
  await page.keyboard.press('Escape');
  await expect(page.locator('.hail')).toHaveCount(0);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toBeUndefined();
  await frames(page);
  await expect(page.locator('.hud-order')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the chart zooms and pans: opens close about her ship, the wheel and + and - zoom it, a drag pans without picking a port, and a course says its days and food', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  // How far apart two sea points ten tiles apart are drawn: the 3D view's zoom.
  const seaZoom = () =>
    page.evaluate(() => {
      const me = window.__corsair.state.get('ships.player') as { x: number; y: number };
      const p3 = (window as unknown as { __corsair3d: { project: (x: number, y: number) => { px: number; py: number } } }).__corsair3d;
      const [a, b] = [p3.project(me.x, me.y), p3.project(me.x + 10, me.y)];
      return Math.hypot(b.px - a.px, b.py - a.py);
    });
  const speed = page.getByRole('button', { name: 'Cruise speed' });
  const cruise = await speed.textContent();
  await frames(page, 3);
  const sea = await seaZoom();
  await page.keyboard.press('m');
  const frame = page.locator('.chart-frame');
  const sheet = page.locator('.chart-sheet');
  const width = async () => (await sheet.boundingBox())!.width;
  const box = (await frame.boundingBox())!;
  // Close in, about her: the sheet twice the frame, her mark near its middle.
  expect(await width()).toBeCloseTo(box.width * 2, -1);
  const you = (await page.locator('.chart-you').boundingBox())!;
  expect(Math.abs(you.x + you.width / 2 - (box.x + box.width / 2))).toBeLessThan(box.width / 4);
  // The wheel zooms the chart (not the sea behind it), and so do + and - (not the cruise speed).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await frames(page);
  const closer = await width();
  expect(closer).toBeGreaterThan(box.width * 2.5);
  await page.screenshot({ path: 'test-results/chart-zoomed.png' });
  await page.keyboard.press('-');
  await frames(page);
  expect(await width()).toBeLessThan(closer);
  await page.keyboard.press('=');
  await frames(page);
  expect(await width()).toBeCloseTo(closer, -1);
  // A drag pans, and the click that ends it picks no port.
  const before = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 - 120, { steps: 6 });
  await page.mouse.up();
  await frames(page);
  const after = (await sheet.boundingBox())!;
  expect(before.x - after.x).toBeGreaterThan(150);
  await expect(page.locator('.chart-card')).toBeHidden();
  // The whole Caribbean: the sheet fills the frame again.
  await wholeChart(page);
  await frames(page);
  expect(await width()).toBeCloseTo(box.width, -1);
  // A port's card says the days at sea and whether her food lasts them; so does the course on the sea.
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await expect(page.locator('.chart-card')).toContainText(/Food for \d+ days/);
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await expect(page.locator('.hud-order')).toContainText(/Course to Cartagena · \d+ km · (about \d+ days?|within the day)/);
  expect(await seaZoom()).toBeCloseTo(sea, 0);
  await expect(speed).toHaveText(cruise!);
  await page.screenshot({ path: 'test-results/chart-course-days.png' });
  expect(errors).toEqual([]);
});

test('courses and clicks together: a chart course, a ship clicked, open water, Space, F and Esc, and a port clicked at sea', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  const order = page.locator('.hud-order');
  const assist = () => page.evaluate(() => window.__corsair.state.get('ships.player.assist') as { mode: string; portId?: string; targetId?: string } | undefined);
  // Open water south of Jamaica, a course to Cartagena plotted on the chart.
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('m');
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await frames(page);
  // Nothing picked yet (or only called out): the course is her order, waiting on Space.
  await page.keyboard.press('Escape');
  await frames(page);
  await expect(order).toContainText('Course to Cartagena');
  await expect(order).toContainText('paused');
  await expect(hint(page, 'Sail the course to Cartagena').locator('.k-key')).toHaveText('Space');

  // A merchant a few tiles off, clicked: F's hint is hers, beside Space's for the course; the course stays plotted.
  const ship = await page.evaluate(() => {
    const me = window.__corsair.state.get('ships.player') as { x: number; y: number };
    window.__corsair.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    window.__corsair.sim.step(1);
    const ids = Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.'));
    const id = ids.sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: id, x: me.x + 6, y: me.y });
    window.__corsair.sim.step(1);
    return id;
  });
  await frames(page);
  const shipAt = () =>
    page.evaluate((id) => {
      const s = (window.__corsair.state.get('ships') as Record<string, { x: number; y: number }>)[id]!;
      return (window as unknown as { __corsair3d: { project: (x: number, y: number) => { px: number; py: number } } }).__corsair3d.project(s.x, s.y);
    }, ship);
  let at = await shipAt();
  await page.mouse.click(at.px, at.py);
  await frames(page);
  await expect(page.locator('.hud-picked')).toBeVisible();
  await expect(hint(page, 'Chase the').locator('.k-key')).toHaveText('F');
  await expect(hint(page, 'Sail the course to Cartagena')).toBeVisible();
  await expect(order).toContainText(/Course to Cartagena · \d+ km/);
  // Open water lets her go: only the course's hint is left.
  await page.mouse.click(at.px - 400, at.py + 250);
  await frames(page);
  await expect(page.locator('.hud-picked')).toHaveCount(0);
  await expect(hint(page, 'Chase the')).toHaveCount(0);
  await expect(hint(page, 'Sail the course to Cartagena')).toBeVisible();

  // Space sails the course; a click on her changes nothing, nor does Space again (it never turns anything off).
  // F chases her; Esc lets her go, and the course is taken up again of itself.
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await assist()).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await frames(page);
  await expect(order).toContainText('sailing it');
  await expect(hint(page, 'Sail the course')).toHaveCount(0);
  at = await shipAt();
  await page.mouse.click(at.px, at.py);
  await frames(page);
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await assist()).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await assist()).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await page.keyboard.press('f');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await assist()).toMatchObject({ mode: 'intercept', targetId: ship });
  const name = await page.evaluate((id) => (window.__corsair.state.get('ships') as Record<string, { ai: { name: string } }>)[id]!.ai.name, ship);
  await frames(page);
  await expect(order).toContainText(`Chasing the ${name}`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await frames(page);
  expect(await assist()).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await expect(order).toContainText('Course to Cartagena');
  await expect(order).toContainText('sailing it');
  await expect(page.locator('.hud')).toContainText('back on course for Cartagena');

  // Off Port Royal, out of docking reach: a click on its name plots the course there instead, on the chart too.
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 2, y: pr.y + 12 });
    window.__corsair.sim.step(1);
  });
  await frames(page, 3);
  const port = await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    return (window as unknown as { __corsair3d: { project: (x: number, y: number) => { px: number; py: number } } }).__corsair3d.project(pr.x, pr.y);
  });
  await page.mouse.click(port.px, port.py - 90);
  await frames(page);
  await expect(order).toContainText(/Course to Port Royal · \d+ km/);
  await expect(hint(page, 'Sail the course to Port Royal').locator('.k-key')).toHaveText('Space');
  await page.keyboard.press('m');
  await expect(page.locator('.chart-port.selected')).toHaveText('Port Royal');
  await page.keyboard.press('m');
  // Sailed, she makes port, and the course and the chart's mark are gone.
  await page.keyboard.press(' ');
  const docked = await page.evaluate(async () => {
    for (let i = 0; i < 1500; i++) {
      window.__corsair.sim.step(2);
      await new Promise((r) => requestAnimationFrame(r));
      if (window.__corsair.state.get('ships.player.docked')) return true;
    }
    return false;
  });
  expect(docked).toBe(true);
  await expect(page.locator('.chart-port.selected')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('course line: a port picked on the chart gets a route by sea, the HUD measures it, and Space follows it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1050 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('m');
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Cartagena' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  // The route is re-plotted about once a second; her order across the top reads its length and days.
  const order = page.locator('.hud-order');
  await expect(order).toContainText(/Course to Cartagena · \d+ km · (about \d+ days?|within the day)/);
  await expect(order).toContainText('paused');
  await expect(hint(page, 'Sail the course to Cartagena').locator('.k-key')).toHaveText('Space');
  await page.screenshot({ path: 'test-results/course-line.png' });
  await page.keyboard.press(' ');
  await page.evaluate(() => window.__corsair.sim.step(1));
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toMatchObject({ mode: 'course', portId: 'town.cartagena' });
  await expect(order).toContainText('sailing it');
  // Steering by hand takes the helm back (it only pauses the order); the route stays plotted.
  await page.keyboard.down('a');
  await page.evaluate(() => window.__corsair.sim.step(2));
  await page.keyboard.up('a');
  expect(await page.evaluate(() => window.__corsair.state.get('ships.player.assist'))).toBeUndefined();
  await expect(order).toContainText('paused');
  await expect(hint(page, 'Sail the course to Cartagena')).toBeVisible();
  // The order's cross forgets the course: no order, no hint, nothing on the chart.
  await order.locator('.hud-order-cancel').click();
  await expect(order).toHaveCount(0);
  await expect(hint(page, 'Sail the course')).toHaveCount(0);
  await page.keyboard.press('m');
  await expect(page.locator('.chart-port.selected')).toHaveCount(0);
  await page.keyboard.press('m');
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
  // Signing on says what her guns want of her crew, and how many men look for a berth in this port.
  await expect(page.locator('.recruit .k-tag')).not.toHaveText('');
  await expect(page.locator('.recruit')).toContainText(/\d+ men look for a berth here/);
  // Nothing taken yet: the chest is empty, but three days' wages are owed.
  await expect(page.locator('.crew-pay').getByRole('button', { name: /Divide the plunder/ })).toBeDisabled();
  const pay = page.locator('.crew-pay').getByRole('button', { name: /Pay wages/ });
  const owed = Number((await pay.textContent())!.match(/(\d+) gold/)![1]);
  expect(owed).toBeGreaterThan(0);
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await pay.click();
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBe(gold - owed);
  await expect(page.locator('.crew-pay')).toContainText('0 days since they were last paid');
  await page.screenshot({ path: 'test-results/crew-pay.png' });
  expect(errors).toEqual([]);
});

test('a pirate falls on a merchant within sight: they heave to and fight it out, and the HUD calls it', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // The player in open water south of Jamaica; a merchant and a pirate put down further south, the pirate
  // beyond seeing the player but in sight of the merchant. The merchant runs north past her, so they meet within
  // her sight whatever the weather (a fight past it is settled out of sight).
  const ids = await page.evaluate(() => {
    const last = () => Object.keys(window.__corsair.state.get('ships') as object).filter((k) => k.startsWith('ai.')).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: 1320, y: 1035 });
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
  await wholeChart(page);
  await page.locator('.chart-port', { hasText: 'Port Royal' }).click();
  await page.locator('.chart-card').getByRole('button', { name: 'Set course' }).click();
  await page.keyboard.press('m');
  await page.keyboard.press(' ');
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

test('a fleet leaves port in line: each ship comes out behind the flagship over open water, never over the land', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A prize kept (as the fleets test takes her), then into Port Royal with her.
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
  await page.keyboard.press('f');
  await expect(page.locator('.hail')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
  });
  await page.locator('.fate-keep').click();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { fleet?: unknown[] }).fleet?.length)).toBe(1);
  await page.evaluate(() => {
    const pr = window.__corsair.ports().find((p) => p.name === 'Port Royal')!;
    window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x: pr.x + 1, y: pr.y + 2 });
    window.__corsair.sim.step(1);
  });
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('harbour');
  // Out of port, the two of them.
  await page.keyboard.press('e');
  const seen = await page.evaluate(async () => {
    const land: boolean[] = [];
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'full' });
    for (let i = 0; i < 120; i++) {
      window.__corsair.sim.step(4);
      await new Promise((r) => requestAnimationFrame(r));
      const drawn = (window as unknown as { __corsair3d: { shipsDrawn: { id: string; x: number; y: number }[] } }).__corsair3d.shipsDrawn;
      const c = drawn.find((d) => d.id.startsWith('player~'));
      if (c) land.push(window.__corsair.land(c.x, c.y));
    }
    return land;
  });
  // She came out with her, and was never drawn over the land.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter(Boolean)).toEqual([]);
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
  await page.keyboard.press('f');
  await page.locator('.hail').getByRole('button', { name: /Attack/ }).click();
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('battle');
  const outcome = await page.evaluate(() => {
    for (let i = 0; i < 600 && !window.__corsair.battle.result(); i++) window.__corsair.battle.step(30, 'aggressive');
    return window.__corsair.battle.result()?.outcome;
  });
  // The fight is the same every run (a fixed world, a held clock, a battle seeded from both), and it ends with her
  // taken: were it ever to end otherwise, this test would say so rather than skip.
  expect(outcome).toMatch(/^(boarded|struck)$/);
  await page.locator('.fate-keep').click();
  await expect(page.locator('.plunder')).toContainText('joins your fleet');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__corsair.view())).toBe('sea');
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { fleet?: unknown[] }).fleet?.length)).toBe(1);
  // At sea she sails in company: drawn astern of the flagship, on her track, and following her as she goes.
  type Drawn = { id: string; x: number; y: number }[];
  const drawn = () => page.evaluate(() => (window as unknown as { __corsair3d: { shipsDrawn: Drawn } }).__corsair3d.shipsDrawn);
  await page.evaluate(async () => {
    window.__corsair.cmd.send({ type: 'SetSails', shipId: 'player', sails: 'full' });
    for (let i = 0; i < 60; i++) {
      window.__corsair.sim.step(4);
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  const me = await page.evaluate(() => window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number });
  const consort = (await drawn()).find((d) => d.id.startsWith('player~'));
  expect(consort).toBeDefined();
  const apart = Math.hypot(consort!.x - me.x, consort!.y - me.y);
  expect(apart).toBeGreaterThan(1);
  expect(apart).toBeLessThan(15);
  // Astern: behind her heading, not ahead of it.
  const r = (me.headingDeg * Math.PI) / 180;
  expect((consort!.x - me.x) * Math.sin(r) - (consort!.y - me.y) * Math.cos(r)).toBeLessThan(0);
  await page.screenshot({ path: 'test-results/fleet-at-sea.png' });
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
  // The harbour says where the prize is dealt with, and the shipwright's badge counts her.
  await expect(page.locator('.harbour-news')).toContainText('at the shipwright');
  await expect(page.locator('.port-spot', { hasText: 'Shipwright' }).locator('.spot-badge')).toHaveText('1');
  // The log's Fleet page: her state, read only.
  await page.getByRole('button', { name: /^Log/ }).click();
  await page.locator('.log-tabs').getByRole('button', { name: 'Fleet' }).click();
  await expect(page.locator('.fleet-row:not(.flagship)')).toContainText('fluyt');
  await expect(page.locator('.log-book')).toContainText('the shipwright mends, fits, swaps and sells them');
  // The harbour's own labels make way for the open book.
  await expect(page.locator('.harbour-head')).toBeHidden();
  await page.screenshot({ path: 'test-results/fleet-log.png' });
  await page.keyboard.press('l');
  // The shipwright: a card a ship, each with her own orders; fitting her out picks her.
  await openService(page, 'Shipwright');
  const prize = page.locator('.yard-ship:not(.flagship)');
  await expect(prize).toContainText('fluyt');
  const name = await prize.locator('b').innerText();
  await prize.getByRole('button', { name: 'Fit out' }).click();
  await expect(page.locator('.yard-fitting .active')).toHaveText(name);
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Your ships' }).click();
  const gold = await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold);
  await prize.getByRole('button', { name: /^Sell/ }).click();
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { gold: number }).gold)).toBeGreaterThan(gold);
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { fleet?: unknown[] }).fleet?.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('ships change hands: a pirate takes your fleet ship, and hailing him says she is yours in his tow', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // Fights are settled straight through the sim here (the battle itself has its own tests): one won to keep a
  // merchant, one lost to a pirate. Winning her back is the traffic system's (hunt.test.ts).
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
  // Her first prize is a deed card that stays until dismissed.
  await expect(page.locator('.deed-standard .deed-title')).toHaveText('First prize taken');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    window.__corsair.cmd.send({ type: 'TakePlunder', shipId: 'player', take: {}, volunteers: false, release: false, keep: true } as never);
    window.__corsair.sim.step(1);
  });
  const [kept] = await fleet();
  expect(kept).toBeTruthy();

  const pirate = await alongside('pirate', 'town.tortuga', 'town.port_royal');
  await settle(pirate, 'lost');
  expect(await fleet()).toEqual([]);
  // At sea, hailing her (F) says the prize she has in tow is yours.
  await page.keyboard.press('f');
  await expect(page.locator('.hail')).toContainText(`your fluyt ${kept}`);
  await page.screenshot({ path: 'test-results/prize-in-tow.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.hail')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the shipyard: new ships for sale, and why one can\'t be bought yet', async ({ page }) => {
  const errors = await boot(page, '/?seed=3');
  // A new career starts in Port Royal's harbour, a city: its yard builds most classes.
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  await openService(page, 'Shipwright');
  await page.locator('.shipwright-tabs').getByRole('button', { name: 'Ships for sale' }).click();
  const yard = page.locator('.ships-for-sale');
  await expect(yard).toContainText('war sloop');
  await expect(yard).toContainText('merchantman');
  await expect(yard).not.toContainText('galleon');
  await page.screenshot({ path: 'test-results/shipyard.png' });
  // A new career's purse (1,000 gold) buys no ship yet, and the button says so (buying is the economy tests').
  // Each card compares her with yours.
  await expect(yard.locator('.ship-card', { hasText: 'war sloop' }).locator('.ship-card-compare')).toContainText('Against your brig: faster');
  // Each card says what she is for.
  await expect(yard.locator('.ship-card', { hasText: 'war sloop' })).toContainText('raider');
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
  // Each part says his own figures, and what the next step brings.
  await expect(page.locator('.career-score')).toContainText('0 gold made trading: the next point at 500');
  // Wealth climbs the same ladder: 1,000 gold is the first point, and the second waits for 3,000.
  await expect(page.locator('.career-score')).toContainText('the next point at 3,000');
  await expect(page.locator('.career-score')).toContainText('a Baron gets 100 acres');
  await page.screenshot({ path: 'test-results/retire-confirm.png' });
  await page.getByRole('button', { name: 'Not yet' }).click();
  await expect(page.locator('.career-score')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retire…' }).click();
  await page.getByRole('button', { name: 'Retire now' }).click();
  // The fate's painting, what became of him, and the score.
  await expect(page.locator('.ending .moment-title')).toHaveText('A beggar on the quays of Port Royal');
  await expect(page.locator('.ending-number')).toHaveText(/^\d+$/);
  // The story opens with how long the career lasted; the finished career can be kept as a file.
  await expect(page.locator('.ending-story')).toContainText('Not a month on the Main.');
  await expect(page.locator('.ending').getByRole('button', { name: 'Save to a file' })).toBeVisible();
  await page.screenshot({ path: 'test-results/retired.png' });
  expect(await page.evaluate(() => (window.__corsair.state.get('captain') as { retired?: unknown }).retired)).toBeTruthy();
  await expect(page.locator('.hud-saved')).toBeVisible();
  await page.getByRole('button', { name: 'Start a new career' }).click();
  await expect(page.locator('.start')).toContainText('Retired:');
  expect(errors).toEqual([]);
});
