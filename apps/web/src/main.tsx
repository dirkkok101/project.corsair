import { createSim, dateOf, formatDate, TICKS_PER_SECOND } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createRenderer, fitView } from '@corsair/render';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import {
  createBreezeField,
  createWeatherSystem,
  createWindField,
  hourOf,
  stormWindAt,
  withWeather,
  zoneAt,
} from '@corsair/systems-weather';
import type { PlacedSettlement } from '@corsair/data';
import { speedPoints } from '@corsair/systems-navigation';
import { render } from 'preact';
import { createDebugApi } from './debug';
import type { LoopControl } from './debug';
import { Hud } from './hud';
import { createCharts } from './chart';
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
  // A new game gets a random seed; with the input log it replays the run exactly (PRD section 16).
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const windAt = createWindField(content, def, map);
  const sim = createSim(withWeather(createWorld(def), content, def, seed), [
    createWeatherSystem(content, def, map),
    createNavigationSystem(content, map, windAt),
  ]);
  const renderer = await createRenderer(
    content,
    map,
    { ...groupFrames(shipFrames), ...groupFrames(townFrames) },
    settlements,
    windAt,
  );

  const stage = document.getElementById('stage')!;
  const viewport = stage.appendChild(document.createElement('div'));
  viewport.className = 'viewport';
  viewport.appendChild(renderer.canvas);
  const labels = createLabels(viewport, settlements, map.tileSize);
  const hudRoot = stage.appendChild(document.createElement('div'));
  let destination: PlacedSettlement | undefined;
  const charts = createCharts(stage, map, settlements, (port) => (destination = port));
  const breezes = createBreezeField(content, def, map);
  // Distances for the HUD: the map is equirectangular, close enough to square tiles.
  const { lonMin, lonMax, latMin, latMax } = def.bounds;
  const kmPerTile =
    (((lonMax - lonMin) / def.width) * 111.32 * Math.cos((((latMin + latMax) / 2) * Math.PI) / 180) +
      ((latMax - latMin) / def.height) * 110.57) /
    2;
  // CSS pixels per art pixel; the device-pixel scale behind it is always a whole number.
  let scale = 1;
  const fit = () => {
    const view = fitView(innerWidth, innerHeight, devicePixelRatio);
    renderer.resize(view.width, view.height);
    scale = view.scale / devicePixelRatio;
    renderer.canvas.style.width = `${view.cssWidth}px`;
    renderer.canvas.style.height = `${view.cssHeight}px`;
  };
  fit();
  window.addEventListener('resize', fit);

  const loop: LoopControl = { paused: false };
  window.__corsair = { ...createDebugApi(sim, loop), seed };
  const player = () => sim.state.ships[def.start.shipId]!;
  bindInput(sim, def.start.shipId, () => windAt(sim.state, player().x, player().y));

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
    labels.update(renderer.camera(), renderer.view(), scale);
    charts.update(sim.state.ships[def.start.shipId], renderer.camera(), renderer.view());
    const ship = player();
    const day = Math.floor(sim.state.tick / content.calendar.ticksPerDay);
    const hour = hourOf(sim.state.tick, content.calendar.ticksPerDay);
    const breeze = breezes.at(sim.state.tick, ship.x, ship.y);
    let course: { name: string; distanceKm: number; bearingDeg: number; closing: number } | undefined;
    if (destination) {
      const dx = destination.x - ship.x;
      const dy = destination.y - ship.y;
      const bearingDeg = (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
      const closing = speedPoints(content, ship) * Math.cos(((ship.headingDeg - bearingDeg) * Math.PI) / 180);
      course = { name: destination.name, distanceKm: Math.hypot(dx, dy) * kmPerTile, bearingDeg, closing };
    }
    render(
      <Hud
        state={sim.state}
        content={content}
        wind={windAt(sim.state, ship.x, ship.y)}
        date={formatDate(dateOf(def.startDate, day))}
        seaArea={zoneAt(content, map, ship.x, ship.y).name}
        inStorm={(sim.state.weather?.storms ?? []).some((s) => stormWindAt(s, ship.x, ship.y))}
        time={`${String(Math.floor(hour)).padStart(2, '0')}:00`}
        breeze={breeze && `${breeze.kind} breeze`}
        destination={course}
      />,
      hudRoot,
    );
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
