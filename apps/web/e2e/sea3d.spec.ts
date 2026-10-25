import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Let the 3D view draw `n` frames before a screenshot: the clock is held, but the camera eases and the smoke drifts. */
const frames = (page: Page, n: number) =>
  page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

// The 3D sea map: it draws at sea, zooms on the wheel and switches to a view from astern on C, and goes away
// in port (behind the harbour scene).
test('the 3D sea map: draws at sea, zooms, looks from astern, and gives way to the harbour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?seed=3&pace=1&turn=1');
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
  await frames(page, 10);
  await page.screenshot({ path: 'test-results/sea3d-near.png' });
  await page.mouse.move(960, 540);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
  await frames(page, 10);
  await page.screenshot({ path: 'test-results/sea3d-far.png' });
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  // A merchant some way ahead (past the cards under the ships nearest her): she carries a label saying what she is,
  // from astern and overhead.
  await page.evaluate(() => {
    const c = window.__corsair;
    c.cmd.send({ type: 'SpawnShip', role: 'merchant', from: 'town.port_royal', to: 'town.cartagena' });
    c.sim.step(1);
    const ships = c.state.get('ships') as Record<string, { x: number; y: number }>;
    const id = Object.keys(ships).filter((k) => k.startsWith('ai.')).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1])).at(-1)!;
    const me = c.state.get('ships.player') as { x: number; y: number; headingDeg: number };
    const r = (me.headingDeg * Math.PI) / 180;
    c.cmd.send({ type: 'Teleport', shipId: id, x: me.x + Math.sin(r) * 20, y: me.y - Math.cos(r) * 20 });
    c.sim.step(1);
  });
  const labels = () => page.evaluate(() => (window as unknown as { __corsair3d: { shipLabels: string[] } }).__corsair3d.shipLabels);
  await page.keyboard.press('c');
  // New to the sea, she rises into view over a couple of seconds; her label comes once she is half up.
  await expect.poll(labels, { timeout: 10_000 }).toContainEqual(expect.stringMatching(/^(English|Spanish|French|Dutch) /));
  await page.screenshot({ path: 'test-results/sea3d-astern.png' });
  // Overhead again, she keeps it.
  await page.keyboard.press('c');
  await frames(page, 10);
  expect(await labels()).toContainEqual(expect.stringMatching(/^(English|Spanish|French|Dutch) /));
  await page.screenshot({ path: 'test-results/sea3d-labels-overhead.png' });
  expect(errors).toEqual([]);
});

test('the 3D sky keeps its own slow day: sunset and a moonlit night, for review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const hour of [17.8, 23]) {
    await page.goto(`/?seed=3&sky=${hour}&pace=1&turn=1`);
    await page.waitForFunction(() => Boolean(window.__corsair));
    await page.evaluate(() => window.__corsair.sim.pause());
    await page.keyboard.press('e');
    await page.evaluate(() => window.__corsair.sim.step(300));
    await frames(page, 10);
    await page.screenshot({ path: `test-results/sea3d-sky-${hour}.png` });
  }
  // The HUD shows the date only in 3D: the sky's hour isn't the game clock's.
  await expect(page.locator('.hud-date').first()).not.toContainText(':00');
  expect(errors).toEqual([]);
});

test('the 3D sea battle: both ships on the same sea, shot in flight and smoke, the firing arcs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?seed=3&pace=1&turn=1');
  await page.waitForFunction(() => Boolean(window.__corsair));
  await page.evaluate(() => window.__corsair.sim.pause());
  await page.keyboard.press('e');
  await page.evaluate(() => window.__corsair.sim.step(1));
  // A merchant out of Port Royal, and the player alongside her.
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
  const sea = page.locator('canvas.sea3d');
  await expect(sea).toBeVisible();
  await frames(page, 10);
  await page.screenshot({ path: 'test-results/battle3d-start.png' });
  // Close and fight until the first broadside goes off, then let it draw.
  const fired = await page.evaluate(() => {
    for (let i = 0; i < 30 * 120 && !window.__corsair.battle.state()!.shots.length; i += 5) window.__corsair.battle.step(5, 'cautious');
    return window.__corsair.battle.state()!.shots.length > 0;
  });
  await frames(page, 10);
  expect(fired).toBe(true);
  await page.screenshot({ path: 'test-results/battle3d-broadside.png' });
  await page.evaluate(() => window.__corsair.battle.step(12, 'cautious'));
  await frames(page, 10);
  await page.screenshot({ path: 'test-results/battle3d-smoke.png' });
  expect(errors).toEqual([]);
});
