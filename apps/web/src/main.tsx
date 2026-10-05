import { createAudio } from '@corsair/audio';
import { contentFingerprint, createSim, dateOf, formatDate, TICKS_PER_SECOND, toSave } from '@corsair/core';
import { decodeRasterMap, gameplayContent, loadContent, placeSettlements } from '@corsair/data';
import { createRenderer, fitView, parseGpl } from '@corsair/render';
import type { HarbourScene, WildlifeDefs } from '@corsair/render';
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
import { Port } from './port';
import type { Service } from './port';
import { createEconomySystem, DOCK_RANGE, newsText, tradeLean, withEconomy } from '@corsair/systems-economy';
import { createCharts } from './chart';
import { bindInput } from './input';
import { createLabels } from './labels';
import { loadStoredSave, storeSave } from './save';
import { chooseCareer } from './start';

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

// Harbour scenes behind the port screen (tools/art/render_harbours.py): one composition per nation and tier.
const harbourFiles = import.meta.glob<string>('../../../art/generated/harbours/*.png', { eager: true, query: '?url', import: 'default' });
const harbourDefs = import.meta.glob('../../../art/generated/harbours/harbours.json', { eager: true, import: 'default' });
interface HarbourDef {
  layers: { id: string; file?: string; frames?: string[] }[];
  hotspots: Partial<Record<Service, [number, number, number, number]>>;
  flag: [number, number];
  anchor: [number, number];
}

/** The scene for a settlement: havens have their own; other towns go by nation and size. */
function harbourFor(s: PlacedSettlement): { scene: HarbourScene; hotspots: HarbourDef['hotspots'] } | undefined {
  const defs = (Object.values(harbourDefs)[0] ?? {}) as Record<string, HarbourDef>;
  const tier = { hamlet: 'small', town: 'medium', city: 'large' }[s.size];
  const def = defs[s.nation === 'pirate' || s.type === 'haven' ? 'harbour.pirate.haven' : `harbour.${s.nation}.${tier}`];
  if (!def) return undefined;
  const url = (file: string) => Object.entries(harbourFiles).find(([p]) => p.endsWith(`/${file.split('/').pop()}`))![1];
  return {
    scene: { layers: def.layers.map((l) => (l.frames ?? [l.file!]).map(url)), flag: def.flag, anchor: def.anchor, nation: s.nation },
    hotspots: def.hotspots,
  };
}

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
  const stage = document.getElementById('stage')!;
  // A stored career gets the start screen; without one the game opens straight onto a new career.
  // Only gameplay content counts: new music or sprite framing shouldn't flag every old save.
  const fingerprint = contentFingerprint(gameplayContent(content));
  // Whatever is stored goes to the start screen, readable or not, so a bad save is never silently replaced.
  const stored = await loadStoredSave();
  const resumed = stored
    ? await chooseCareer(stage, { raw: stored, fingerprint, startDate: def.startDate, ticksPerDay: content.calendar.ticksPerDay, settlements })
    : undefined;
  // A new game gets a random seed; with the input log it replays the run exactly (PRD section 16).
  // `?seed=N` starts a known world, for replays and tests.
  const asked = Number(new URLSearchParams(location.search).get('seed') ?? NaN);
  const seed = resumed?.seed ?? (Number.isInteger(asked) ? asked >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]!);
  const windAt = createWindField(content, def, map);
  // The clock starts at the map's start hour; the date is unchanged (still day 0).
  const startTick = Math.round((def.startHour / 24) * content.calendar.ticksPerDay);
  // A restored state already carries its markets, weather and RNG streams; seeding them again would reset them.
  const world =
    resumed?.state ?? withEconomy(withWeather({ ...createWorld(def), tick: startTick }, content, def, seed), content, settlements, seed);
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements),
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

  const viewport = stage.appendChild(document.createElement('div'));
  viewport.className = 'viewport';
  viewport.appendChild(renderer.canvas);
  const labels = createLabels(viewport, settlements, map.tileSize);
  const hudRoot = stage.appendChild(document.createElement('div'));
  const portRoot = stage.appendChild(document.createElement('div'));
  let destination: PlacedSettlement | undefined;
  const charts = createCharts(stage, map, settlements, (port) => (destination = port), {
    goods: content.goods,
    known: (id) => sim.state.captain?.knownPrices[id],
    lean: (id, good) => tradeLean(content, { id }, good),
    rumours: (id) => {
      const heard = new Set(sim.state.captain?.heard ?? []);
      const today = Math.floor(sim.state.tick / content.calendar.ticksPerDay);
      const name = settlements.find((s) => s.id === id)?.name ?? id;
      return (sim.state.news ?? [])
        .filter((n) => n.settlementId === id && heard.has(n.id))
        .map((n) => `${newsText(content, n, name)} (${today - Math.floor(n.tick / content.calendar.ticksPerDay)} days ago)`);
    },
    today: () => Math.floor(sim.state.tick / content.calendar.ticksPerDay),
  });
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
    // E: enter the port in reach, or set sail again.
    if (e.key.toLowerCase() === 'e' && !e.repeat) {
      const ship = player();
      if (ship.docked) sim.send({ type: 'Undock', shipId: ship.id });
      else {
        const port = portInReach();
        if (port) sim.send({ type: 'Dock', shipId: ship.id, settlementId: port.id });
      }
    }
    // Ctrl+S (Cmd+S on a Mac) saves the career instead of the browser's "save page".
    if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!e.repeat) save();
    }
    // Time acceleration in open water: = faster, - slower.
    if (e.key === '=' || e.key === '+') wantedSpeed = Math.min(4, wantedSpeed * 2);
    if (e.key === '-') wantedSpeed = Math.max(1, wantedSpeed / 2);
  });

  renderer.onLightning(() => audio.thunder());
  let audioFailed = false;

  // The HUD flashes "Saved" once the write has landed.
  let savedAt = -Infinity;
  const save = () =>
    storeSave(toSave(sim.state, seed, fingerprint, Date.now()))
      .then(() => (savedAt = performance.now()))
      .catch((err) => console.error('save failed', err));

  const loop: LoopControl = { paused: false };
  window.__corsair = {
    ...createDebugApi(sim, loop),
    seed,
    audio: { levels: () => audio.levels() },
    wildlife: renderer.wildlife,
    ports: () => settlements.map(({ id, name, x, y }) => ({ id, name, x, y })),
    snapshot: { save: () => toSave(sim.state, seed, fingerprint, Date.now()) },
  };
  const player = () => sim.state.ships[def.start.shipId]!;
  bindInput(sim, def.start.shipId, () => windAt(sim.state, player().x, player().y));

  /** The nearest port close enough to dock at, if any. */
  const portInReach = () => {
    const ship = player();
    let best: { s: PlacedSettlement; d: number } | undefined;
    for (const s of settlements) {
      const d = Math.hypot(s.x - ship.x, s.y - ship.y);
      if (d <= DOCK_RANGE && (!best || d < best.d)) best = { s, d };
    }
    return best?.s;
  };
  // One scene object per port, so the renderer sees the same one each frame and loads it once.
  const harbourScenes = new Map<string, ReturnType<typeof harbourFor>>();
  const harbourScene = (s: PlacedSettlement) => {
    if (!harbourScenes.has(s.id)) harbourScenes.set(s.id, harbourFor(s));
    return harbourScenes.get(s.id);
  };
  /** Scene-pixel hotspot rectangles to CSS pixels within the stage, for the clickable buildings. */
  const hotspotsOnScreen = (spots: HarbourDef['hotspots']) => {
    const t = renderer.harbour.transform();
    const canvas = renderer.canvas.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    const px = scale * t.scale;
    const out: Partial<Record<Service, { left: number; top: number; width: number; height: number }>> = {};
    for (const [id, [x, y, w, h]] of Object.entries(spots) as [Service, number[]][]) {
      out[id] = { left: canvas.left - box.left + (t.x * scale) + x! * px, top: canvas.top - box.top + t.y * scale + y! * px, width: w! * px, height: h! * px };
    }
    return out;
  };

  // Time acceleration the player asked for; it drops to 1x whenever something needs attention.
  let wantedSpeed = 1;
  const timeScale = (inStorm: boolean) => {
    const ship = player();
    const nearLand = breezes.coastNearness(ship.x, ship.y) > 0.4 || harbourNearness(ship.x, ship.y) > 0.3;
    return inStorm || nearLand || ship.docked ? 1 : wantedSpeed;
  };

  // Fixed 30 Hz sim under a variable frame rate; the cap stops a background tab from fast-forwarding.
  const dt = 1 / TICKS_PER_SECOND;
  let acc = 0;
  let last = performance.now();
  let speedNow = 1;
  let wasDocked = Boolean(player().docked);
  const frame = (now: number) => {
    acc = loop.paused ? 0 : Math.min(acc + ((now - last) / 1000) * speedNow, 0.25 * speedNow);
    last = now;
    if (player().docked) {
      // World time stops in port (PRD section 2); trades still apply at once.
      sim.applyCommands();
      acc = 0;
    }
    while (acc >= dt) {
      sim.step();
      acc -= dt;
      if (player().docked) break;
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
    speedNow = timeScale(inStorm);
    // Autosave on arriving in port, whichever way the Dock command came in.
    if (ship.docked && !wasDocked) save();
    wasDocked = Boolean(ship.docked);
    const reach = ship.docked ? undefined : portInReach();
    const town = ship.docked ? settlements.find((s) => s.id === ship.docked) : undefined;
    const harbour = town && harbourScene(town);
    void renderer.harbour.show(harbour?.scene);
    stage.classList.toggle('in-port', Boolean(town));
    render(
      town ? (
        <Port
          state={sim.state}
          content={content}
          town={town}
          settlements={settlements}
          shipId={ship.id}
          hotspots={harbour ? hotspotsOnScreen(harbour.hotspots) : {}}
          send={(command) => {
            sim.send(command);
            sim.applyCommands();
          }}
        />
      ) : null,
      portRoot,
    );
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
        prompt={reach ? `Enter ${reach.name} · E` : undefined}
        timeScale={speedNow > 1 ? speedNow : wantedSpeed > 1 ? 'held' : undefined}
        saved={now - savedAt < 2000}
      />,
      hudRoot,
    );
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
