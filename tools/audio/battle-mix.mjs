// Records the game's own audio output, one battle sound at a time (three takes each: their clips and pitches vary),
// as the game mixes it, for measuring the battle mix (packages/audio BATTLE_MIX) with loudness.py.
// Needs the dev server running (npx vite apps/web --port 5199).
// Usage: node tools/audio/battle-mix.mjs <outdir> [url]; then convert: ffmpeg -i x.webm -ar 48000 x.wav, and
//        python3 tools/audio/loudness.py <outdir> (numpy, scipy, soundfile, pyloudnorm; earshot's venv has them).
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [out, url = 'http://localhost:5199/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Tap: whatever is connected to a context's destination is also sent to a recorder.
await page.addInitScript(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      if (!ctx.__tap) {
        ctx.__tap = ctx.createMediaStreamDestination();
        window.__tapCtx = ctx;
      }
      connect.call(this, ctx.__tap);
    }
    return r;
  };
  window.__record = (ms) =>
    new Promise((resolve) => {
      const rec = new MediaRecorder(window.__tapCtx.__tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
        resolve(Array.from(buf));
      };
      rec.start();
      setTimeout(() => rec.stop(), ms);
    });
});
await page.goto(`${url}?pace=1&turn=1`);
await page.getByRole('button', { name: 'Next: how hard a sea' }).click();
await page.getByRole('button', { name: 'Set sail' }).click();
await page.locator('.moment-opening').waitFor();
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__corsair?.audio.levels().samplesReady, undefined, { timeout: 60000 });
// The band off: the combat sounds against the sea's own bed.
if (await page.evaluate(() => window.__corsair.audio.levels().music)) await page.keyboard.press('n');
await page.waitForTimeout(2000);
const save = async (name, ms, play) => {
  const recording = page.evaluate((m) => window.__record(m), ms);
  await page.waitForTimeout(150);
  if (play) await page.evaluate(play);
  writeFileSync(`${out}/${name}.webm`, Buffer.from(await recording));
};
// As the game calls them in a fight: gain 1 / (1 + tiles / 8); the player's own ship about a tile off the event.
const shots = {
  bed: null,
  broadside_own: 'window.__corsair.audio.battle.broadside(5, 0, 0.89)',
  broadside_enemy: 'window.__corsair.audio.battle.broadside(5, 0.5, 0.5); window.__corsair.audio.battle.whistle(1.2, 0.15, 1)',
  broadside_far: 'window.__corsair.audio.battle.broadside(6, 0.4, 0.2, true)',
  hit_hull: 'window.__corsair.audio.battle.hit("hull", 0, 0.89)',
  hit_sail: 'window.__corsair.audio.battle.hit("sail", 0, 0.89)',
  hit_grape: 'window.__corsair.audio.battle.hit("grape", 0, 0.89)',
  splash: 'window.__corsair.audio.battle.splash(0.2, 0.7)',
  whistle: 'window.__corsair.audio.battle.whistle(0, 0.1, 1)',
  mast: 'window.__corsair.audio.battle.mast(0.3, 0.6)',
  boarding: 'window.__corsair.audio.battle.boarding(0.3, 1)',
  explosion: 'window.__corsair.audio.battle.explosion(0.4, 0.5)',
  cheer: 'window.__corsair.audio.battle.cheer()',
  // The busiest moment: her broadside lands while yours goes off, hits and a mast with it.
  melee_storm: '(() => { const b = window.__corsair.audio.battle; b.broadside(8, 0, 0.89); b.broadside(8, 0.5, 0.5); b.hit("hull", 0, 0.89); b.hit("hull", 0, 0.89); b.hit("sail", 0, 0.89); b.mast(0, 0.89); b.whistle(0.3, 0, 1); })()',
};
for (const [name, play] of Object.entries(shots)) {
  for (let take = 1; take <= (play ? 3 : 1); take++) {
    await save(`${name}~${take}`, name === 'boarding' || name === 'cheer' ? 7000 : 4000, play ? new Function(play) : null);
    await page.waitForTimeout(1500);
  }
}
// The band, for reference.
await page.keyboard.press('n');
await page.waitForTimeout(25000);
await save('band', 8000, null);
await browser.close();
