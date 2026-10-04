import { createSim, TICKS_PER_SECOND } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createRenderer, VIEW_HEIGHT, VIEW_WIDTH } from '@corsair/render';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import { render } from 'preact';
import { createDebugApi } from './debug';
import type { LoopControl } from './debug';
import { Hud } from './hud';
import { bindInput } from './input';
import { createLabels } from './labels';

// Sprite frames and map layers are read in place until the atlas packer exists. Frame files are
// named `{sprite}.{anim}.fNN.png` (single-frame sprites drop `.fNN`); grouping by everything before
// that and sorting gives f00..fNN.
const shipFrames = import.meta.glob<string>('../../../art/generated/ships/brig45/world/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const townFrames = import.meta.glob<string>('../../../art/generated/settlements/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const mapFiles = import.meta.glob<string>('../../../packages/data/content/maps/caribbean/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

function groupFrames(urls: Record<string, string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const path of Object.keys(urls).sort()) {
    const id = path.split('/').pop()!.replace(/(\.f\d+)?\.png$/, '');
    (groups[id] ??= []).push(urls[path]!);
  }
  return groups;
}

async function main() {
  const content = loadContent();
  const def = content.maps.caribbean;
  const layer = async (name: string) => {
    const url = Object.entries(mapFiles).find(([path]) => path.endsWith(`/${name}`))?.[1];
    if (!url) throw new Error(`map layer ${name} not found`);
    return new Uint8Array(await (await fetch(url)).arrayBuffer());
  };
  const map = decodeRasterMap(def, {
    terrain: await layer(def.layers.terrain),
    elevation: await layer(def.layers.elevation),
    zones: await layer(def.layers.zones),
  });
  const settlements = placeSettlements(def, map, content.settlements);
  const sim = createSim(createWorld(def), [createNavigationSystem(content, map)]);
  const renderer = await createRenderer(
    content,
    map,
    { ...groupFrames(shipFrames), ...groupFrames(townFrames) },
    settlements,
  );

  const stage = document.getElementById('stage')!;
  const viewport = stage.appendChild(document.createElement('div'));
  viewport.className = 'viewport';
  viewport.appendChild(renderer.canvas);
  const labels = createLabels(viewport, settlements, map.tileSize);
  const hudRoot = stage.appendChild(document.createElement('div'));
  let scale = 1;
  const fit = () => {
    scale = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_WIDTH, innerHeight / VIEW_HEIGHT)));
    renderer.canvas.style.width = `${VIEW_WIDTH * scale}px`;
    renderer.canvas.style.height = `${VIEW_HEIGHT * scale}px`;
  };
  fit();
  window.addEventListener('resize', fit);

  const loop: LoopControl = { paused: false };
  window.__corsair = createDebugApi(sim, loop);
  bindInput(sim, def.start.shipId);

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
    labels.update(renderer.camera(), scale);
    render(<Hud state={sim.state} content={content} />, hudRoot);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
