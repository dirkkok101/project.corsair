import { createSim, TICKS_PER_SECOND } from '@corsair/core';
import { buildTileMap, loadContent } from '@corsair/data';
import { createRenderer, VIEW_HEIGHT, VIEW_WIDTH } from '@corsair/render';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { render } from 'preact';
import { createDebugApi } from './debug';
import type { LoopControl } from './debug';
import { Hud } from './hud';
import { bindInput } from './input';

// Ship frames read in place from art/ until the atlas packer exists. Files are named
// `{sprite}.{anim}.fNN.png`; grouping by everything before `.fNN` and sorting gives f00..fNN.
const shipFrames = import.meta.glob<string>('../../../art/generated/ships/brig45/world/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

function groupFrames(urls: Record<string, string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const path of Object.keys(urls).sort()) {
    const id = path.split('/').pop()!.replace(/\.f\d+\.png$/, '');
    (groups[id] ??= []).push(urls[path]!);
  }
  return groups;
}

async function main() {
  const content = loadContent();
  const map = buildTileMap(content.map);
  const sim = createSim(createWorld(content), [createNavigationSystem(content, map)]);
  const renderer = await createRenderer(content, map, groupFrames(shipFrames));

  const stage = document.getElementById('stage')!;
  stage.appendChild(renderer.canvas);
  const hudRoot = stage.appendChild(document.createElement('div'));
  const fit = () => {
    const scale = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_WIDTH, innerHeight / VIEW_HEIGHT)));
    renderer.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    renderer.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
  };
  fit();
  window.addEventListener('resize', fit);

  const loop: LoopControl = { paused: false };
  window.__corsair = createDebugApi(sim, loop);
  bindInput(sim, content.map.start.shipId);

  // Fixed 30 Hz sim under a variable frame rate; the cap stops a background tab from fast-forwarding.
  const dt = 1 / TICKS_PER_SECOND;
  let acc = 0;
  let last = performance.now();
  const frame = (now: number) => {
    acc = loop.paused ? 0 : Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    while (acc >= dt) {
      sim.step();
      acc -= dt;
    }
    renderer.render(sim.state, now);
    render(<Hud state={sim.state} content={content} />, hudRoot);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
