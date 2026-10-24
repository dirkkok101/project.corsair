// Frame cost on the sea map, as a player on a MacBook Air sees it (1470x956 at devicePixelRatio 2): sails out of
// port and runs the game in real time, timing each animation frame's GPU work (WebGL timer queries) and its CPU
// work. Needs a build (`vite build apps/web`); run `node tools/perf/sea.mjs [seconds] [query]` from the repo root.
// The GPU here is likely faster than the player's: compare milliseconds before and after a change, not frame rates.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const seconds = Number(process.argv[2] ?? 12);
const query = process.argv[3] ?? '';
const PORT = 5399;
// DIST: another build to serve (say, a copy of the last one, to compare against).
const dist = process.env.DIST ? ['--outDir', process.env.DIST] : [];
const server = spawn('npx', ['vite', 'preview', 'apps/web', '--port', String(PORT), '--strictPort', ...dist], { stdio: 'ignore' });
const stop = () => server.kill();
try {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://localhost:${PORT}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // UNCAPPED: no vsync or frame limit, so frames come as fast as the slower of CPU and GPU allows (frameGapMs is
  // then the cost of a frame, which a timer query round the whole callback doesn't show on a fast GPU).
  const uncapped = process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...uncapped] });
  const page = await browser.newPage({ viewport: { width: 1470, height: 956 }, deviceScaleFactor: Number(process.env.DPR ?? 2) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Each animation frame's callbacks, bracketed by a GPU timer query on the game's WebGL2 context.
  if (process.env.SLOW) await page.addInitScript((ms) => (window.__slowMs = ms), Number(process.env.SLOW));
  await page.addInitScript(() => {
    const perf = (window.__perf = { gpu: [], cpu: [], at: [], on: false });
    // The game's main view: the 3D sea's canvas (class sea3d; the page has other WebGL canvases).
    const contexts = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      const ctx = get.call(this, kind, ...rest);
      if (kind === 'webgl2' && ctx && !contexts.includes(ctx)) contexts.push(ctx);
      return ctx;
    };
    let gl;
    let ext;
    const main = () => {
      const big = contexts.find((c) => c.canvas.className === 'sea3d');
      if (big && big !== gl) {
        gl = big;
        ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      }
    };
    const pending = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        main();
        // SLOW: a slow machine, played by burning that many milliseconds a frame (once, in the first callback).
        if (window.__slowMs && t !== perf.burnt) {
          perf.burnt = t;
          const until = performance.now() + window.__slowMs;
          while (performance.now() < until);
        }
        const q = perf.on && gl && ext ? gl.createQuery() : undefined;
        if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const c0 = performance.now();
        try {
          cb(t);
        } finally {
          if (perf.on) {
            perf.cpu.push(performance.now() - c0);
            perf.at.push(t);
          }
          if (q) {
            q.t = t;
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            pending.push(q);
          }
          for (let i = pending.length - 1; i >= 0; i--) {
            const p = pending[i];
            if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) continue;
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) perf.gpu.push([p.t, gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6]);
            gl.deleteQuery(p);
            pending.splice(i, 1);
          }
        }
      });
  });
  await page.goto(`http://localhost:${PORT}/?seed=3${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => Boolean(window.__corsair));
  await page.locator('.loading').waitFor({ state: 'detached', timeout: 60_000 });
  // Out of port and under full sail, the clock running.
  await page.keyboard.press('e');
  await page.waitForTimeout(3000);
  await page.keyboard.press('w');
  // AT=x,y: out on that spot of sea instead (the open ocean, say), by the debug API's teleport.
  if (process.env.AT) {
    const [x, y] = process.env.AT.split(',').map(Number);
    await page.evaluate(([x, y]) => window.__corsair.cmd.send({ type: 'Teleport', shipId: 'player', x, y }), [x, y]);
  }
  // CHASE: the camera astern of her (C) rather than overhead.
  if (process.env.CHASE) await page.keyboard.press('c');
  // CRUISE: press = that many times (2x, 4x the world's pace).
  for (let i = 0; i < Number(process.env.CRUISE ?? 0); i++) await page.keyboard.press('=');
  await page.waitForTimeout(2000);
  const from = await page.evaluate(() => window.__corsair.state.get('ships.player'));
  await page.evaluate(() => (window.__perf.on = true));
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(() => {
    const p = window.__perf;
    p.on = false;
    const q = (a, k) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : NaN;
    };
    // Per displayed frame: every callback sharing a timestamp ran in it.
    const sum = (pairs) => [...pairs.reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map()).values()];
    const frames = [...new Set(p.at)];
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    p.gpu = sum(p.gpu);
    p.cpu = sum(p.at.map((t, i) => [t, p.cpu[i]]));
    const at = window.__corsair.state.get('ships.player');
    return {
      frames: frames.length,
      callbacksPerFrame: +(p.at.length / frames.length).toFixed(2),
      // The fastest frames (p10) are the least disturbed by anything else on the GPU: compare those between runs.
      gpuMs: { p10: q(p.gpu, 0.1), median: q(p.gpu, 0.5), p95: q(p.gpu, 0.95), n: p.gpu.length },
      cpuMs: { median: q(p.cpu, 0.5), p95: q(p.cpu, 0.95) },
      frameGapMs: { median: q(gaps, 0.5), p95: q(gaps, 0.95) },
      canvas: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`),
      ship: { x: +at.x.toFixed(1), y: +at.y.toFixed(1), speed: +at.speed.toFixed(2), docked: at.docked ?? null },
    };
  });
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  console.log(JSON.stringify({ seconds, query, from: { x: +from.x.toFixed(1), y: +from.y.toFixed(1) }, ...r, errors: errors.slice(0, 3) }, null, 1));
  await browser.close();
} finally {
  stop();
}
