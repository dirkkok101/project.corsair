import { createAudio } from '@corsair/audio';
import { createSim, dateOf, formatDate, TICKS_PER_SECOND } from '@corsair/core';
import { decodeRasterMap, loadContent, placeSettlements } from '@corsair/data';
import { createRenderer, fitView, parseGpl } from '@corsair/render';
import type { WildlifeDefs } from '@corsair/render';
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
import { angleOffWind, pointOfSail, speedPoints } from '@corsair/systems-navigation';
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
// Recorded sounds and instrument notes (art/audio, CC0 and public domain; see art/audio/CREDITS.json).
const audioFiles = import.meta.glob<string>('../../../art/audio/**/*.wav', { eager: true, query: '?url', import: 'default' });
const sfxManifest = import.meta.glob<{ files: string[] }>('../../../art/audio/sfx/sfx.json', { eager: true, import: 'default' });
const instrumentManifest = import.meta.glob<{ samples: { file: string; midi: number }[] }>(
  '../../../art/audio/instruments/instruments.json',
  { eager: true, import: 'default' },
);

/** Manifest entries name files from the repo root (art/audio/...); map them to served URLs. */
function sampleManifest() {
  const url = (file: string) => {
    const found = Object.entries(audioFiles).find(([p]) => p.endsWith(file.replace(/^art\//, '/art/')));
    if (!found) throw new Error(`audio file ${file} not found`);
    return found[1];
  };
  const sfx = Object.values(sfxManifest)[0] as unknown as Record<string, { files: string[] }>;
  const instruments = Object.values(instrumentManifest)[0] as unknown as Record<string, { samples: { file: string; midi: number }[] }>;
  return {
    sfx: Object.fromEntries(Object.entries(sfx).map(([id, v]) => [id, v.files.map(url)])),
    instruments: Object.fromEntries(
      Object.entries(instruments).map(([id, v]) => [id, v.samples.map((s) => ({ url: url(s.file), midi: s.midi }))]),
    ),
  };
}

// Sea life sprites (tools/art/render_wildlife.py); the game runs without them until they exist.
const wildlifeFrames = import.meta.glob<string>('../../../art/generated/wildlife/*.png', { eager: true, query: '?url', import: 'default' });
const wildlifeDefs = import.meta.glob('../../../art/generated/wildlife/wildlife.json', { eager: true, import: 'default' });

// Day, dusk and night rows for the palette swap (art pipeline section 6).
const paletteFiles = import.meta.glob<string>('../../../art/palette/*.gpl', { eager: true, query: '?raw', import: 'default' });
const palette = (name: string) => parseGpl(Object.entries(paletteFiles).find(([p]) => p.endsWith(`/${name}`))![1]);

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
  // The clock starts at the map's start hour; the date is unchanged (still day 0).
  const startTick = Math.round((def.startHour / 24) * content.calendar.ticksPerDay);
  const sim = createSim(withWeather({ ...createWorld(def), tick: startTick }, content, def, seed), [
    createWeatherSystem(content, def, map),
    createNavigationSystem(content, map, windAt),
  ]);
  const breezes = createBreezeField(content, def, map);
  // Sound needs a user gesture before the browser lets it play; V toggles mute, N the music.
  const audio = createAudio({ samples: sampleManifest(), tunes: content.music.tunes });
  const renderer = await createRenderer(content, map, { ...groupFrames(shipFrames), ...groupFrames(townFrames), ...groupFrames(wildlifeFrames) }, {
    settlements,
    windAt,
    palettes: [palette('corsair.gpl'), palette('corsair-dusk.gpl'), palette('corsair-night.gpl')],
    wildlife: {
      defs: (Object.values(wildlifeDefs)[0] ?? {}) as WildlifeDefs,
      sound: (id, opts) => audio.playSfx(id, opts),
      coastNearness: (x, y) => breezes.coastNearness(x, y),
    },
  });

  const stage = document.getElementById('stage')!;
  const viewport = stage.appendChild(document.createElement('div'));
  viewport.className = 'viewport';
  viewport.appendChild(renderer.canvas);
  const labels = createLabels(viewport, settlements, map.tileSize);
  const hudRoot = stage.appendChild(document.createElement('div'));
  let destination: PlacedSettlement | undefined;
  const charts = createCharts(stage, map, settlements, (port) => (destination = port));
  // 1 next to a town, falling to 0 about 12 tiles (30 km) out: within earshot of bells and quays.
  const harbourNearness = (x: number, y: number) => {
    let best = 0;
    for (const s of settlements) best = Math.max(best, 1 - Math.hypot(s.x - x, s.y - y) / 12);
    return best;
  };
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

  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'v' && !e.repeat) audio.toggleMute();
    if (e.key.toLowerCase() === 'n' && !e.repeat) audio.toggleMusic();
  });

  renderer.onLightning(() => audio.thunder());
  let audioFailed = false;

  const loop: LoopControl = { paused: false };
  window.__corsair = { ...createDebugApi(sim, loop), seed, audio: { levels: () => audio.levels() }, wildlife: renderer.wildlife };
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
    const wind = windAt(sim.state, ship.x, ship.y);
    const offWind = angleOffWind(ship.headingDeg, wind.fromDeg);
    const inStorm = (sim.state.weather?.storms ?? []).some((s) => stormWindAt(s, ship.x, ship.y));
    const cls = content.ships[ship.classId]!;
    // Sound must never stop the game: report a failure once and keep sailing.
    try {
      audio.update(
        {
          wind: content.navigation.windStrength[wind.strength]!,
          offWindDeg: offWind,
          speed: speedPoints(content, ship) / cls.speed,
          sailsSet: ship.sails !== 'furled',
          luffing: pointOfSail(content, offWind).id === 'irons',
          inStorm,
          coast: breezes.coastNearness(ship.x, ship.y),
          harbour: harbourNearness(ship.x, ship.y),
          hour,
          sails: ship.sails,
          openSea: breezes.coastNearness(ship.x, ship.y) === 0,
        },
        now / 1000,
      );
    } catch (err) {
      if (!audioFailed) console.error('audio update failed', err);
      audioFailed = true;
    }
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
        wind={wind}
        date={formatDate(dateOf(def.startDate, day))}
        seaArea={zoneAt(content, map, ship.x, ship.y).name}
        inStorm={inStorm}
        sound={
          audio.muted
            ? 'Sound off · V'
            : !audio.unlocked
              ? 'Press any key for sound'
              : !audio.music
                ? 'Music off · N'
                : audio.nowPlaying && `♪ ${audio.nowPlaying}`
        }
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
