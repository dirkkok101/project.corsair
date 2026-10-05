import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Drives the real game through window.__corsair (PRD section 16): the debug API confirms behaviour,
// screenshots confirm rendering.

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__corsair));
  // Freeze the clock so every check below steps the sim explicitly.
  await page.evaluate(() => window.__corsair.sim.pause());
  return errors;
}

const player = (page: Page) =>
  page.evaluate(() => window.__corsair.state.get('ships.player') as { x: number; y: number; headingDeg: number; speed: number });

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
  await page.evaluate(() => window.__corsair.sim.step(540 * 2));
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
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => Boolean(window.__corsair.audio.levels().nowPlaying), undefined, { timeout: 20_000 });
  const title = await page.evaluate(() => window.__corsair.audio.levels().nowPlaying);
  expect(['Drunken Sailor', 'Scarborough Fair', 'Greensleeves']).toContain(title);

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
