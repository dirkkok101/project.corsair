import { createAudio } from '@corsair/audio';
import { contentFingerprint, createSim, dateOf, formatDate, inPort, TICKS_PER_SECOND, toSave } from '@corsair/core';
import type { Honour, Nation, Ship, WorldState } from '@corsair/core';
import { careerSettlements, decodeRasterMap, difficultyOf, gameplayContent, hourOf, isLand, loadContent, placeSettlements, shipStats, tickAtHour, tileAt, viewTiles } from '@corsair/data';
import { createHarbourRenderer, fitView, parseGpl } from '@corsair/render';
import { createSeaRenderer, flagPicture } from '@corsair/render3d';
import type { HarbourScene } from '@corsair/render';
import { createNavigationSystem, createWorld } from '@corsair/systems-navigation';
import {
  createBreezeField,
  createWeatherSystem,
  createWindField,
  stormWindAt,
  withWeather,
  zoneAt,
} from '@corsair/systems-weather';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { angleOffWind, pointOfSail, speedPoints } from '@corsair/systems-navigation';
import { render } from 'preact';
import { createDebugApi } from './debug';
import type { LoopControl } from './debug';
import { compassProps, Hud } from './hud';
import type { Toast } from './hud';
import { shipKind } from './ui-art';
import { Port } from './port';
import type { PortNotice, Service } from './port';
import { cargoUsed, closedTo, createEconomySystem, createLogbookSystem, hasGovernor, hoardRing, crewOf, DOCK_RANGE, famine, fleetBerths, fleetHold, fleetMinCrew, fleetOf, fleetShipPace, foodDays, purseFull, shipValue, townOf, moraleOf, moraleWord, newsAt, newsText, plagued, plagueDaysLeft, plagueLeftSaid, tradeLean, withEconomy } from '@corsair/systems-economy';
import { createCharts } from './chart';
import type { CardLine } from './chart';
import { bindInput } from './input';
import { exportSave, loadStoredSave, storeSave } from './save';
import { Ending } from './career';
import { chooseCareer } from './start';
import { crewLook, Hail, NATION_ADJECTIVE, shipTitle } from './hail';
import { Log } from './log';
import { letterMeans, MomentView } from './ui/moment';
import { showLoading } from './ui/loading';
import type { Moment } from './ui/moment';
import { bandOf, purseRise } from './ui/kit';
import { DEED_SMALL_MS, DeedCard, meritBar } from './ui/deed';
import { CayMark, HelmLessons, NedSays, OrdersCard, voyageOrders } from './voyage';
import { createShipLabels, NEAR_TILES } from './shiplabels';
import { createGamepad } from './gamepad';
import { bindMouse } from './mouse';
import { BattleHud } from './battle';
import type { BattleReport, PlunderChoice } from './battle';
import { createBattle } from '@corsair/minigame-sea-battle';
import type { Ammo, Battle } from '@corsair/minigame-sea-battle';
import { careerGoals, createHavensSystem, createHonoursSystem, createSeaLanes, createTrafficSystem, createVoyageSystem, withVoyage, havenKnown, missionGoals, nextGoal, prizePapers, withTraffic } from '@corsair/systems-traffic';
import { atWar, createPoliticsSystem, enemiesOf, legalTarget, NATIONS, withPolitics } from '@corsair/systems-politics';

// Ship atlases (tools/art/pack_ships.ts), one per class, named by sprite id: the harbour scenes show her at anchor.
const shipAtlases = import.meta.glob<string>('../../../art/game/ships/*.png', {
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

// Harbour scenes behind the port screen (tools/art/render_harbours.py): one composition per nation and tier.
const harbourFiles = import.meta.glob<string>('../../../art/game/harbours/*.png', { eager: true, query: '?url', import: 'default' });
const harbourDefs = import.meta.glob('../../../art/game/harbours/harbours.json', { eager: true, import: 'default' });
// Painted scenes (tools/art/import_paintings.ts): a painted harbour replaces its composition's layers
// (keeping its layout, so hotspots, flag point and anchorage still apply), and interiors stand behind
// the service panels.
const sceneFiles = import.meta.glob<string>('../../../art/game/scenes/*.png', { eager: true, query: '?url', import: 'default' });
const sceneUrl = (name: string) => Object.entries(sceneFiles).find(([p]) => p.endsWith(`/${name}.png`))?.[1];
interface HarbourDef {
  layers: { id: string; file?: string; frames?: string[] }[];
  hotspots: Partial<Record<Service, [number, number, number, number]>>;
  flag: [number, number];
  anchor: [number, number];
}

/** The interior behind a service's panel, if one is painted: havens have their own tavern. */
function interiorFor(s: PlacedSettlement, service: Service): HarbourScene | undefined {
  const haven = s.nation === 'pirate' || s.type === 'haven';
  const url = sceneUrl(service === 'tavern' && haven ? 'interior.tavern.pirate' : `interior.${service}`);
  return url ? { layers: [[url]], nation: s.nation } : undefined;
}

/** Which harbour scene a settlement has: havens their own; other towns by nation and size. */
const harbourId = (s: PlacedSettlement) =>
  s.nation === 'pirate' || s.type === 'haven' ? 'harbour.pirate.haven' : `harbour.${s.nation}.${{ hamlet: 'small', town: 'medium', city: 'large' }[s.size]}`;

const countryName: Record<string, string> = { england: 'England', spain: 'Spain', france: 'France', netherlands: 'The Netherlands' };

/** The scene for a settlement: havens have their own; other towns go by nation and size. */
function harbourFor(s: PlacedSettlement): { scene: HarbourScene; hotspots: HarbourDef['hotspots']; anchor: [number, number] } | undefined {
  const defs = (Object.values(harbourDefs)[0] ?? {}) as Record<string, HarbourDef>;
  const id = harbourId(s);
  const def = defs[id];
  if (!def) return undefined;
  const url = (file: string) => Object.entries(harbourFiles).find(([p]) => p.endsWith(`/${file.split('/').pop()}`))![1];
  const painted = sceneUrl(id);
  // The painted sea's shimmer frames lie over the painting.
  const sea = [0, 1, 2, 3].map((f) => sceneUrl(`${id}.sea.f0${f}`)).filter((u): u is string => Boolean(u));
  return {
    scene: {
      layers: painted ? [[painted], ...(sea.length ? [sea] : [])] : def.layers.map((l) => (l.frames ?? [l.file!]).map(url)),
      flag: def.flag,
      anchor: def.anchor,
      nation: s.nation,
    },
    hotspots: def.hotspots,
    anchor: def.anchor,
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

/** Mouse sailing and combat (left-click to move, right-click to act): off until it plays better; keyboard first. */
const MOUSE_CONTROLS = false;
/** The frame-rate readout (F2) is redrawn this often, from the frames since. */
const FPS_EVERY_MS = 500;
/** A coin's ring for every this much gold paid in (up to the sound's own cap). */
const COINS_PER_RING = 150;

/** The wind keys ([ ] and 1 to 5) are for tuning, not play: live only in a dev build or with `?debug=1`. */
const DEBUG_KEYS = import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1';

/**
 * Playtest switches, for feeling out the sailing before tuning navigation.json: `?pace=0.4` sails every ship at sea
 * at that share of her speed (picking up and losing way in the same time, the boats towing as much slower), the day
 * as much longer so a voyage takes the same days (calendar.json's own rule); `?turn=0.5` turns every ship that much
 * slower, in battle too (the battle's own pace is untouched by `pace`). Saves keep their fingerprint; `?pace=1&turn=1`
 * is the game as tuned (the browser tests sail it).
 *
 * The playtest now (PLAYTEST): ships at sea at about the battle's pace (combat.json battle 0.3 against 0.7 tiles a
 * second per speed point), so a ship is about as quick for her size at sea as in a fight, and turning at half the
 * rate, so a tack or a turn takes a ship's time.
 */
const PLAYTEST = { pace: 0.45, turn: 0.5 };
function playtestPace(content: ContentPack, params: URLSearchParams): ContentPack {
  const share = (name: 'pace' | 'turn') => {
    const v = Number(params.get(name));
    return v > 0 ? v : PLAYTEST[name];
  };
  const [pace, turn] = [share('pace'), share('turn')];
  if (pace === 1 && turn === 1) return content;
  const nav = content.navigation;
  return {
    ...content,
    calendar: { ...content.calendar, ticksPerDay: Math.round(content.calendar.ticksPerDay / pace) },
    navigation: {
      ...nav,
      tilesPerSecondPerSpeedPoint: nav.tilesPerSecondPerSpeedPoint * pace,
      accelPerSecond: nav.accelPerSecond * pace,
      ...(nav.decelPerSecond !== undefined ? { decelPerSecond: nav.decelPerSecond * pace } : {}),
      turnDegPerSecondPerPoint: nav.turnDegPerSecondPerPoint * turn,
      ...(nav.course ? { course: { ...nav.course, towTilesPerSecond: nav.course.towTilesPerSecond * pace } } : {}),
    },
  };
}
/** Which way `to` lies from `from`, as one of eight points of the compass (y grows southward). */
/** Where a ship lies from her own bow, as the lookout calls it ("off the starboard bow"). */
function fromTheBow(from: { x: number; y: number; headingDeg: number }, to: { x: number; y: number }): string {
  const deg = ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI - from.headingDeg + 720) % 360;
  return ['dead ahead', 'off the starboard bow', 'on the starboard beam', 'off the starboard quarter', 'astern', 'off the port quarter', 'on the port beam', 'off the port bow'][
    Math.round(deg / 45) % 8
  ]!;
}
function pointOfCompass(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const deg = ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8]!;
}
/** Guns further off than this (tiles) are heard as a distant rumble rather than close cannon. */
const FAR_GUNS_TILES = 15;
/** How often the boarders' fight is heard again while the hulls lie grappled (about one melee clip's length). */
const BOARDING_SOUND_MS = 5000;
/** About how often each ship in a skirmish within sight fires a broadside. */
const VOLLEY_MS = 2200;
/** How often the plotted line to a destination on the chart is redrawn (display only). */
const REPLAN_MS = 1000;
/**
 * How often a course checks its way is still clear, and re-plots it if not: by the game's clock, not the
 * screen's, so a voyage sails the same way however busy the machine (once a second at 1x).
 */
const REPLAN_TICKS = TICKS_PER_SECOND;
/** Cruising holds at 1x within this many tiles of a coast, or of a port. */
const HOLD_COAST_TILES = 3;
const HOLD_PORT_TILES = 5;
/** A ship this near (tiles) is called out ("Sail ho!") and holds time at 1x. */
const SAIL_HO_TILES = 15;
/** A click this near a ship on the screen picks her (pixels): beside or below her, and up to her name banner above. */
const PICK_PX = 40;
const PICK_ABOVE_PX = 140;
/** A port's town and the name over it, wider and taller than a ship. */
const PORT_PICK_PX = 110;
const PORT_PICK_ABOVE_PX = 180;
/** Food for this many times a voyage's days counts as enough (winds are fickle); less, only just. */
const FOOD_MARGIN = 1.3;
/** The HUD's strip fades after this long with nothing on it changing. */
const STRIP_REST_MS = 6000;
const SAIL_HO_MS = 3500;
const SONG_MS = 6000;

async function main() {
  // A trackpad pinch never zooms the page itself: magnified, the page pushes the HUD and the menus off the
  // screen. (Chrome reports a pinch as a wheel with Ctrl held; Safari as its own gesture events.)
  window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, (e) => e.preventDefault());
  const stage = document.getElementById('stage')!;
  // The loading screen at once, while the map loads and decodes (storyboard 1.1).
  let loading = showLoading(stage, sceneUrl('loading.dawn'));
  const unpaced = loadContent();
  const content = playtestPace(unpaced, new URLSearchParams(location.search));
  const def = content.maps.caribbean;
  const layer = async (name: string, share: number) => {
    const url = Object.entries(mapFiles).find(([path]) => path.endsWith(`/${name}`))?.[1];
    if (!url) throw new Error(`map layer ${name} not found`);
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    loading.progress(share, 'Charting the Main');
    return bytes;
  };
  const map = decodeRasterMap(def, {
    terrain: await layer(def.layers.terrain, 0.2),
    elevation: await layer(def.layers.elevation, 0.35),
    zones: await layer(def.layers.zones, 0.5),
  });
  // The classic ports, for the start screen (the capitals, a saved career's port): a career's own list, with its
  // pirate havens drawn from its seed, is placed once the seed is known.
  const classic = placeSettlements(def, map, content.settlements);
  /** A nation's capital: where a career under its flag begins (the same in every career's list). */
  const capitalOf = (n: string) => classic.find((s) => s.nation === n && s.type === 'capital') ?? classic.find((s) => s.id === def.start.port)!;
  loading.progress(0.6, 'Placing the ports');
  // The start screen: continue a stored career, or pick a new one's difficulty.
  // Only gameplay content counts: new music or sprite framing shouldn't flag every old save.
  const fingerprint = contentFingerprint(gameplayContent(unpaced));
  // Whatever is stored goes to the start screen, readable or not, so a bad save is never silently replaced.
  const stored = await loadStoredSave();
  // A new game gets a random seed; with the input log it replays the run exactly (PRD section 16).
  // `?seed=N` starts a known world, for replays and tests: with nothing stored it opens straight onto a new
  // career, at `?difficulty=` or the default.
  const params = new URLSearchParams(location.search);
  const asked = Number(params.get('seed') ?? NaN);
  // The title takes over from the loading screen; once a career is chosen, it comes back while the world is made.
  const titled = Boolean(stored) || !Number.isInteger(asked);
  if (titled) loading.done();
  const choice = titled
      ? await chooseCareer(stage, {
          raw: stored || undefined,
          fingerprint,
          startDate: def.startDate,
          ticksPerDay: content.calendar.ticksPerDay,
          settlements: classic,
          levels: content.combat.difficulty.levels,
          defaultLevel: content.combat.difficulty.default,
          flags: (['england', 'spain', 'france', 'netherlands'] as const).map((n) => {
            const home = capitalOf(n);
            // Its wars as the career opens (the politics of the start date).
            const foes = enemiesOf(content, {} as WorldState, n).filter((x) => x !== 'pirate');
            return {
              nation: n,
              name: countryName[n]!,
              port: home.name.replace(/ \(.*\)$/, ''),
              island: content.politics.flag.nations[n]?.island ?? '',
              about: content.politics.flag.nations[n]?.about ?? '',
              wars: foes.length ? `At war with ${foes.map((x) => countryName[x]).join(' and ')}` : 'At peace with all',
              peace: !foes.length,
              art: sceneUrl(harbourId(home)),
            };
          }),
          defaultFlag: 'england',
        })
      : // A seed run leaves the First Voyage off (every test keeps its world) unless `&voyage=1` asks for it.
        { difficulty: difficultyOf(content, params.get('difficulty') ?? undefined).id, nation: params.get('nation') ?? 'england', voyage: params.get('voyage') === '1' };
  if (titled) loading = showLoading(stage, sceneUrl('loading.dawn'));
  loading.progress(0.7, 'Raising the wind');
  const resumed = 'save' in choice ? choice.save : undefined;
  const seed = resumed?.seed ?? (Number.isInteger(asked) ? asked >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]!);
  // This career's ports: the havens drawn from its seed (havens.json), the same again when it is resumed.
  const settlements = placeSettlements(def, map, careerSettlements(content, seed));
  const windAt = createWindField(content, def, map);
  // Sea lanes for the AI ships, found per port pair on demand.
  const lanes = createSeaLanes(map, settlements, content.traffic.laneCell);
  // The clock starts at the map's start hour; the date is unchanged (still day 0).
  const startTick = Math.round((def.startHour / 24) * content.calendar.ticksPerDay);
  // The flag a new career sails under: she starts at its capital (England's is the map's own start), and its
  // governors know her.
  const nation = ('nation' in choice ? choice.nation : 'england') as Nation;
  const home = capitalOf(nation);
  const begun = createWorld(def);
  if (home.id !== def.start.port) {
    const [x, y] = lanes.berth(home.id) ?? [home.x + 1, home.y + 1];
    begun.ships[def.start.shipId] = { ...begun.ships[def.start.shipId]!, x, y };
  }
  // A restored state already carries its markets, weather and RNG streams; seeding them again would reset them.
  // A save from before ships sailed gets its population topped up a ship a day.
  const fresh = (): WorldState => {
    const w = withTraffic(
      withEconomy(withWeather({ ...begun, tick: startTick, ...('difficulty' in choice ? { difficulty: choice.difficulty } : {}) }, content, def, seed), content, settlements, seed),
      content,
      settlements,
      lanes,
      seed,
    );
    const p = withPolitics({ ...w, captain: { ...w.captain!, nation, standing: { ...w.captain!.standing, [nation]: content.politics.flag.standing } } }, seed);
    return 'voyage' in choice && choice.voyage ? withVoyage(p, content, map, settlements, lanes, home.id, nation, seed) : p;
  };
  const world = resumed?.state ?? fresh();
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map, windAt),
    createPoliticsSystem(content, def.startDate, settlements),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt, settlements),
    // Finding the pirate coves, from what the others did.
    createHavensSystem(content, settlements),
    // The First Voyage's chapters, while she sails it.
    createVoyageSystem(content, settlements),
    // Her deeds said out loud, from what the others did.
    createHonoursSystem(content, settlements),
    // Last, so it writes up what the others did.
    createLogbookSystem(content, settlements),
  ]);
  // A new career begins in port, so the ship can be outfitted before she first sails.
  if (!resumed && def.start.port) {
    sim.send({ type: 'Dock', shipId: def.start.shipId, settlementId: home.id });
    sim.applyCommands();
  }
  const breezes = createBreezeField(content, def, map);
  // Sound needs a user gesture before the browser lets it play; V toggles mute, N the music.
  const audio = createAudio({ samples: sampleManifest(), tunes: content.music.tunes });
  // The illustrated harbour scenes in port; the sea and its battles are 3D (below).
  const renderer = await createHarbourRenderer(content, {
    atlases: Object.fromEntries(Object.entries(shipAtlases).map(([p, url]) => [p.split('/').pop()!.replace(/\.png$/, ''), url])),
    palettes: [palette('corsair.gpl'), palette('corsair-dusk.gpl'), palette('corsair-night.gpl')],
  });

  const viewport = stage.appendChild(document.createElement('div'));
  viewport.className = 'viewport';
  viewport.appendChild(renderer.canvas);
  // The sea and its battles are drawn in 3D; the 2D renderer paints only the illustrated harbour scenes in port.
  const sea3d = await createSeaRenderer(content, map, {
          playerId: def.start.shipId,
          settlements,
          windAt,
          seaWindAt: createWindField(content, def, map, { breeze: false }),
          // ?sea=plain (then layers by name) for review: what's drawn on the 3D sea.
          sea: new URLSearchParams(location.search).get('sea')?.split(',') ?? undefined,
          sound: (id, opts) => audio.playSfx(id, opts),
          // A ship in sight further off than her card (shiplabels.ts, near the player): what she is, as Sail ho! calls
          // her ("Pirate sloop"; a famous pirate by name).
          shipLabel: (s, me) =>
            Math.hypot(s.x - me.x, s.y - me.y) <= NEAR_TILES ? undefined : s.ai?.famous ? `${s.ai.name}, ${shipKind(s.classId)}` : shipTitle(s).replace(/^./, (c) => c.toUpperCase()),
          townLine: (s, state) => {
            // "Prosperous English Capital": the town's trend, nation and kind, and anything ailing it.
            const t = townOf(content, state, s);
            const trend = t.trend > 0 ? 'Prosperous ' : t.trend < 0 ? 'Struggling ' : '';
            const nation = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch', pirate: 'Pirate' }[s.nation] ?? '';
            const kind = s.type === 'capital' ? 'Capital' : s.type === 'haven' ? 'Haven' : s.type === 'mission' ? 'Mission' : s.size === 'hamlet' ? 'Settlement' : s.size === 'city' ? 'City' : 'Town';
            // Blockaded: by whom (the nation of the warship lying off it).
            const countryName: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };
            const by = t.blockaded ? Object.values(state.ships).find((x) => x.ai?.blockadeOf === s.id && (x.ai.waitUntil ?? 0) > state.tick)?.ai?.nation : undefined;
            const blockade = t.blockaded ? `blockaded${by ? ` by ${countryName[by] ?? by}` : ''}` : '';
            const woes = [blockade, plagued(state, s.id) ? 'plague' : '', famine(content, state, s.id) ? 'famine' : ''].filter(Boolean);
            return `${trend}${nation} ${kind}${woes.length ? ` · ${woes.join(', ')}` : ''}`;
          },
        });
  viewport.appendChild(sea3d.canvas);
  loading.progress(0.9, 'Setting sail');
  /** The ship the captain has picked (a click on her or her label, Tab, or the last Sail ho!): Space acts on her. */
  let target: string | undefined;
  /** Picked by the captain (a click or Tab), not only called out: she comes before a course to follow. */
  let chosen = false;
  const pick = (id: string | undefined) => {
    target = id;
    chosen = Boolean(id);
  };
  const shipLabels = createShipLabels(viewport, pick);
  // For review and tests: the 3D renderer's showcase and sky controls.
  (window as unknown as { __corsair3d?: typeof sea3d }).__corsair3d = sea3d;
  // ?sky=17.5 starts the 3D sky and the harbour paintings at that hour, for reviewing sunrise, sunset and night.
  const skyHour = Number(new URLSearchParams(location.search).get('sky'));
  if (Number.isFinite(skyHour) && skyHour > 0) sea3d.setSkyHour(skyHour);
  // The harbour keeps the game's clock, so it is shown that far ahead of it (the clock itself is untouched).
  const harbourSkyShift = Number.isFinite(skyHour) && skyHour > 0 ? tickAtHour(content.calendar, skyHour, sim.state.tick) - sim.state.tick : 0;
  // At sea the wheel and the trackpad's pinch zoom the map, from anywhere on the screen (the HUD too).
  window.addEventListener('wheel', (e) => {
    if (sea3d.canvas.style.display === 'none') return;
    e.preventDefault();
    // A pinch reports small, fine-grained deltas; a wheel notch about 100.
    sea3d.zoom(Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / (e.ctrlKey ? 8 : 40)));
  }, { passive: false });
  const hudRoot = stage.appendChild(document.createElement('div'));
  const panelRoot = stage.appendChild(document.createElement('div'));
  const portRoot = stage.appendChild(document.createElement('div'));
  const hailRoot = stage.appendChild(document.createElement('div'));
  const logRoot = stage.appendChild(document.createElement('div'));
  // The First Voyage at sea: her orders, the lesson in hand, the cay's name over its smoke.
  const voyageRoot = stage.appendChild(document.createElement('div'));
  // The wind's lesson has been shown (she pointed into the wind): bearing away again learns it.
  let windShown = false;
  // Deed cards (docs/design/first-voyage.md): her honours said out loud, one at a time, under the moments.
  const deedRoot = stage.appendChild(document.createElement('div'));
  // The honours already there when the career was loaded say nothing; each new one is queued once.
  const deedsSeen = new Set((sim.state.captain?.honours ?? []).map((h) => h.id));
  const deedQueue: Honour[] = [];
  // When the card at the head of the queue was first shown (0: not yet), and whether it waits to be dismissed.
  let deedShownAt = 0;
  let deedStays = false;
  let deedInPort = false;
  const closeDeed = () => {
    deedQueue.shift();
    deedShownAt = 0;
  };
  // Moments (storyboard 2.13): a letter, a promotion, a famous pirate's first sighting, a hoard, a map piece; one
  // at a time, over everything, the world waiting.
  const momentRoot = stage.appendChild(document.createElement('div'));
  const moments: Moment[] = [];
  // A career on the First Voyage opens with the governor's letter of the storm's wreck, and her orders (a seed run
  // too, when it asks for the voyage).
  const voyage = sim.state.captain?.voyage;
  if (!resumed && voyage) {
    moments.push({
      kind: 'voyage',
      town: home.name,
      date: formatDate(dateOf(def.startDate, Math.floor(sim.state.tick / content.calendar.ticksPerDay))),
      ship: shipKind(sim.state.ships[def.start.shipId]!.classId),
      cay: voyage.cay.name,
      bearing: voyage.cay.bearing,
      orders: voyageOrders(voyage, home.name),
    });
  }
  // A career begun from the start screen opens with the governor's letter and the first goal (a ?seed= run, for
  // tests and replays, goes straight in).
  if (!resumed && titled && def.start.port && !voyage) {
    const me = sim.state.ships[def.start.shipId]!;
    const town = home;
    const at = enemiesOf(content, sim.state, town.nation).filter((n) => n !== 'pirate');
    const goal = nextGoal(careerGoals(content, sim.state, settlements), sim.state.captain?.gold ?? 0);
    // Where the first goal gets done ("the shipwright at Port Royal"), else what it brings.
    const building = goal && ({ guns: 'shipwright', fit: 'shipwright', fitted: 'shipwright', crew: 'tavern', marque: 'governor', rank: 'governor' } as Record<string, string>)[goal.id];
    const goalPort = goal?.port && settlements.find((s) => s.id === goal.port)?.name;
    moments.push({
      kind: 'opening',
      town: town.name,
      date: formatDate(dateOf(def.startDate, Math.floor(sim.state.tick / content.calendar.ticksPerDay))),
      ship: shipKind(me.classId),
      guns: shipStats(content, me).guns,
      men: crewOf(content, me),
      enemies: at.length ? `the ${at.map((n) => ({ spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch' })[n] ?? n).join(' and the ')} are` : '',
      ...(goal ? { goal: { title: goal.title, have: goal.unit ? `${goal.have.toLocaleString()} of ${goal.of.toLocaleString()} ${goal.unit}` : 'not yet', where: building && goalPort ? `the ${building} at ${goalPort}` : goal.why } } : {}),
    });
  }
  /** News already shown as a letter this session (closing it hears it, so it is not shown again). */
  const lettered = new Set<string>();
  /** Closes the moment at the head of the queue; a letter's news is heard then, and goes into the log. */
  const closeMoment = () => {
    const done = moments.shift();
    if (done?.kind === 'letter' && player().docked) {
      sim.send({ type: 'HearNews', shipId: player().id, id: done.newsId });
      sim.applyCommands();
    }
  };
  // A building the port screen is asked to open (a war letter's "To the governor").
  let portRequest: { service: Service } | undefined;
  // The captain's log (L) is open: the world waits, as with the chart.
  let logOpen = false;
  // The ship being spoken and the news she brought; the clock stops while the captains talk.
  let hailing: { targetId: string; news: string[] } | undefined;
  const battleRoot = stage.appendChild(document.createElement('div'));
  // A sea battle in progress (PRD section 9.1): world time stands still until its result is applied.
  let fight:
    | {
        battle: Battle;
        targetId: string;
        acc: number;
        heardAt: number;
        /** When the boarders' fight is next heard (ms), while the hulls are grappled. */
        meleeAt?: number;
        /** Her going down, and the fight's end, heard once. */
        sankHeard?: boolean;
        endHeard?: boolean;
        /** Her guns were running out at the last frame: the trucks are heard as they start. */
        runningOut?: boolean;
        /** Who she is, kept from the start: a ship taken or sunk is gone from the world by the report. */
        name: string;
        title: string;
        nation?: Nation;
        /** A famous pirate's id: she flies her own flag. */
        famous?: string;
        /** The player attacked her (rather than being run down). */
        attacked: boolean;
        /** What the fight changed, once its result has reached the world. */
        report?: BattleReport;
      }
    | undefined;
  let eventsSeen = 0;
  // Fights begun out of her sight, hunter by prey: told when they come into it.
  const unseenFights = new Map<string, string>();
  // When each ship in a skirmish within sight fires next.
  const nextVolley = new Map<string, number>();
  // Space held in battle: fire each broadside as it bears. Released (or the window loses focus), it stops.
  let fireHeld = false;
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') fireHeld = false;
  });
  window.addEventListener('blur', () => (fireHeld = false));
  /** Seat the ships as they lay where they met. */
  const startBattle = (targetId: string, attacked: boolean) => {
    const me = player();
    const them = sim.state.ships[targetId];
    if (!them || fight) return;
    followingBeforeFight = me.assist?.mode === 'course';
    const bearingDeg = ((Math.atan2(them.x - me.x, -(them.y - me.y)) * 180) / Math.PI + 360) % 360;
    const battle = createBattle(content, {
      map,
      wind: windAt(sim.state, me.x, me.y),
      // Only the flagship fights: her berths' worth of the fleet's men, at her own pace.
      player: { ...me, crew: Math.min(crewOf(content, me), shipStats(content, { ...me, fleetSpeed: undefined }).maxCrew), fleetSpeed: undefined },
      enemy: them,
      seed: (seed ^ Math.imul(sim.state.tick, 2654435761)) >>> 0,
      bearingDeg,
      // Fallen on while under way, she gets a fair start; her own attack, or caught napping, starts as they met.
      fair: !attacked && me.speed >= content.combat.battle.nappingSpeed,
      playerMorale: moraleOf(content, sim.state),
      difficulty: difficultyOf(content, sim.state.difficulty),
    });
    hailing = undefined;
    fight = { battle, targetId, acc: 0, heardAt: -1, name: them.ai?.name ?? 'Enemy', title: crewLook(them) ? `${shipTitle(them)} · ${crewLook(them)}` : shipTitle(them), nation: them.ai?.nation, famous: them.ai?.famous, attacked };
  };
  /**
   * The result goes into the world as a command the moment the fight ends (so replays and saves see it),
   * and the after-action report reads what it changed from the world's BattleOver event.
   */
  const settleBattle = () => {
    const result = fight?.battle.result();
    if (!fight || !result || fight.report) return;
    sim.send({ type: 'BattleEnded', shipId: player().id, targetId: fight.targetId, result });
    sim.applyCommands();
    fight.report = sim.events().filter((e) => e.type === 'BattleOver').at(-1)?.payload as unknown as BattleReport;
  };
  /** Back on the course she was following before the fight, and the HUD says so. */
  const resumeCourse = () => {
    const me = player();
    if (!followingBeforeFight || !destination || me.docked) return;
    followingBeforeFight = false;
    const berth = lanes.berth(destination.id);
    const route = berth ? lanes.path([me.x, me.y], berth) : undefined;
    if (!route) return;
    sim.send({ type: 'SetAssist', shipId: me.id, assist: 'course', x: destination.x, y: destination.y, portId: destination.id, route: route.slice(1) });
    courseNote = { text: `Back on course for ${destination.name}: steer to take the helm`, kind: 'Course', icon: 'ui.icon.course', until: performance.now() + 4000 };
  };
  /** Back to the sea; a prize must first be settled on the plunder screen. */
  const endBattle = () => {
    settleBattle();
    if (!fight?.report || sim.state.prize) return;
    fight = undefined;
    resumeCourse();
  };
  /**
   * The voyage planner's trades, from what the captain has seen (PRD section 6): for each good, buying where
   * she last saw it cheapest and selling where it fetched most, about what a full hold makes (the sale price
   * sagging as she sells, by that market's depth), the days at sea along the lanes at her speed, and how close
   * the way runs to a pirate haven. Leads are goods one port makes and another needs, prices not yet seen.
   */
  /** Tiles a day at a fair average of her best speed (beating and reaching together), as the voyages reckon them. */
  const sailPerDay = (me: Ship) => content.navigation.tilesPerSecondPerSpeedPoint * shipStats(content, me).speed * 0.6 * (content.calendar.ticksPerDay / TICKS_PER_SECOND);
  const wayLength = (way: [number, number][]) => way.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - way[i]![0], p[1] - way[i]![1]), 0);
  /** Whether the food aboard lasts a voyage of `days`, as a card line: enough, only just, or buy food first. */
  const foodFor = (days: number): CardLine => {
    const food = Math.floor(foodDays(content, player()));
    const sea = `${Math.max(1, Math.round(days))} ${Math.round(days) === 1 ? 'day' : 'days'} at sea`;
    if (food >= days * FOOD_MARGIN) return { text: `<b>Food for ${food} days:</b> enough for ${sea}`, tone: 'good' };
    if (food >= days) return { text: `<b>Food for ${food} days:</b> only just, for ${sea}`, tone: 'bad' };
    return { text: `<b>Food for ${food} days, ${sea}:</b> buy food before you sail`, tone: 'bad' };
  };
  const voyagePlan = () => {
    const me = player();
    const known = sim.state.captain?.knownPrices ?? {};
    const gold = sim.state.captain?.gold ?? 0;
    const room = Math.max(1, fleetHold(content, sim.state, me) - (me.cargo.food ?? 0));
    // Tiles a day at a fair average of her best speed (beating and reaching together).
    const perDay = content.navigation.tilesPerSecondPerSpeedPoint * shipStats(content, me).speed * 0.6 * (content.calendar.ticksPerDay / TICKS_PER_SECOND);
    const laneLength = (a: string, b: string) => {
      const r = lanes.route(a, b);
      return r ? r.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - r[i]![0], p[1] - r[i]![1]), 0) : undefined;
    };
    const havens = settlements.filter((s) => s.nation === 'pirate');
    const reach = content.traffic.pirateRangeTiles;
    const risk = (a: string, b: string) => riskAlong(lanes.route(a, b) ?? []);
    const riskAlong = (r: [number, number][]): { risk: 'low' | 'some' | 'high'; haven: string } => {
      // The way's nearest pass by a haven: how near, and whose.
      let near = Infinity;
      let haven = '';
      for (const p of r) {
        for (const h of havens) {
          const d = Math.hypot(h.x - p[0], h.y - p[1]);
          if (d < near) [near, haven] = [d, havenKnown(content, sim.state, h) ? h.name : 'pirate waters'];
        }
      }
      return { risk: near < reach * 0.35 ? 'high' : near < reach * 0.7 ? 'some' : 'low', haven };
    };
    const toStart = (s: PlacedSettlement) => (me.docked === s.id ? 0 : Math.hypot(s.x - me.x, s.y - me.y) / perDay);
    // Candidates are ranked on the straight-line distance first; only the best few have their lanes found
    // (finding a lane is the slow part), then they are ranked again on the real days at sea.
    const straight = (a: PlacedSettlement, b: PlacedSettlement) => Math.hypot(a.x - b.x, a.y - b.y) / perDay;
    type Candidate = { good: string; from: PlacedSettlement; to: PlacedSettlement; buy?: number; sell?: number; profit?: number; pays?: number; score: number };
    const priced: Candidate[] = [];
    const unpriced: Candidate[] = [];
    const worth = (id: string) => content.goods.find((x) => x.id === id)?.basePrice ?? 0;
    // The merchant buys only what his purse covers: a full one, by the port's people (its size is common knowledge).
    const purseAt = (s: PlacedSettlement) => purseFull(content, townOf(content, sim.state, s).people);
    // Ports closed to her (at war with her flag, or that she made an enemy of) are no voyage, nor a cove she hasn't found.
    const open = settlements.filter((s) => {
      const why = closedTo(content, sim.state, s);
      return why !== 'at-war' && why !== 'hostile' && havenKnown(content, sim.state, s);
    });
    for (const g of content.goods.filter((x) => !x.staple)) {
      for (const from of open) {
        for (const to of open) {
          // Selling where she lies is the merchant's business, not a voyage.
          if (from === to || to.id === me.docked) continue;
          const buy = known[from.id]?.prices[g.id]?.buy;
          const seen = known[to.id]?.prices[g.id];
          const days = Math.max(0.5, toStart(from) + straight(from, to));
          if (buy !== undefined && seen?.sell !== undefined) {
            const carried = Math.min(room, Math.floor(gold / buy));
            const paid = Math.floor(purseAt(to) / seen.sell);
            const units = Math.min(carried, paid);
            if (units < 1 || seen.sell <= buy) continue;
            const sag = 0.125 * Math.min(1, units / Math.max(1, seen.depth ?? 99));
            const profit = Math.round((units * (seen.sell * (1 - sag) - buy)) / 10) * 10;
            if (profit > 0) priced.push({ good: g.id, from, to, buy, sell: seen.sell, profit, ...(paid < carried ? { pays: paid } : {}), score: profit / days });
          } else if (
            // Leads (prices unseen) only within a few days' sail, so the list stays near enough to act on.
            straight(from, to) * perDay <= 360 &&
            tradeLean(content, from, g.id) === 'exports' &&
            tradeLean(content, to, g.id) === 'wants'
          ) {
            // Ranked on what a full hold would fetch there, as far as his purse goes.
            const paid = Math.floor(purseAt(to) / Math.max(1, worth(g.id)));
            unpriced.push({ good: g.id, from, to, ...(paid < room ? { pays: paid } : {}), score: (Math.min(room, paid) * worth(g.id)) / days });
          }
        }
      }
    }
    const perTrip = (t: { daysToStart: number; days: number }) => Math.max(0.5, t.daysToStart + t.days);
    const sail = (c: Candidate) => {
      const length = laneLength(c.from.id, c.to.id);
      // Her course goes where the buying is, unless it is done: she lies there, or has the cargo aboard.
      const bought = me.docked === c.from.id || (me.cargo[c.good] ?? 0) > 0;
      return length === undefined
        ? undefined
        : { good: c.good, from: c.from, to: c.to, go: bought ? c.to : c.from, daysToStart: toStart(c.from), days: length / perDay, ...(c.pays !== undefined ? { pays: c.pays } : {}), ...risk(c.from.id, c.to.id) };
    };
    const trades = priced
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .flatMap((c) => {
        const t = sail(c);
        return t ? [{ ...t, buy: c.buy!, sell: c.sell!, profit: c.profit! }] : [];
      })
      .sort((a, b) => b.profit / perTrip(b) - a.profit / perTrip(a));
    // Cargo aboard (her gold spent on it): where it sells above what she paid, as far as the merchant's purse goes,
    // sailing from where she is. Plunder cost nothing.
    const length = (r: [number, number][] | undefined) => (r ? r.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - r[i]![0], p[1] - r[i]![1]), 0) : undefined);
    const aboard = content.goods
      .filter((g) => !g.staple && (me.cargo[g.id] ?? 0) > 0)
      .flatMap((g) => {
        const held = me.cargo[g.id]!;
        const cost = (me.paid?.[g.id] ?? 0) / held;
        return open.flatMap((to) => {
          const sell = known[to.id]?.prices[g.id]?.sell;
          if (to.id === me.docked || sell === undefined || sell <= cost) return [];
          const paid = Math.floor(purseAt(to) / sell);
          const units = Math.min(held, paid);
          const sag = 0.125 * Math.min(1, units / Math.max(1, known[to.id]!.prices[g.id]!.depth ?? 99));
          const profit = Math.round((units * (sell * (1 - sag) - cost)) / 10) * 10;
          return units > 0 && profit > 0 ? [{ good: g.id, to, cost, sell, profit, held, ...(paid < held ? { pays: paid } : {}), straight: Math.hypot(to.x - me.x, to.y - me.y) / perDay }] : [];
        });
      })
      .sort((a, b) => b.profit / Math.max(0.5, b.straight) - a.profit / Math.max(0.5, a.straight))
      // The best port for each good aboard.
      .filter((c, i, all) => all.findIndex((o) => o.good === c.good) === i)
      .flatMap((c) => {
        const here = settlements.find((s) => s.id === me.docked);
        const way = here ? lanes.route(here.id, c.to.id) : lanes.path([me.x, me.y], lanes.berth(c.to.id) ?? [c.to.x, c.to.y]);
        const miles = length(way);
        if (miles === undefined) return [];
        // `from` is where she lies (at sea, the port she sells at: the row names no buying port).
        return [{ good: c.good, from: here ?? c.to, to: c.to, go: c.to, daysToStart: 0, days: miles / perDay, buy: Math.round(c.cost), sell: c.sell, profit: c.profit, held: c.held, ...(c.pays !== undefined ? { pays: c.pays } : {}), ...riskAlong(way!) }];
      });
    trades.push(...aboard);
    trades.sort((a, b) => b.profit / perTrip(b) - a.profit / perTrip(a));
    // One lead a good, so the leads are worth reading.
    const leads = unpriced
      .sort((a, b) => b.score - a.score)
      .filter((c, i, all) => all.findIndex((o) => o.good === c.good) === i)
      .slice(0, 4)
      .flatMap((c) => {
        const t = sail(c);
        return t ? [t] : [];
      });
    // Contracts she has heard of: where to buy the goods (the cheapest she knows, else the nearest port that
    // makes them; none when her hold has them already), the days to sail there and on, and the days left.
    const tpd = content.calendar.ticksPerDay;
    const heard = new Set(sim.state.captain?.heard ?? []);
    const contracts = (sim.state.contracts ?? [])
      .filter((c) => heard.has(c.newsId) && c.endTick > sim.state.tick)
      .flatMap((c) => {
        const to = settlements.find((s) => s.id === c.settlementId);
        if (!to) return [];
        const need = c.units - c.delivered;
        const cheapest = open
          .filter((s) => s !== to && known[s.id]?.prices[c.good]?.buy !== undefined)
          .sort((a, b) => known[a.id]!.prices[c.good]!.buy - known[b.id]!.prices[c.good]!.buy)[0];
        const staple = content.goods.find((g) => g.id === c.good)?.staple;
        const maker = open
          .filter((s) => s !== to && (staple || tradeLean(content, s, c.good) === 'exports'))
          .sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y))[0];
        const inHold = (me.cargo[c.good] ?? 0) >= need;
        const from = inHold ? undefined : (cheapest ?? maker);
        const days = from ? toStart(from) + (laneLength(from.id, to.id) ?? 0) / perDay : toStart(to);
        return [{ good: c.good, to, from, inHold, units: c.units, delivered: c.delivered, reward: c.reward, days, daysLeft: (c.endTick - sim.state.tick) / tpd }];
      })
      .sort((a, b) => b.reward / Math.max(0.5, b.days) - a.reward / Math.max(0.5, a.days));
    return { trades: trades.slice(0, 5), leads, contracts };
  };
  /**
   * After a fight that left her hurt: the nearest port that will have her and has a shipwright (not a
   * hamlet), and how far, so the report can say where to go next.
   */
  const repairAdvice = (): string | undefined => {
    const me = player();
    const stats = shipStats(content, me);
    const hull = (me.hull ?? stats.hullMax) / stats.hullMax;
    const sails = (me.sailCondition ?? 100) / 100;
    if (hull > 0.6 && sails > 0.6) return undefined;
    const standing = sim.state.captain?.standing ?? {};
    const port = settlements
      .filter((s) => s.size !== 'hamlet' && (s.nation === 'pirate' || (standing[s.nation] ?? 0) > content.combat.standing.refused))
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    if (!port) return undefined;
    const km = Math.round((Math.hypot(port.x - me.x, port.y - me.y) * kmPerTile) / 10) * 10;
    return `What now: your ship is hurt (hull ${Math.round(hull * 100)}%, sails ${Math.round(sails * 100)}%). The nearest shipwright is at ${port.name}, about ${km} km off: press M and pick it.`;
  };
  // Coves she knew of last frame, to say when she finds another.
  let havensKnown = sim.state.captain?.knownHavens?.length ?? 0;
  // Famous pirates first seen close together: only the first stops the world; the next within the gap is a line.
  const FAMOUS_GAP_DAYS = 3;
  let lastFamousMoment = -Infinity;
  // Following a course when a fight began: she takes it up again after.
  let followingBeforeFight = false;
  const takePlunder = (choice: PlunderChoice) => {
    sim.send({ type: 'TakePlunder', shipId: player().id, ...choice });
    sim.applyCommands();
    fight = undefined;
    resumeCourse();
  };
  let destination: PlacedSettlement | undefined;
  // The route plotted to it, and when it was last plotted.
  let guide: [number, number][] | undefined;
  // The First Voyage's line to her order in hand, re-plotted as often as the chart's.
  let questGuide: [number, number][] | undefined;
  let lastQuestGuide = -Infinity;
  let lastGuide = -Infinity;
  // Whether the chart was open when a key went down, read before the chart's own keys close it (Esc closes the chart
  // and should not also let the ship picked go).
  let chartWasOpen = false;
  window.addEventListener('keydown', () => (chartWasOpen = charts.open), true);
  const charts = createCharts(stage, map, settlements, (port) => {
    destination = port;
    lastGuide = -Infinity;
  }, {
    follow: (port) => follow(port),
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
    wars: () => {
      const name: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };
      const pairs: [string, string][] = [];
      NATIONS.forEach((a, i) => NATIONS.slice(i + 1).forEach((b) => atWar(content, sim.state, a, b) && pairs.push([name[a]!, name[b]!])));
      return pairs;
    },
    pirateRangeTiles: content.traffic.pirateRangeTiles,
    welcome: (id) => {
      const s = settlements.find((x) => x.id === id);
      const sick = plagueDaysLeft(content, sim.state, id);
      if (s && sick !== undefined) return `Plague: the port is shut to all shipping for ${plagueLeftSaid(sick)}.`;
      if (!s || s.nation === 'pirate') return undefined;
      const flag = sim.state.captain?.nation;
      if (flag && closedTo(content, sim.state, s) === 'at-war') {
        return `Closed to you: ${countryName[s.nation]} is at war with ${countryName[flag]}, and once you attack her ships, her warships hunt you.`;
      }
      const standing = sim.state.captain?.standing?.[s.nation] ?? 0;
      if (standing <= content.combat.standing.refused) return `They would not let you in: your standing with them is ${standing}.`;
      if (standing <= content.combat.standing.hostile) return `Their patrols hunt you (standing ${standing}); the town still trades.`;
      return undefined;
    },
    plan: () => voyagePlan(),
    people: (id) => {
      const s = settlements.find((x) => x.id === id)!;
      const t = townOf(content, sim.state, s);
      return `${(Math.round(t.people / 100) * 100).toLocaleString()} people${t.trend > 0 ? ', growing' : t.trend < 0 ? ', shrinking' : ''}${t.blockaded ? ', blockaded: little gets in' : ''}${famine(content, sim.state, id) ? ', famine' : ''}${plagued(sim.state, id) ? `, plague: port shut ${plagueLeftSaid(plagueDaysLeft(content, sim.state, id)!)}` : ''}${
        // A ship of the player's retaken from pirates waits here: marked, so she isn't forgotten once the news fades.
        (sim.state.captain?.laidUp ?? [])
          .filter((l) => l.settlementId === id)
          .map((l) => ` · your ${shipKind(l.classId)} ${l.name} lies here`)
          .join('')
      }`;
    },
    route: (id) => {
      const berth = lanes.berth(id);
      const me = player();
      return berth ? lanes.path([me.x, me.y], berth)?.slice(1) : undefined;
    },
    card: (id) => {
      const s = settlements.find((x) => x.id === id)!;
      const me = player();
      const known = sim.state.captain?.knownPrices[id];
      const ago = known && Math.floor(sim.state.tick / content.calendar.ticksPerDay) - known.day;
      const age = ago === undefined ? undefined : ago === 0 ? 'seen today' : ago === 1 ? 'seen yesterday' : `seen ${ago} days ago`;
      const goodName = (g: string) => content.goods.find((x) => x.id === g)?.name ?? g;
      const lines: CardLine[] = [];
      // What she carries that sells well there (or is needed, before its price is known)...
      for (const [g, n] of Object.entries(me.cargo)) {
        if (g === 'food' || !n) continue;
        const sell = known?.prices[g]?.sell;
        if (sell !== undefined && sell > ((me.paid?.[g] ?? 0) / n) * 1.1) lines.push({ text: `<b>${goodName(g)} sells well:</b> ${sell}`, tone: 'good', age });
        else if (sell === undefined && tradeLean(content, { id }, g) === 'wants') lines.push({ text: `<b>${goodName(g)} is needed here</b>`, tone: 'good' });
      }
      // ...what it makes cheap, and what else it needs.
      for (const g of content.goods.filter((x) => !x.staple && tradeLean(content, { id }, x.id) === 'exports')) {
        const buy = known?.prices[g.id]?.buy;
        lines.push(buy !== undefined ? { text: `<b>${g.name} is cheap:</b> ${buy}`, tone: 'good', age } : { text: `Makes ${g.name.toLowerCase()}` });
      }
      const needs = content.goods.filter((g) => !g.staple && !me.cargo[g.id] && tradeLean(content, { id }, g.id) === 'wants').map((g) => g.name.toLowerCase());
      if (needs.length) lines.push({ text: `Needs ${needs.join(', ')}` });
      // Close to a pirate haven: their waters.
      const haven = Math.min(...settlements.filter((h) => h.nation === 'pirate').map((h) => Math.hypot(h.x - s.x, h.y - s.y)));
      if (s.nation !== 'pirate' && haven < content.traffic.pirateRangeTiles * 0.5) lines.push({ text: '<b>Pirate waters</b>: their ships hunt close by', tone: 'bad' });
      // Days by the lanes from where she is, and whether the food aboard lasts them: first, as it decides the voyage.
      const berth = lanes.berth(id);
      const way = me.docked === id || !berth ? undefined : lanes.path([me.x, me.y], berth);
      const days = me.docked === id ? 0 : (way ? wayLength(way) : Math.hypot(s.x - me.x, s.y - me.y) * 1.3) / sailPerDay(me);
      const food = days >= 0.5 ? foodFor(days) : undefined;
      return { painting: sceneUrl(harbourId(s)), days, lines: [...(food ? [food] : []), ...lines].slice(0, 4) };
    },
    hidden: (id) => {
      const port = settlements.find((s) => s.id === id);
      return Boolean(port && !havenKnown(content, sim.state, port));
    },
    closed: (id) => {
      const port = settlements.find((s) => s.id === id);
      return Boolean(port && closedTo(content, sim.state, port) === 'at-war');
    },
    mark: (id) => {
      if (plagued(sim.state, id)) return `plague · ${plagueDaysLeft(content, sim.state, id)}d`;
      const me = player();
      const known = sim.state.captain?.knownPrices[id];
      // The best price there for something in her hold, above what it cost.
      const best = Object.entries(me.cargo)
        .filter(([g, n]) => g !== 'food' && n > 0)
        .map(([g, n]) => ({ g, sell: known?.prices[g]?.sell ?? 0, paid: (me.paid?.[g] ?? 0) / n }))
        .filter((x) => x.sell > x.paid * 1.1)
        .sort((a, b) => b.sell - b.paid - (a.sell - a.paid))[0];
      return best ? `${(content.goods.find((x) => x.id === best.g)?.name ?? best.g).toLowerCase()} ${best.sell}` : undefined;
    },
    wind: (x, y) => windAt(sim.state, x, y),
    shut: () => Boolean(fight || hailing),
  });
  // 1 next to a town, falling to 0 about 18 tiles (30 km) out: within earshot of bells and quays.
  const harbourNearness = (x: number, y: number) => {
    let best = 0;
    for (const s of settlements) best = Math.max(best, 1 - Math.hypot(s.x - x, s.y - y) / 18);
    return best;
  };
  // Distances for the HUD: the map is equirectangular, close enough to square tiles.
  const { lonMin, lonMax, latMin, latMax } = def.bounds;
  const kmPerTile =
    (((lonMax - lonMin) / def.width) * 111.32 * Math.cos((((latMin + latMax) / 2) * Math.PI) / 180) +
      ((latMax - latMin) / def.height) * 110.57) /
    2;
  // Speed in knots for the compass: a tile a second covers this many km in a game hour, over a nautical mile.
  const knotsPerTilePerSecond = (kmPerTile * (content.calendar.ticksPerDay / TICKS_PER_SECOND / 24)) / 1.852;
  // CSS pixels per art pixel; the device-pixel scale behind it is always a whole number.
  let scale = 1;
  const fit = () => {
    const view = fitView(innerWidth, innerHeight, devicePixelRatio);
    renderer.resize(view.width, view.height);
    scale = view.scale / devicePixelRatio;
    renderer.canvas.style.width = `${view.cssWidth}px`;
    renderer.canvas.style.height = `${view.cssHeight}px`;
    sea3d.resize(innerWidth, innerHeight);
  };
  fit();
  window.addEventListener('resize', fit);

  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);
  // A moment takes the keys while it shows, caught before the chart's or the game's own: Enter or Escape closes it,
  // and nothing else gets through (it still counts as the key that starts the sound).
  window.addEventListener(
    'keydown',
    (e) => {
      if (!moments.length || fight) return;
      audio.unlock();
      // Space too, and it presses no button underneath.
      if (e.key === ' ') e.preventDefault();
      if ((e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') && !e.repeat) closeMoment();
      e.stopImmediatePropagation();
    },
    true,
  );
  // A deed card that stays (in port, after a fight) is closed by Enter, Escape or Space, and only it.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!deedShownAt || !deedStays || moments.length || fight) return;
      if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return;
      e.preventDefault();
      if (!e.repeat) closeDeed();
      e.stopImmediatePropagation();
    },
    true,
  );
  // Esc closes the help first, and only the help: caught before the chart's own listener, so the chart, the ship
  // picked, a hail or the log under it stays as it was.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !helpOpen) return;
      helpOpen = false;
      e.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'v' && !e.repeat) audio.toggleMute();
    if (e.key.toLowerCase() === 'n' && !e.repeat) audio.toggleMusic();
    // In battle: Space fires whichever broadside bears (held, it fires each one as she comes into its arc),
    // Tab cycles the shot and 1 to 3 pick it; Q and E still fire a side by hand. When it is over, Enter (or
    // Space) carries on. Steering keys go to the battle through bindInput.
    if (fight) {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'tab') e.preventDefault();
      if (fight.battle.result()) {
        // With a prize waiting, the plunder screen takes Enter.
        if ((k === 'enter' || k === ' ') && !e.repeat && !sim.state.prize) endBattle();
      } else if (k === 'enter' && fight.battle.state.wreck && !e.repeat) {
        fight.battle.send({ type: 'LeaveWreck' });
      } else if (k === ' ') {
        fireHeld = true;
        fight.battle.send({ type: 'Fire' });
      } else if (k === 'tab' && !e.repeat) {
        const order: Ammo[] = ['round', 'chain', 'grape'];
        const now = fight.battle.state.ships.player.ammo;
        fight.battle.send({ type: 'SetAmmo', ammo: order[(order.indexOf(now) + 1) % order.length]! });
      } else if (k === 'q' || k === 'e') fight.battle.send({ type: 'Fire', side: k === 'q' ? 'port' : 'starboard' });
      else if (['1', '2', '3'].includes(k)) fight.battle.send({ type: 'SetAmmo', ammo: (['round', 'chain', 'grape'] as Ammo[])[Number(k) - 1]! });
      else if (k === 'g' && !e.repeat) fight.battle.send({ type: 'Board' });
      // R: repel boarders, as the grapple bar reaches the gold (one try a grapple).
      else if (k === 'r' && !e.repeat) fight.battle.send({ type: 'Repel' });
      // Y: strike your colours, when a famous pirate calls on you to.
      else if (k === 'y' && !e.repeat && fight.battle.demands()) fight.battle.send({ type: 'Strike' });
      else if (k === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey) sea3d.toggleChase();
      if (k === 's' && (e.ctrlKey || e.metaKey)) e.preventDefault();
      // F1: every key, over the battle too.
      if (e.key === 'F1' && !e.repeat) {
        e.preventDefault();
        helpOpen = !helpOpen;
      }
      return;
    }
    // C: the 3D camera overhead or from astern.
    if (e.key.toLowerCase() === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey) sea3d.toggleChase();
    // E: enter the port in reach, or set sail again.
    if (e.key.toLowerCase() === 'e' && !e.repeat) {
      const ship = player();
      if (ship.docked) sim.send({ type: 'Undock', shipId: ship.id });
      else {
        const port = portInReach();
        if (port) sim.send({ type: 'Dock', shipId: ship.id, settlementId: port.id });
      }
    }
    // Space: the one thing to do now, as the prompt line says (at sea only: in port Space is the buttons').
    if (e.key === ' ' && !player().docked) {
      e.preventDefault();
      if (!e.repeat && !logOpen && !chartWasOpen) seaAction()?.run();
    }
    // Tab: pick the next ship in sight, nearest first.
    if (e.key === 'Tab' && !player().docked && !hailing && !logOpen) {
      e.preventDefault();
      const ships = shipsInSight();
      const at = ships.findIndex((s) => s.id === targeted()?.id);
      pick(ships[(at + 1) % Math.max(1, ships.length)]?.id);
    }
    // F, in a hail: open fire on her.
    if (e.key.toLowerCase() === 'f' && !e.repeat && !e.ctrlKey && !e.metaKey && hailing) attackSpoken();
    // Escape: part ways in a hail; else let the ship picked go.
    if (e.key === 'Escape') {
      if (hailing) partWays();
      else if (!logOpen && !chartWasOpen) {
        stopChasing(target);
        pick(undefined);
      }
    }
    // K: careen her on a nearby beach when her bottom is foul: free, but days of her time.
    if (e.key.toLowerCase() === 'k' && !e.repeat && !e.ctrlKey && !e.metaKey && !fight && !logOpen && !hailing && !player().docked) {
      const before = sim.events().length;
      const me = player();
      sim.send({ type: 'Careen', shipId: me.id, beach: true });
      sim.applyCommands();
      const ev = sim.events().slice(before).find((x) => x.type === 'Careened' || x.type === 'TradeRefused');
      if (ev?.type === 'Careened') {
        // Furled for the days hove down, only once there is a beach: refused, she keeps her sails and her way.
        sim.send({ type: 'SetSails', shipId: me.id, sails: 'furled' });
        sim.applyCommands();
        sim.step(Math.round(content.calendar.ticksPerDay * content.economy.fouling.beachDays));
        digNote = { text: `Hove down on the beach for ${content.economy.fouling.beachDays} days: her bottom is clean, and she sails at her best again`, kind: 'Careened on a beach', icon: 'ui.icon.hull', until: performance.now() + 7000 };
      } else digNote = { text: 'No beach within reach to heave her down on: close the shore first', kind: 'No beach', icon: 'ui.icon.anchor', until: performance.now() + 4000 };
    }
    // L: the captain's log, at sea or in port; Escape closes it too.
    if (e.key.toLowerCase() === 'l' && !e.repeat && !e.ctrlKey && !e.metaKey && !fight) logOpen = !logOpen;
    // F1: every key, grouped (the HUD shows only the one that applies now).
    if (e.key === 'F1' && !e.repeat) {
      e.preventDefault();
      helpOpen = !helpOpen;
    }
    if (e.key === 'Escape') logOpen = false;
    // Ctrl+S (Cmd+S on a Mac) saves the career instead of the browser's "save page".
    if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!e.repeat) save();
    }
    // Cruise speed in open water: = faster, - slower (1x to 4x).
    // (With the chart open they zoom it instead.)
    if ((e.key === '=' || e.key === '+') && !chartWasOpen) wantedSpeed = Math.min(4, wantedSpeed * 2);
    if (e.key === '-' && !chartWasOpen) wantedSpeed = Math.max(1, wantedSpeed / 2);
  });

  // Mouse: left-click to move, right-click to act (PRD controls). At sea a left-click sets a course (to a
  // ship: intercept; to a port: sail in and dock; to the sea: sail there, by the lanes round any land) and
  // holding it re-aims; a right-click hails the ship or enters the port under it, or else drops the course.
  // In battle a left-click (or hold) steers to the point and the right button fires.
  let courseNote: (Toast & { until: number }) | undefined;
  /** F1's key help is open. */
  let helpOpen = false;
  /** The HUD's strip fades while nothing on it changes: what it last showed, and when that changed. */
  let stripSeen = '';
  /** The purse as last seen, to tell gold paid in (undefined until the first frame). */
  let lastPurse: number | undefined;
  let stripChanged = 0;
  // Said on the port screen when men desert as she makes port; cleared when she sails.
  let portNotice: PortNotice | undefined;
  // The fleet as she last sailed: a ship not in it on making port is a prize brought in, and the harbour says where
  // she is dealt with.
  let fleetSailed = new Set(fleetOf(sim.state).map((f) => f.id));
  /** What a refused order in port means, in words (the rest say so on their own button). */
  const REFUSED: Record<string, string> = {
    'not-enough-gold': 'Not enough gold for that.',
    'shares-full': 'No more men sign on for shares: half her berths are manned. The rest want a bounty.',
    'not-sold-here': 'Not to be had in this port.',
    'map-whole': 'You already hold the whole of that map.',
    'no-offer': 'The stranger has gone.',
    standing: 'The yard builds her only for a captain in better standing here.',
    rank: 'The yard builds her only for a captain of higher rank here.',
  };
  let lastReplanTick = -Infinity;
  const setCourse = (x: number, y: number, held: boolean) => {
    const me = player();
    const port = held ? undefined : portAt(x, y);
    // To a port: by the lanes to its berth, then in to the town until she's in docking range.
    const to = port ? lanes.berth(port.id) : ([x, y] as [number, number]);
    if (!to) return;
    const route = lanes.path([me.x, me.y], to);
    if (!route) {
      if (!held) courseNote = { text: 'No way there by sea', kind: 'Course', icon: 'ui.icon.course', tone: 'warn', until: performance.now() + 2500 };
      return;
    }
    const [ex, ey] = port ? [port.x, port.y] : to;
    sim.send({ type: 'SetAssist', shipId: me.id, assist: 'course', x: ex, y: ey, portId: port?.id, route: port ? route.slice(1) : route.slice(1, -1) });
  };
  if (MOUSE_CONTROLS) bindMouse(sea3d.canvas, {
    // The sea under the pointer, at sea and in battle alike (both are drawn in world tiles).
    toTile: (px, py) => sea3d.pick(px, py),
    left(tile, held) {
      if (fight) {
        if (!fight.battle.result()) fight.battle.send({ type: 'SetAssist', shipId: 'player', assist: 'course', x: tile.x, y: tile.y });
        return;
      }
      if (player().docked || hailing) return;
      const ship = held ? undefined : shipAt(tile.x, tile.y);
      if (ship) sim.send({ type: 'SetAssist', shipId: player().id, assist: 'intercept', targetId: ship.id });
      else setCourse(tile.x, tile.y, held);
    },
    right(tile) {
      if (fight) {
        if (fight.battle.result()) return;
        fireHeld = true;
        fight.battle.send({ type: 'Fire' });
        return;
      }
      if (player().docked) return;
      const ship = shipAt(tile.x, tile.y);
      const inHail = shipInHail();
      const port = portInReach();
      if (ship && inHail?.id === ship.id) hail(ship);
      else if (port && (!ship || portAt(tile.x, tile.y)?.id === port.id)) sim.send({ type: 'Dock', shipId: player().id, settlementId: port.id });
      else if (player().assist) sim.send({ type: 'SetAssist', shipId: player().id, assist: 'off' });
    },
    rightUp() {
      fireHeld = false;
    },
    hover(tile, client) {
      const ship = tile && !fight && !player().docked ? shipAt(tile.x, tile.y) : undefined;
      hoverCard.hidden = !ship?.ai;
      if (ship?.ai) {
        hoverCard.textContent = `${ship.ai.name} · ${shipTitle(ship)} · ${ship.ai.role}`;
        const r = stage.getBoundingClientRect();
        hoverCard.style.transform = `translate(${client.x - r.left + 14}px, ${client.y - r.top + 14}px)`;
      }
    },
  });
  const hoverCard = stage.appendChild(document.createElement('div'));
  hoverCard.className = 'ship-hover';
  hoverCard.hidden = true;

  // Thunder follows the lightning, later the further off it struck.
  sea3d.onLightning((delayS) => audio.thunder(delayS));
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
    audio: { levels: () => audio.levels(), battle: audio.battle },
    wildlife: sea3d.wildlife,
    ports: () => settlements.map(({ id, name, x, y }) => ({ id, name, x, y })),
    land: (x, y) => isLand(tileAt(map, x, y)),
    snapshot: { save: () => toSave(sim.state, seed, fingerprint, Date.now()) },
    view: () => (fight ? 'battle' : renderer.harbour.visible ? 'harbour' : 'sea'),
    battle: {
      active: () => Boolean(fight),
      state: () => (fight ? structuredClone(fight.battle.state) : undefined),
      /** Step the battle (it also runs in real time); `autopilot` lets the player's side fight itself. */
      step: (ticks = 1, autopilot?: 'runner' | 'cautious' | 'aggressive') => fight?.battle.step(ticks, autopilot),
      result: () => fight?.battle.result(),
      shaking: () => sea3d.shaking,
    },
  };
  const player = () => sim.state.ships[def.start.shipId]!;
  /** How far she can make out a ship now (the haze on the horizon), by the weather and the hour where she is. */
  const view = () => viewTiles(content, sim.state.tick, windAt(sim.state, player().x, player().y), player(), sim.state.weather?.storms);
  // The keys steer the battle while one is on, the world otherwise; the debug wind keys only at sea.
  bindInput(
    () => {
      const b = fight && !fight.battle.result() ? fight.battle : undefined;
      // The battle takes steering and sails; wind is fixed for the fight.
      return b ? { state: b.state, send: (c) => c.type !== 'SetWind' && b.send(c) } : sim;
    },
    def.start.shipId,
    () => windAt(sim.state, player().x, player().y),
    () => DEBUG_KEYS && !fight,
  );

  /** The nearest AI ship close enough to hail: in sight, at sea and within hailing range. */
  const shipInHail = () => {
    const me = player();
    if (me.docked) return undefined;
    let best: { s: (typeof sim.state.ships)[string]; d: number } | undefined;
    for (const s of Object.values(sim.state.ships)) {
      // Not one lying in port (no route), and not a hunter closing in: she isn't stopping to talk.
      if (!s.ai || s.ai.chasing || inPort(s)) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d <= content.traffic.hailTiles && (!best || d < best.d)) best = { s, d };
    }
    return best?.s;
  };

  /** Speak a ship within hailing range: her reply opens the hail panel. */
  const hail = (other: Ship | undefined) => {
    if (!other) return;
    const since = sim.events().length;
    sim.send({ type: 'Hail', shipId: player().id, targetId: other.id });
    sim.applyCommands();
    const reply = sim.events().slice(since).find((ev) => ev.type === 'Hailed');
    if (reply) hailing = { targetId: other.id, news: (reply.payload.news as string[]) ?? [] };
  };
  /** An AI ship at sea under a tile (within a tile and a half) and in her view (the view draws no other), nearest first. */
  const shipAt = (x: number, y: number) =>
    Object.values(sim.state.ships)
      .filter((s) => s.ai && !inPort(s) && Math.hypot(s.x - x, s.y - y) <= 1.5 && Math.hypot(s.x - player().x, s.y - player().y) <= view())
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  /** A port under a tile (its town within two and a half tiles). */
  const portAt = (x: number, y: number) => settlements.find((s) => Math.hypot(s.x - x, s.y - y) <= 3.75);

  /** The nearest port close enough to dock at, if any. */
  /**
   * Where the men could go ashore and dig: close to a beach (treasure.json dig reach) inside the search ring of a map
   * she holds a piece of and hasn't dug up. The map's pirate, or undefined.
   */
  const digHere = (): string | undefined => {
    const me = player();
    if (me.docked) return undefined;
    const d = content.treasure.dig;
    const r = Math.ceil(d.reachTiles);
    let shore = false;
    for (let dy = -r; dy <= r && !shore; dy++)
      for (let dx = -r; dx <= r && !shore; dx++) {
        const tx = Math.floor(me.x) + dx;
        const ty = Math.floor(me.y) + dy;
        shore = isLand(tileAt(map, tx, ty)) && Math.hypot(tx + 0.5 - me.x, ty + 0.5 - me.y) <= d.reachTiles;
      }
    if (!shore) return undefined;
    return content.pirates.captains.find((c) => {
      const hoard = sim.state.famous?.[c.id]?.hoard;
      const held = sim.state.captain?.mapPieces?.[c.id] ?? 0;
      if (!hoard || !held || hoard.found) return false;
      const ring = hoardRing(content, hoard, held);
      return Math.hypot(ring.x - me.x, ring.y - me.y) <= ring.r + d.reachTiles;
    })?.name;
  };
  // What the last dig turned up, said a while.
  let digNote: (Toast & { until: number }) | undefined;
  /**
   * G: heave to, put the men ashore on the nearest beach and dig. Half a day passes (treasure.json dig hours) while
   * they do; then what they found, or which way the landmark lies.
   */
  const dig = () => {
    const me = player();
    const before = sim.events().length;
    sim.send({ type: 'SetSails', shipId: me.id, sails: 'furled' });
    sim.send({ type: 'Dig', shipId: me.id });
    sim.applyCommands();
    const ev = sim.events().slice(before).find((e) => e.type === 'HoardFound' || e.type === 'DigMissed' || e.type === 'DigRefused');
    const now = performance.now();
    if (!ev || ev.type === 'DigRefused') {
      digNote = { text: 'No beach within reach to put the men ashore: close the shore first', kind: 'No beach', icon: 'ui.icon.anchor', until: now + 4000 };
      return;
    }
    sim.step(Math.round((content.calendar.ticksPerDay * content.treasure.dig.hours) / 24));
    if (ev.type === 'HoardFound') {
      const p = ev.payload as { name: string; gold: number; fame: number; revenge: boolean };
      moments.push({ kind: 'hoard', ...p });
      return;
    }
    const hint = ev.payload.hint as { landmark: string; bearingDeg: number; tiles: number } | null;
    const way = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round((hint?.bearingDeg ?? 0) / 45) % 8];
    digNote = {
      text: hint
        ? `Half a day's digging, and only sand. From the beach the men see ${hint.landmark} to the ${way}, about ${Math.max(1, Math.round(hint.tiles * kmPerTile))} km off`
        : "Half a day's digging, and only sand. Nothing on this coast matches your maps",
      kind: 'Dig result',
      icon: 'ui.icon.chest',
      until: now + 9000,
    };
  };
  /**
   * The nearest port in docking reach; or `bound`, the port her course is for, when it is in reach too: two towns
   * across a narrow channel (Tortuga and Port-de-Paix) are both in reach of one berth.
   */
  const portInReach = (bound?: string) => {
    const ship = player();
    const mine = settlements.find((s) => s.id === bound);
    if (mine && Math.hypot(mine.x - ship.x, mine.y - ship.y) <= DOCK_RANGE) return mine;
    let best: { s: PlacedSettlement; d: number } | undefined;
    for (const s of settlements) {
      const d = Math.hypot(s.x - ship.x, s.y - ship.y);
      if (d <= DOCK_RANGE && (!best || d < best.d)) best = { s, d };
    }
    return best?.s;
  };

  // One key does the one thing to do now (Space; A on a pad): enter the port in reach, hail the ship alongside,
  // chase the ship picked, dig, or follow the course. The prompt line says which, with the key.
  /** The ship picked, while she is at sea and in sight. */
  const targeted = () => {
    const me = player();
    const s = target ? sim.state.ships[target] : undefined;
    return s?.ai && !inPort(s) && Math.hypot(s.x - me.x, s.y - me.y) <= view() ? s : undefined;
  };
  /** Ships in sight at sea, nearest first: Tab steps through them. */
  const shipsInSight = () => {
    const me = player();
    return Object.values(sim.state.ships)
      .filter((s) => s.ai && !inPort(s) && Math.hypot(s.x - me.x, s.y - me.y) <= view())
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  };
  type SeaAction = { text: string; run: () => void };
  /** What Space does about a ship: hail her alongside (a hunter closing won't stop to talk), else chase her, or stop. */
  const shipAction = (her: Ship): SeaAction | undefined => {
    const me = player();
    if (her.ai?.chasing) return undefined;
    // The First Voyage's pirate: alongside, straight into the fight (no hail to learn first).
    if (her.ai?.voyage?.meek && Math.hypot(her.x - me.x, her.y - me.y) <= content.traffic.hailTiles)
      return { text: `Attack the pirate ${her.ai.name}`, run: () => sim.send({ type: 'Attack', shipId: me.id, targetId: her.id }) };
    if (Math.hypot(her.x - me.x, her.y - me.y) <= content.traffic.hailTiles) return { text: `Hail the ${shipTitle(her)} ${her.ai!.name}`, run: () => hail(her) };
    if (me.assist?.mode === 'intercept' && me.assist.targetId === her.id) return { text: `Stop chasing the ${her.ai!.name}`, run: () => sim.send({ type: 'SetAssist', shipId: me.id, assist: 'off' }) };
    return { text: `Chase the ${shipTitle(her)} ${her.ai!.name}`, run: () => sim.send({ type: 'SetAssist', shipId: me.id, assist: 'intercept', targetId: her.id }) };
  };
  /** Follow the route plotted to the destination: the autopilot sails it and docks her on arrival. */
  const follow = (to: PlacedSettlement) => {
    const me = player();
    const berth = lanes.berth(to.id);
    const route = berth ? lanes.path([me.x, me.y], berth) : undefined;
    if (route) sim.send({ type: 'SetAssist', shipId: me.id, assist: 'course', x: to.x, y: to.y, portId: to.id, route: route.slice(1) });
  };
  /** The one thing Space does now, if anything (nothing in port, in a hail, or with a hunter closing). */
  const seaAction = (): SeaAction | undefined => {
    const me = player();
    if (me.docked || hailing || fight) return undefined;
    // Into port, even with a hunter closing: under its guns she is safe.
    const port = portInReach();
    if (port) return { text: `Enter ${port.name}`, run: () => sim.send({ type: 'Dock', shipId: me.id, settlementId: port.id }) };
    if (Object.values(sim.state.ships).some((s) => s.ai?.chasing)) return undefined;
    // The First Voyage's wreck, alongside: heave to and take off what the storm left.
    const v = sim.state.captain?.voyage;
    if (v?.step === 'salvage' && Math.hypot(me.x - v.cay.x, me.y - v.cay.y) <= content.voyage.arriveTiles + 1)
      return {
        text: 'Salvage the wreck',
        run: () => {
          sim.send({ type: 'SetSails', shipId: me.id, sails: 'furled' });
          sim.send({ type: 'Salvage', shipId: me.id });
        },
      };
    // A course she has set herself on the chart comes before the voyage's own suggestions.
    const chosenCourse = destination && me.assist?.mode !== 'course' ? destination : undefined;
    if (v && v.step !== 'done' && chosenCourse) return { text: `Follow the course to ${chosenCourse.name}`, run: () => follow(chosenCourse) };
    // Her first prize: Space goes after the pirate wherever she is.
    const quarry = v?.step === 'prize' && v.pirateId ? sim.state.ships[v.pirateId] : undefined;
    if (quarry) {
      const act = shipAction(quarry);
      // Hove to at the wreck, she makes sail to go after her.
      return act && me.sails === 'furled' && act.text.startsWith('Chase') ? { ...act, run: () => (sim.send({ type: 'SetSails', shipId: me.id, sails: 'full' }), act.run()) } : act;
    }
    // Home with her prize: Space sails her there.
    const homeport = v?.step === 'home' ? settlements.find((s) => s.id === v.home) : undefined;
    if (homeport && me.assist?.mode !== 'course') return { text: `Sail home to ${homeport.name}`, run: () => follow(homeport) };
    // The ship picked, alongside or not; else any ship alongside (the chance to speak her is brief).
    const her = targeted();
    const alongside = shipInHail();
    const near = her && Math.hypot(her.x - me.x, her.y - me.y) <= content.traffic.hailTiles ? her : (alongside ?? her);
    // A ship only called out (not picked, not alongside) waits behind a dig or a course plotted and not yet followed.
    const pirate = digHere();
    const pending = destination && me.assist?.mode !== 'course' ? destination : undefined;
    const act = near ? shipAction(near) : undefined;
    if (act && !(near === her && !chosen && !alongside && (pirate || pending))) return act;
    if (pirate) return { text: `${pirate}'s hoard could lie on this coast: go ashore and dig`, run: dig };
    if (pending) return { text: `Follow the course to ${pending.name}`, run: () => follow(pending) };
    return undefined;
  };
  /** The chase on the ship picked ends: she sails on as the captain steers. */
  const stopChasing = (id?: string) => {
    const me = player();
    if (me.assist?.mode === 'intercept' && (id === undefined || me.assist.targetId === id)) sim.send({ type: 'SetAssist', shipId: me.id, assist: 'off' });
  };
  /** Part ways after a hail (Esc, or Sail on): a chase that brought her alongside ends, or it would shadow her. */
  const partWays = () => {
    if (hailing) stopChasing(hailing.targetId);
    hailing = undefined;
  };
  /** In a hail: open fire on her (F, or the Attack button). */
  const attackSpoken = () => {
    if (!hailing) return;
    sim.send({ type: 'Attack', shipId: player().id, targetId: hailing.targetId });
    sim.applyCommands();
    hailing = undefined;
  };
  // A click on a ship at sea picks her: on her hull, her sails or the name over her, at any distance (measured on the
  // screen, where she is drawn). A click on a port or its name plots a course there, as the chart does (Space then
  // follows it). A click on open water lets the ship picked go. The 3D canvas takes no pointer events (the harbour
  // canvas lies over it), so the click is heard on the viewport they share.
  viewport.addEventListener('click', (e) => {
    // Only a click on the sea itself: a label or a button heard on its way up has done its own work.
    if (!(e.target instanceof HTMLCanvasElement) || fight || player().docked || hailing) return;
    const r = sea3d.canvas.getBoundingClientRect();
    const [cx, cy] = [e.clientX - r.left, e.clientY - r.top];
    let best: { id: string; d: number } | undefined;
    for (const s of shipsInSight()) {
      const at = sea3d.project(s.x, s.y);
      if (!at) continue;
      // From her waterline up through her rig to the name banner above her mast.
      const dx = Math.abs(cx - at.px);
      const dy = cy - at.py;
      if (dx > PICK_PX || dy > PICK_PX || dy < -PICK_ABOVE_PX) continue;
      const d = dx + Math.max(0, dy) + Math.max(0, -dy - PICK_PX) / 3;
      if (!best || d < best.d) best = { id: s.id, d };
    }
    // A ship is the smaller mark: she wins over a port when the click is on both.
    const port = best
      ? undefined
      : settlements
          .filter((s) => havenKnown(content, sim.state, s) && Math.hypot(s.x - player().x, s.y - player().y) <= view() * 2)
          .flatMap((s) => {
            const at = sea3d.project(s.x, s.y);
            if (!at) return [];
            const [dx, dy] = [Math.abs(cx - at.px), cy - at.py];
            return dx <= PORT_PICK_PX && dy <= PICK_PX && dy >= -PORT_PICK_ABOVE_PX ? [{ s, d: dx + Math.abs(dy) / 2 }] : [];
          })
          .sort((a, b) => a.d - b.d)[0]?.s;
    if (port) {
      // Her course is the port's now: a ship picked would come before it, so she is let go.
      pick(undefined);
      charts.choose(port.id);
      return;
    }
    pick(best?.id);
  });
  // One scene object per port, so the renderer sees the same one each frame and loads it once.
  const harbourScenes = new Map<string, ReturnType<typeof harbourFor>>();
  const interiors = new Map<string, HarbourScene | undefined>();
  const interior = (s: PlacedSettlement, service: Service) => {
    const key = `${s.id}:${service}`;
    if (!interiors.has(key)) interiors.set(key, interiorFor(s, service));
    return interiors.get(key);
  };
  // The service the port screen has open; its interior stands behind the panel instead of the harbour.
  let service: Service | undefined;
  const harbourScene = (s: PlacedSettlement) => {
    if (!harbourScenes.has(s.id)) harbourScenes.set(s.id, harbourFor(s));
    return harbourScenes.get(s.id);
  };
  /** Scene-pixel hotspot rectangles to CSS pixels within the stage, for the clickable buildings. */
  const hotspotsOnScreen = (spots: Partial<Record<Service | 'docks', [number, number, number, number]>>) => {
    const t = renderer.harbour.transform();
    const canvas = renderer.canvas.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    const px = scale * t.scale;
    const out: Partial<Record<Service | 'docks', { left: number; top: number; width: number; height: number }>> = {};
    for (const [id, [x, y, w, h]] of Object.entries(spots) as [Service | 'docks', number[]][]) {
      out[id] = { left: canvas.left - box.left + (t.x * scale) + x! * px, top: canvas.top - box.top + t.y * scale + y! * px, width: w! * px, height: h! * px };
    }
    return out;
  };

  // Cruising: on empty sea time runs at the cruise speed (2x unless the player changes it with = and -),
  // and drops to 1x whenever something needs attention: land, a storm, port, or a sail in sight. Encounters
  // play out at 1x, where a passing ship stays on screen long enough to deal with.
  let wantedSpeed = 2;
  // The gentle wind (navigation.json gentleWind): the player's own setting, kept in this browser across careers and
  // put on her ship (whichever she sails) whenever it differs. Storage can be missing (a private window): then it
  // lasts the session.
  const GENTLE_KEY = 'corsair.gentleWind';
  let gentleWind = (() => {
    try {
      return localStorage.getItem(GENTLE_KEY) === 'on';
    } catch {
      return false;
    }
  })();
  const setGentleWind = (on: boolean) => {
    gentleWind = on;
    try {
      localStorage.setItem(GENTLE_KEY, on ? 'on' : 'off');
    } catch {
      // Not kept: it lasts the session.
    }
  };
  // The battle camera's shake (render3d shake.ts), on unless the player turns it off: kept in this browser like the
  // gentle wind.
  // For tuning a pirate's mind (?mind=1): her wants shown over the battle.
  const showMind = new URLSearchParams(location.search).get('mind') === '1';
  // F2: the frame rate (frames a second, the average and slowest frame of the last half second, and the resolution
  // the 3D view is drawn at), for a player who finds it slow and for us to read in their report. Remembered;
  // ?fps=1 shows it from the start.
  const FPS_KEY = 'corsair.fps';
  const fpsBox = stage.appendChild(document.createElement('div'));
  fpsBox.className = 'fps';
  fpsBox.hidden = !(
    new URLSearchParams(location.search).get('fps') === '1' ||
    (() => {
      try {
        return localStorage.getItem(FPS_KEY) === 'on';
      } catch {
        return false;
      }
    })()
  );
  const fpsSeen = { since: 0, frames: 0, slowest: 0 };
  const countFrame = (now: number, ms: number) => {
    if (fpsBox.hidden) return;
    fpsSeen.frames++;
    fpsSeen.slowest = Math.max(fpsSeen.slowest, ms);
    const span = now - fpsSeen.since;
    if (span < FPS_EVERY_MS) return;
    if (fpsSeen.since) {
      const fps = (fpsSeen.frames * 1000) / span;
      fpsBox.textContent = `${Math.round(fps)} fps · ${(span / fpsSeen.frames).toFixed(1)} ms (slowest ${Math.round(fpsSeen.slowest)}) · view ${sea3d.renderScale()}×`;
    }
    fpsSeen.since = now;
    fpsSeen.frames = 0;
    fpsSeen.slowest = 0;
  };
  const toggleFps = () => {
    fpsBox.hidden = !fpsBox.hidden;
    fpsSeen.since = 0;
    fpsBox.textContent = '… fps';
    try {
      localStorage.setItem(FPS_KEY, fpsBox.hidden ? 'off' : 'on');
    } catch {
      // Not remembered across reloads, but the toggle still works.
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2' && !e.repeat) {
      e.preventDefault();
      toggleFps();
    }
  });
  const SHAKE_KEY = 'corsair.shake';
  let shakeOn = (() => {
    try {
      return localStorage.getItem(SHAKE_KEY) !== 'off';
    } catch {
      return true;
    }
  })();
  sea3d.setShake(shakeOn ? 1 : 0);
  const setShake = (on: boolean) => {
    shakeOn = on;
    sea3d.setShake(on ? 1 : 0);
    try {
      localStorage.setItem(SHAKE_KEY, on ? 'on' : 'off');
    } catch {
      // Not kept: it lasts the session.
    }
  };
  const sailInSight = () => {
    const me = player();
    let best: { s: (typeof sim.state.ships)[string]; d: number } | undefined;
    for (const s of Object.values(sim.state.ships)) {
      if (!s.ai || inPort(s)) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d <= SAIL_HO_TILES && (!best || d < best.d)) best = { s, d };
    }
    return best?.s;
  };
  // Whether cruising holds at 1x near land, a port, a sail or a storm: the player's setting, off unless chosen (being
  // tried without, 2026-10-21), and kept in this browser like the gentle wind.
  const HOLDS_KEY = 'corsair.cruiseHolds';
  let cruiseHolds = (() => {
    try {
      return localStorage.getItem(HOLDS_KEY) === 'on';
    } catch {
      return false;
    }
  })();
  const setCruiseHolds = (on: boolean) => {
    cruiseHolds = on;
    try {
      localStorage.setItem(HOLDS_KEY, on ? 'on' : 'off');
    } catch {
      // Not kept: it lasts the session.
    }
  };
  const timeScale = (inStorm: boolean): { scale: number; held?: string } => {
    const ship = player();
    // Only close in: cruising carries on along a coast, and holds for the last few tiles before land or a port.
    const nearLand =
      breezes.coastTiles(ship.x, ship.y) <= HOLD_COAST_TILES || settlements.some((s) => Math.hypot(s.x - ship.x, s.y - ship.y) <= HOLD_PORT_TILES);
    if (ship.docked || wantedSpeed <= 1) return { scale: 1 };
    if (!cruiseHolds) return { scale: wantedSpeed };
    if (inStorm) return { scale: 1, held: 'storm' };
    if (nearLand) return { scale: 1, held: 'near land' };
    if (sailInSight()) return { scale: 1, held: 'sail in sight' };
    return { scale: wantedSpeed };
  };
  // Sail ho! A ship coming within SAIL_HO_TILES is called out once, for a few seconds.
  const inSight = new Set<string>();
  let sailHo: { id: string; until: number } | undefined;
  // A song's name shows for a few seconds as it starts, then gives the sea back.
  let songHeard: string | undefined;
  let songShownUntil = 0;

  // Fixed 30 Hz sim under a variable frame rate; the cap stops a background tab from fast-forwarding.
  const dt = 1 / TICKS_PER_SECOND;
  let acc = 0;
  let last = performance.now();
  let speedNow = 1;
  let wasDocked = Boolean(player().docked);
  // A controller plays as the keyboard does (gamepad.ts).
  const pad = createGamepad(() => audio.unlock());
  const frame = (now: number) => {
    pad.poll(fight ? 'battle' : player().docked ? 'port' : 'sea');
    const elapsed = (now - last) / 1000;
    countFrame(now, elapsed * 1000);
    acc = loop.paused ? 0 : Math.min(acc + elapsed * speedNow, 0.25 * speedNow);
    last = now;
    if (fight) {
      // The battle runs in real time (no acceleration) while the world waits; it holds while F1's help is read.
      if (!loop.paused && !helpOpen && !fight.battle.result()) {
        // Fire held: each broadside goes off as soon as she bears and it is loaded.
        if (fireHeld) fight.battle.send({ type: 'Fire' });
        fight.acc = Math.min(fight.acc + elapsed, 0.25);
        while (fight.acc >= dt) {
          fight.battle.step();
          fight.acc -= dt;
        }
      }
      if (fight.battle.result()) settleBattle();
      const bs = fight.battle.state;
      // Sound for what just happened: placed left or right of the player's ship, fainter further off.
      try {
        const me = bs.ships.player;
        for (const e of bs.effects) {
          if (e.at <= fight.heardAt) continue;
          const pan = (e.x - me.x) / 12;
          const gain = 1 / (1 + Math.hypot(e.x - me.x, e.y - me.y) / 8);
          if (e.kind === 'smoke') {
            // The ship nearest the smoke fired: her broadside is the guns she worked (half her guns when the smoke doesn't say, as a chaser's).
            const theirs = Math.hypot(e.x - me.x, e.y - me.y) >= Math.hypot(e.x - bs.ships.enemy.x, e.y - bs.ships.enemy.y);
            const shooter = theirs ? bs.ships.enemy : me;
            audio.battle.broadside(e.guns ?? Math.floor(shooter.guns / 2), pan, gain);
            // Hers: her balls go over the player's ship as they arrive, most of the way through their flight.
            if (theirs) audio.battle.whistle((Math.hypot(e.x - me.x, e.y - me.y) / content.combat.guns.shotTilesPerSecond) * 0.8, pan * 0.3, 1);
          } else if (e.kind === 'splash') audio.battle.splash(pan, gain);
          else if (e.kind === 'mast') audio.battle.mast(pan, gain);
          else audio.battle.hit(e.kind === 'sail' ? 'sail' : e.kind === 'grape' ? 'grape' : 'hull', pan, gain);
        }
        fight.heardAt = Math.max(fight.heardAt, ...bs.effects.map((e) => e.at));
        const enemy = bs.ships.enemy;
        const enemyPan = (enemy.x - me.x) / 12;
        // Grappled: the boarders' fight, over and over while the hulls lie together.
        if (bs.grappling > 0 && now >= (fight.meleeAt ?? 0)) {
          audio.battle.boarding(enemyPan, 1);
          fight.meleeAt = now + BOARDING_SOUND_MS;
        } else if (bs.grappling === 0) fight.meleeAt = undefined;
        // Her guns running out (the tell): the rumble of the trucks as they start, before she fires.
        const theirGuns = fight.battle.enemyGuns();
        const runningOut = theirGuns.port === 'running-out' || theirGuns.starboard === 'running-out';
        if (runningOut && !fight.runningOut) audio.battle.runOut(enemyPan, 1 / (1 + Math.hypot(enemy.x - me.x, enemy.y - me.y) / 8));
        fight.runningOut = runningOut;
        // She goes down: once, as the wreck appears.
        if (bs.wreck && !fight.sankHeard) {
          fight.sankHeard = true;
          audio.battle.explosion(enemyPan, 1 / (1 + Math.hypot(enemy.x - me.x, enemy.y - me.y) / 8));
        }
        // The fight won: the crew cheer.
        const outcome = fight.battle.result()?.outcome;
        if (outcome && !fight.endHeard) {
          fight.endHeard = true;
          if (outcome === 'boarded' || outcome === 'struck' || outcome === 'sunk') audio.battle.cheer();
        }
      } catch (err) {
        if (!audioFailed) console.error('battle audio failed', err);
        audioFailed = true;
      }
      const gunnery = fight.battle.gunnery();
      const arcs = bs.result
        ? undefined
        : {
            arcDeg: content.combat.guns.arcDeg,
            rangeTiles: gunnery.rangeTiles,
            port: fight.battle.aim('port'),
            starboard: fight.battle.aim('starboard'),
          };
      const enemyArcs = bs.result || bs.wreck ? undefined : { arcDeg: content.combat.guns.arcDeg, ...fight.battle.enemyGuns() };
      // The fight is drawn on the same sea as the map.
      sea3d.canvas.style.display = '';
      // Her grapples' reach round the player, red while she means to board.
      const grapple = bs.result || bs.wreck ? undefined : { tiles: content.combat.battle.boardTiles, threat: Boolean(bs.enemyBoarding) };
      sea3d.renderBattle({ ...bs, arcs, enemyArcs, grapple }, now, fight.nation, fight.famous);
      const me = player();
      const prize = sim.state.prize;
      render(
        <BattleHud
          state={bs}
          content={content}
          enemyName={fight.name}
          enemyTitle={fight.title}
          enemyNation={fight.nation}
          wavering={fight.battle.wavering()}
          lesson={(() => {
            // The First Voyage's first prize: Ned's word as it begins, then the arc, and round shot only.
            const v = sim.state.captain?.voyage;
            if (v?.step !== 'prize' || fight.targetId !== v.pirateId || bs.result) return undefined;
            const aims = [fight.battle.aim('port'), fight.battle.aim('starboard')];
            const apart = Math.hypot(bs.ships.enemy.x - bs.ships.player.x, bs.ships.enemy.y - bs.ships.player.y);
            // One thing at a time: close with her, put your side to her, fire.
            const prompt = aims.includes('ready')
              ? "She's in your arc: fire! · Space"
              : apart > fight.battle.gunnery().rangeTiles
                ? 'Steer for her: close within reach of your guns'
                : aims.includes('loading')
                  ? 'Reloading: keep your side to her'
                  : 'Put your side to her: fire when the arc turns gold';
            return {
              ...(bs.tick < 8 * TICKS_PER_SECOND ? { ned: `"She's no great guns, Captain. Close with her, put your side to her, and she'll strike in a broadside or two."` } : {}),
              prompt,
              shotsLocked: true,
            };
          })()}
          plunderSay={(() => {
            const v = sim.state.captain?.voyage;
            if (!v || fight.targetId !== v.pirateId) return undefined;
            const cut = Math.round(content.crew.captainShare * 100);
            return `"Plunder's the crew's till we're ashore, Captain. We share it out in the tavern: ${cut === 20 ? 'a fifth' : `${cut} in a hundred`} to you, the rest keeps them sweet."`;
          })()}
          under={fight.battle.underGuns()}
          shoals={fight.battle.shoals()}
          showMind={showMind}
          demand={
            fight.battle.demands()
              ? (() => {
                  const flag = content.pirates.captains.find((c) => c.id === fight!.famous)?.flag;
                  return { name: fight.name, chest: Math.round(sim.state.captain?.chest ?? 0), ...(flag ? { flag: flagPicture('pirate', flag) } : {}) };
                })()
              : undefined
          }
          onStrike={() => fight?.battle.send({ type: 'Strike' })}
          report={fight.report}
          attacked={fight.attacked}
          offer={
            prize
              ? {
                  theirs: prize.ship.cargo,
                  volunteers: prize.volunteers,
                  mine: me.cargo,
                  capacity: fleetHold(content, sim.state, me),
                  keep: (() => {
                    const fleet = fleetOf(sim.state);
                    const cls = content.ships[prize.ship.classId]!;
                    const men = crewOf(content, me) + prize.volunteers;
                    const needs = fleetMinCrew(content, [...fleet, prize.ship], me);
                    const whyNot = prize.ship.ai?.voyage
                      ? `"A periagua'd only slow us, Captain. Let her go or sink her."`
                      : fleet.length + 2 > content.combat.fleet.maxShips
                        ? `Your fleet is full (${content.combat.fleet.maxShips} ships): sell one at a shipwright first.`
                        : men < needs
                          ? `Too few men to sail her too: the fleet would need ${needs}, you have ${men}${prize.volunteers ? ' with her volunteers' : ''}.`
                          : undefined;
                    // Her papers decide what a shipwright pays: full at the ports of the letter she was taken under.
                    const papers = prizePapers(content, sim.state, prize.ship.ai?.nation ?? 'pirate');
                    const value = shipValue(content, { ...prize.ship, hull: prize.ship.hull ?? cls.hull, sailCondition: prize.ship.sailCondition ?? 100, prize: papers });
                    const where = papers.lawful
                      ? `at ${{ spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch' }[papers.lawful as string] ?? papers.lawful} ports (your letter)`
                      : 'at a pirate haven: no papers';
                    return { hold: cls.cargo, minCrew: cls.minCrew, speed: fleetShipPace(content, prize.ship), fullSpeed: cls.speed, value, where, whyNot };
                  })(),
                  role: prize.ship.ai?.role ?? 'merchant',
                  nation: prize.ship.ai?.nation ?? 'pirate',
                  foodNow: foodDays(content, me),
                  foodWith: foodDays(content, { ...me, crew: crewOf(content, me) + prize.volunteers }),
                  ...(prize.captive
                    ? {
                        captive: {
                          name: content.pirates.captains.find((c) => c.id === prize.captive)?.name ?? prize.captive,
                          held: sim.state.captain?.mapPieces?.[prize.captive] ?? 0,
                          pieces: content.pirates.rules.mapPieces,
                          bounty: content.pirates.rules.bounty,
                          standing: content.pirates.rules.bountyStanding,
                          morale: content.pirates.rules.mercyMorale,
                        },
                      }
                    : {}),
                }
              : undefined
          }
          advice={fight.report ? repairAdvice() : undefined}
          compass={{
            ...compassProps(
              content,
              bs.ships.player,
              bs.wind,
              // The battle's speeds run on their own scale: as speed points, then as the sea map's tiles a second.
              (bs.ships.player.speed / content.combat.battle.tilesPerSecondPerSpeedPoint) * content.navigation.tilesPerSecondPerSpeedPoint * knotsPerTilePerSecond,
            ),
            viewDeg: sea3d.viewDeg(),
          }}
          board={{ odds: fight.battle.boardingOdds(), active: Boolean(bs.boarding), repel: fight.battle.repelWindow() }}
          onPlunder={takePlunder}
          reloadSeconds={gunnery.reloadSeconds}
          aim={{ port: fight.battle.aim('port'), starboard: fight.battle.aim('starboard') }}
          you={{
            name: me.name ?? 'Your ship',
            what: [`${shipKind(me.classId)} · ${bs.ships.player.guns} guns`, ...(me.upgrades ?? []).map((u) => content.upgrades[u]?.name.toLowerCase() ?? u)].join(' · '),
            sails: bs.ships.player.sails,
            setSails: (sails) => fight?.battle.send({ type: 'SetSails', shipId: 'player', sails }),
            shot: bs.ships.player.ammo,
            chooseShot: (ammo) => fight?.battle.send({ type: 'SetAmmo', ammo }),
          }}
          onContinue={endBattle}
          shake={{ on: shakeOn, toggle: () => setShake(!shakeOn) }}
          help={{ open: helpOpen, close: () => (helpOpen = false) }}
        />,
        battleRoot,
      );
      stage.classList.add('in-battle');
      // The battle HUD has its own ship panel: the sea one goes.
      render(null, panelRoot);
      requestAnimationFrame(frame);
      return;
    }
    stage.classList.remove('in-battle');
    render(null, battleRoot);
    // The HUD's strip (at sea) and the harbour's (in port) replace the old ship card; the battle HUD has its own.
    render(null, panelRoot);
    if (player().docked || hailing || charts.open || logOpen || moments.length || helpOpen) {
      // World time stops in port (PRD section 2), while hailing, while the chart, the log or F1's help is open;
      // commands still apply at once.
      sim.applyCommands();
      acc = 0;
    }
    while (acc >= dt) {
      sim.step();
      acc -= dt;
      if (player().docked) break;
    }
    // Gold paid in (a sale, a reward, rent, a share): it rises off the purse wherever the purse is shown, and the
    // coins ring, more of them for more gold.
    const purse = sim.state.captain?.gold ?? 0;
    if (lastPurse !== undefined && purse > lastPurse) {
      purseRise.amount = purse - lastPurse;
      purseRise.at = performance.now();
      try {
        audio.coins(Math.ceil((purse - lastPurse) / COINS_PER_RING));
      } catch {
        // Sound is a nicety: a failure here must never stop the frame.
      }
    }
    lastPurse = purse;
    // The course's look-out: about once a second, if the way to her next waypoint isn't clear water any more
    // (beating has carried her off the line, round the wrong side of a spit), plot a new route from where she is.
    if (sim.state.tick - lastReplanTick >= REPLAN_TICKS) {
      lastReplanTick = sim.state.tick;
      const me = player();
      const plan = me.assist;
      if (!me.docked && plan?.mode === 'course' && plan.x !== undefined && plan.y !== undefined) {
        const end = plan.portId ? lanes.berth(plan.portId) : ([plan.x, plan.y] as [number, number]);
        const next = plan.route?.[0] ?? end;
        if (end && next && !lanes.clear([me.x, me.y], next)) {
          const route = lanes.path([me.x, me.y], end);
          if (route) sim.send({ type: 'SetAssist', shipId: me.id, assist: 'course', x: plan.x, y: plan.y, portId: plan.portId, route: plan.portId ? route.slice(1) : route.slice(1, -1) });
        }
      }
    }
    // A fight joined this frame (the player's Attack, or a hunter closing) starts the battle.
    const evs = sim.events();
    if (evs.length < eventsSeen) eventsSeen = 0;
    for (let i = eventsSeen; i < evs.length; i++) {
      const ev = evs[i]!;
      if (ev.type === 'BattleJoined') startBattle(ev.entityIds[1]!, ev.payload.by === 'player');
      // The chase has come up alongside her: hail her (the world waits on the captain's word).
      if (ev.type === 'InterceptAlongside' && ev.entityIds[0] === player().id && !hailing && !fight) {
        const her = sim.state.ships[ev.entityIds[1]!];
        if (her?.ai && !her.ai.chasing) hail(her);
      }
      if (ev.type === 'Deserted') portNotice = { text: `${ev.payload.count as number} men deserted when you made port: the crew is unhappy. Pay them or divide the plunder.`, icon: 'ui.icon.crew', tone: 'warn' };
      if (ev.type === 'Undocked') {
        portNotice = undefined;
        fleetSailed = new Set(fleetOf(sim.state).map((f) => f.id));
      }
      if (ev.type === 'Docked') {
        const brought = fleetOf(sim.state).filter((f) => !fleetSailed.has(f.id));
        if (brought.length === 1) portNotice = { text: `Your prize, the ${shipKind(brought[0]!.classId)} ${brought[0]!.name}, lies here: mend, fit or sell her at the shipwright.`, icon: 'ui.icon.anchor', tone: 'gold' };
        if (brought.length > 1) portNotice = { text: `Your ${brought.length} prizes lie here: mend, fit or sell them at the shipwright.`, icon: 'ui.icon.anchor', tone: 'gold' };
      }
      // A promotion from the governor, as his commission; a title brings land.
      // The First Voyage's letter of marque, given by the governor: its ceremony, as a promotion to the first rung.
      if (ev.type === 'MarqueBought' && ev.payload.voyage) {
        moments.push({ kind: 'promotion', nation: ev.payload.nation as string, rank: content.politics.ranks.ladder[0]!.name, acres: 0, town: settlements.find((s) => s.id === ev.entityIds[1])?.name ?? '' });
      }
      if (ev.type === 'Promoted') {
        const p = ev.payload as { nation: string; rank: string; acres: number };
        moments.push({ kind: 'promotion', ...p, town: settlements.find((s) => s.id === ev.entityIds[1])?.name ?? '' });
      }
      // A governor's mission done, given up or beaten to: a note at sea says so, and what comes next.
      if (ev.type === 'MissionLapsed' || ev.type === 'MissionLost') {
        const by = settlements.find((s) => s.id === ev.entityIds[1])?.name ?? '';
        const text =
          ev.type === 'MissionLost'
            ? `Another ship has beaten the ${ev.payload.name as string}: ${by}'s hunt is over`
            : ev.payload.kind === 'hunt'
              ? `${by} has given up the hunt for the ${ev.payload.name as string}`
              : `${by}'s letter is no longer wanted`;
        courseNote = { text, kind: 'Mission over', icon: 'ui.icon.course', until: now + 6000 };
      }
      // A famous pirate in sight for the first time.
      if (ev.type === 'FamousSighted') {
        const id = ev.payload.pirateId as string;
        if (sim.state.tick - lastFamousMoment >= FAMOUS_GAP_DAYS * content.calendar.ticksPerDay) {
          moments.push({ kind: 'famous', pirateId: id });
          lastFamousMoment = sim.state.tick;
        } else {
          const name = content.pirates.captains.find((c) => c.id === id)?.name ?? id;
          courseNote = { text: `${name} sighted: the Top Ten in the log (L) says more`, kind: 'Famous pirate', icon: 'ui.icon.cannon_loaded', tone: 'warn', until: now + 5000 };
        }
      }
      // A piece of a treasure map from a beaten pirate's men is on the victory screen's report; one from her in
      // irons was chosen there: a note on the sea says where to see it, not another screen.
      const captive = ev.type === 'PlunderTaken' ? (ev.payload.captive as { id: string; choice: string } | null) : null;
      if (captive?.choice === 'hoard') {
        const name = content.pirates.captains.find((c) => c.id === captive.id)?.name ?? captive.id;
        courseNote = { text: `A piece of ${name}'s map: see it in the log (L)`, kind: 'Map', icon: 'ui.icon.chest', tone: 'gold', until: now + 5000 };
      }
      // News that matters waiting in the port she makes: war and peace, as a letter.
      if (ev.type === 'Docked' && ev.entityIds[0] === player().id) {
        const town = settlements.find((s) => s.id === ev.entityIds[1]);
        const heard = new Set(sim.state.captain?.heard ?? []);
        for (const n of town ? newsAt(content, sim.state, settlements, town.id) : []) {
          if ((n.kind !== 'war' && n.kind !== 'peace') || heard.has(n.id) || lettered.has(n.id)) continue;
          lettered.add(n.id);
          moments.push({
            kind: 'letter',
            newsId: n.id,
            at: town!.name,
            date: formatDate(dateOf(def.startDate, Math.floor(n.tick / content.calendar.ticksPerDay))),
            headline: n.kind === 'war' ? 'War!' : 'Peace',
            text: newsText(content, n, town!.name),
            means: letterMeans(n.kind, n.nation!, n.other!, sim.state.captain?.marques ?? [], sim.state.captain?.nation),
            // A war this port's governor is party to: he grants letters of marque against the other side.
            governor: n.kind === 'war' && hasGovernor(town!) && (town!.nation === n.nation || town!.nation === n.other),
          });
        }
      }
      if (ev.type === 'RentPaid') courseNote = { text: `Rent from your land: +${(ev.payload.gold as number).toLocaleString()} gold`, kind: 'Rent', icon: 'ui.icon.gold', until: now + 4000 };
      // Retired: the career is over; keep it, so the start screen shows how it ended.
      if (ev.type === 'Retired') void save();
      // Plague breaks out in the port she lies in: no other ship will come in until it passes.
      if (ev.type === 'Plague' && ev.entityIds[0] === player().docked) portNotice = { text: 'Plague has broken out here. No ship will put in until it passes, and you may not come back in once you sail.', icon: 'ui.icon.fire', tone: 'warn' };
      // A course to a port docks her on arrival; one that ran aground says so and hands back the helm.
      if (ev.type === 'CourseArrived' && ev.payload.portId) {
        const port = portInReach(ev.payload.portId as string);
        if (port?.id === ev.payload.portId) sim.send({ type: 'Dock', shipId: player().id, settlementId: port.id });
      }
      // An order refused in port: say why, rather than nothing happening.
      if (ev.type === 'TradeRefused' && player().docked && REFUSED[ev.payload.reason as string]) portNotice = { text: REFUSED[ev.payload.reason as string]!, icon: 'ui.icon.gold', tone: 'warn' };
      if (ev.type === 'MapPieceBought') moments.push({ kind: 'map', pirateId: ev.payload.pirateId as string, line: "That's all I know, captain. The rest is with men who'd sooner cut your throat." });
      if (ev.type === 'TradeRefused' && (ev.payload.reason === 'at-war' || ev.payload.reason === 'hostile')) {
        const name = settlements.find((s) => s.id === ev.payload.settlementId)?.name ?? 'the port';
        const flag = sim.state.captain?.nation;
        const text =
          ev.payload.reason === 'at-war' && flag
            ? `${name} won't let ${({ england: 'an English', spain: 'a Spanish', france: 'a French', netherlands: 'a Dutch' } as Record<string, string>)[flag]} ship in: ${countryName[ev.payload.nation as string]} is at war with ${countryName[flag]}`
            : `${name} won't let you in: you are their enemy`;
        courseNote = { text, kind: 'Port closed', icon: 'ui.icon.anchor', tone: 'warn', until: now + 5000 };
      }
      // Her fame has made her a famous pirate's quarry: she should know he is coming.
      if (ev.type === 'FamousSworn') {
        const name = content.pirates.captains.find((c) => c.id === ev.payload.pirateId)?.name ?? (ev.payload.pirateId as string);
        courseNote = { text: `Word is ${name} has sworn to take you: he is hunting you now`, kind: 'Famous pirate', icon: 'ui.icon.cannon_loaded', tone: 'warn', until: now + 6000 };
      }
      if (ev.type === 'MenStarved') {
        const n = ev.payload.count as number;
        courseNote = { text: `${n} ${n === 1 ? 'man' : 'men'} died of hunger: make port, or hail a ship (pick her, Space) and buy food`, kind: 'Starving', icon: 'ui.icon.food', tone: 'warn', until: now + 5000 };
      }
      if (ev.type === 'TradeRefused' && ev.payload.reason === 'plague') {
        const name = settlements.find((s) => s.id === ev.payload.settlementId)?.name ?? 'the port';
        const left = plagueDaysLeft(content, sim.state, String(ev.payload.settlementId));
        courseNote = {
          text: `Plague at ${name}: the port is shut to shipping${left !== undefined ? ` for ${plagueLeftSaid(left)}` : ''}`,
          kind: 'Port shut',
          icon: 'ui.icon.anchor',
          tone: 'warn',
          until: now + 4000,
        };
      }
      if (ev.type === 'AssistEnded' && ev.payload.reason === 'aground') {
        // Pressed onto the shore within reach of the port she was bound for: she goes in all the same.
        const port = portInReach(destination?.id);
        if (port && port.id === destination?.id) sim.send({ type: 'Dock', shipId: player().id, settlementId: port.id });
        else courseNote = { text: 'Aground: no way through there. Take the helm', kind: 'Aground', icon: 'ui.icon.hull', tone: 'warn', until: now + 3500 };
      }
      // A pirate cove found (sighted, docked at, given up by a pirate or a tavern): said, and on the chart from now.
      const known = sim.state.captain?.knownHavens ?? [];
      if (known.length > havensKnown) {
        const cove = settlements.find((s) => s.id === known.at(-1));
        if (cove) courseNote = { text: `A pirate haven: ${cove.name}. It's on your chart now.`, kind: 'Haven found', icon: 'ui.icon.anchor', tone: 'gold', until: now + 6000 };
        havensKnown = known.length;
      }
      // Two ships falling on each other: told once the fight comes into her view (below).
      if (ev.type === 'SkirmishBegun') unseenFights.set(ev.entityIds[1]!, ev.entityIds[0]!);
      // A fight between other ships within sight: smoke on the water and the thud of distant guns.
      if (ev.type === 'SeaFight') {
        const me = player();
        const x = ev.payload.x as number;
        const y = ev.payload.y as number;
        const d = Math.hypot(x - me.x, y - me.y);
        if (d <= view()) {
          sea3d.seaFight(x, y);
          audio.battle.broadside(6, (x - me.x) / 20, 0.4 / (1 + d / 10), d > FAR_GUNS_TILES);
        }
      }
    }
    eventsSeen = evs.length;
    // A fight come into her sight (begun there, or come up over the horizon): who, and where, and that she may take a hand.
    for (const [preyId, hunterId] of unseenFights) {
      const [hunter, prey] = [sim.state.ships[hunterId], sim.state.ships[preyId]];
      if (!hunter?.ai?.skirmish || !prey?.ai) {
        unseenFights.delete(preyId);
        continue;
      }
      const me = player();
      if (Math.hypot(prey.x - me.x, prey.y - me.y) > view()) continue;
      unseenFights.delete(preyId);
      // "an English" as the port-closed note says it, not "a English".
      const who = (ship: Ship) => `${ship.ai!.role === 'pirate' ? 'a pirate' : ({ spain: 'a Spanish', england: 'an English', france: 'a French', netherlands: 'a Dutch' } as Record<string, string>)[ship.ai!.nation] ?? 'a'} ${shipKind(ship.classId)}`;
      courseNote = {
        text: `${who(hunter)} has fallen on ${who(prey)} ${fromTheBow(me, prey)}: pick her (Tab), Space to close`.replace(/^./, (c) => c.toUpperCase()),
        kind: 'Sea fight',
        icon: 'ui.icon.cannon_loaded',
        until: now + 6000,
      };
    }
    // Ships hove to fighting within sight (a skirmish): broadsides back and forth until it's settled.
    for (const s of Object.values(sim.state.ships)) {
      const foe = s.ai?.skirmish ? sim.state.ships[s.ai.skirmish.with] : undefined;
      if (!foe) continue;
      const me = player();
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d > view() || loop.paused || now < (nextVolley.get(s.id) ?? 0)) continue;
      // Each side fires every couple of seconds, staggered so the guns answer each other.
      nextVolley.set(s.id, now + VOLLEY_MS * (0.8 + 0.4 * Math.random()));
      sea3d.seaFight(s.x, s.y);
      audio.battle.broadside(4, (s.x - me.x) / 20, 0.4 / (1 + d / 10), d > FAR_GUNS_TILES);
    }
    // In port the harbour scene (2D, illustrated) covers the screen; at sea the 3D view does.
    const atSea = !fight && !renderer.harbour.visible;
    if (!atSea && !fight) renderer.render(harbourSkyShift ? { ...sim.state, tick: sim.state.tick + harbourSkyShift } : sim.state, now);
    sea3d.canvas.style.display = atSea || fight ? '' : 'none';
    if (atSea) sea3d.render(sim.state, now);
    shipLabels.update(sim.state, def.start.shipId, (x, y) => sea3d.project(x, y), atSea, targeted()?.id);
    charts.update(
      sim.state.ships[def.start.shipId],
      { sightings: sim.state.captain?.sightings ?? {}, tick: sim.state.tick, ticksPerDay: content.calendar.ticksPerDay },
      guide,
    );
    charts.rings([
      ...content.pirates.captains.flatMap((c) => {
        const hoard = sim.state.famous?.[c.id]?.hoard;
        const held = sim.state.captain?.mapPieces?.[c.id] ?? 0;
        return hoard && held && !hoard.found ? [{ ...hoardRing(content, hoard, held), label: `${c.name}'s hoard: ${held} of ${content.pirates.rules.mapPieces} pieces` }] : [];
      }),
      // The waters a mission's quarry haunts, about the port the governor named; a courier's letter, then his reply,
      // marked at the port it is bound for.
      ...(sim.state.captain?.missions ?? []).flatMap((m) => {
        if (m.done !== undefined) return [];
        const name = (id: string) => settlements.find((s) => s.id === id)?.name ?? id;
        if (m.kind === 'courier') {
          const bound = settlements.find((s) => s.id === (m.delivered === undefined ? m.to : m.from));
          if (!bound) return [];
          const r = content.politics.missions.courier.ringTiles;
          return [m.delivered === undefined ? { x: bound.x, y: bound.y, r, label: `${name(m.from)}'s letter`, say: `deliver it to ${bound.name}` } : { x: bound.x, y: bound.y, r, label: `${name(m.to)}'s reply`, say: `bring it to ${bound.name}` }];
        }
        const at = settlements.find((s) => s.id === m.to);
        return at ? [{ x: at.x, y: at.y, r: content.politics.missions.hunt.ringTiles, label: `The ${m.name}: wanted by ${name(m.from)}`, say: 'hunt here' }] : [];
      }),
    ]);
    const ship = player();
    const day = Math.floor(sim.state.tick / content.calendar.ticksPerDay);
    const hour = hourOf(content.calendar, sim.state.tick);
    const breeze = breezes.at(sim.state.tick, ship.x, ship.y);
    const wind = windAt(sim.state, ship.x, ship.y);
    const offWind = angleOffWind(ship.headingDeg, wind.fromDeg);
    const inStorm = (sim.state.weather?.storms ?? []).some((s) => stormWindAt(s, ship.x, ship.y));
    const cls = content.ships[ship.classId]!;
    const cruise = timeScale(inStorm);
    if (audio.nowPlaying !== songHeard) {
      songHeard = audio.nowPlaying;
      songShownUntil = now + SONG_MS;
    }
    speedNow = cruise.scale;
    // Sail ho: call out each ship as she first comes within range.
    const seen = new Set<string>();
    for (const s of Object.values(sim.state.ships)) {
      if (!s.ai || inPort(s) || ship.docked || Math.hypot(s.x - ship.x, s.y - ship.y) > SAIL_HO_TILES) continue;
      seen.add(s.id);
      if (inSight.has(s.id)) continue;
      sailHo = { id: s.id, until: now + SAIL_HO_MS };
      // The ship called out is the one Space acts on, unless the captain has picked another.
      if (!targeted()) {
        target = s.id;
        chosen = false;
      }
    }
    inSight.clear();
    for (const id of seen) inSight.add(id);
    // A pirate fallen on a merchant within sight: the player can sail in and take a hand.
    const raider = Object.values(sim.state.ships).find(
      (s) => s.ai?.role === 'pirate' && s.ai.skirmish && Math.hypot(s.x - ship.x, s.y - ship.y) <= view(),
    );
    const raided = raider?.ai?.skirmish ? sim.state.ships[raider.ai.skirmish.with] : undefined;
    // The crew's needs, when they press: food running out, or a grumbling crew. (A hail is Space on the ship picked:
    // there is no H key, so the warnings name the keys that work.)
    const days = foodDays(content, ship);
    const mood = moraleOf(content, sim.state);
    const left = Math.floor(days);
    // Beaten to a crawl: canvas below the jury rig's, or a hull that drags (under 30%).
    const hullMax = shipStats(content, ship).hullMax;
    const crippled = (ship.sailCondition ?? 100) < content.combat.juryRig.sails || (ship.hull ?? hullMax) < hullMax * 0.3;
    const crewWarning: Toast | undefined = ship.docked
      ? undefined
      : days < 1
        ? { text: 'The food is gone: the crew is starving. Make port, or hail a passing ship (pick her, Space) and buy food from her', kind: 'Warning: hunger', icon: 'ui.icon.food', tone: 'warn' }
        : days <= 3
          ? { text: `Food for ${left === 1 ? 'one more day' : `${left} days`}: buy food in port, or from a passing ship (pick her, Space)`, kind: 'Warning: hunger', icon: 'ui.icon.food', tone: 'warn' }
          : crippled
            ? {
                text: `Badly damaged (sails ${Math.round(ship.sailCondition ?? 100)}%, hull ${Math.round(((ship.hull ?? hullMax) / hullMax) * 100)}%): she sails slowly. Her crew rig jury sails as she goes, but only a shipwright mends her properly`,
                kind: 'Warning: damage',
                icon: 'ui.icon.hull',
                tone: 'warn',
              }
            : mood < content.crew.morale.grumbling
              ? { text: `The crew is ${moraleWord(content, mood).toLowerCase()}: divide the plunder or pay wages in a tavern`, kind: 'Warning: the crew', icon: 'ui.icon.morale', tone: 'warn' }
              : undefined;
    // Autosave on arriving in port, whichever way the Dock command came in.
    if (ship.docked && !wasDocked) {
      // Made port: the destination is reached (or another port suited better); the route goes.
      if (destination) {
        destination = undefined;
        guide = undefined;
        charts.clearDestination();
      }
      save();
      // The merchant opens on arrival and the tavern is a click away: have their rooms ready.
      const here = settlements.find((s) => s.id === ship.docked);
      for (const svc of ['merchant', 'tavern'] as const) {
        const room = here && interior(here, svc);
        if (room) renderer.harbour.preload(room);
      }
    }
    wasDocked = Boolean(ship.docked);
    // What Space does now, and the ship picked with what Space would do about her.
    const action = seaAction();
    const picked = ship.docked || hailing ? undefined : targeted();
    // Her ship sails with the gentle wind when the player has chosen it (a new or prize flagship takes it up too).
    if (Boolean(ship.gentleWind) !== gentleWind) sim.send({ type: 'SetGentleWind', shipId: ship.id, on: gentleWind });
    // A hunter closing on the player: a warning beats any other prompt.
    const hunter = Object.values(sim.state.ships).find((s) => s.ai?.chasing);
    const spoken = hailing && sim.state.ships[hailing.targetId];
    render(
      spoken ? (
        <Hail
          state={sim.state}
          content={content}
          settlements={settlements}
          ship={spoken}
          news={hailing!.news}
          close={partWays}
          lawful={spoken.ai ? legalTarget(content, sim.state, sim.state.captain, spoken.ai.nation) : undefined}
          buyFood={(units) => {
            sim.send({ type: 'BuyProvisions', shipId: player().id, targetId: hailing!.targetId, units });
            sim.applyCommands();
          }}
          room={Math.max(0, fleetHold(content, sim.state, player()) - cargoUsed(player()))}
          attack={attackSpoken}
        />
      ) : null,
      hailRoot,
    );
    // The First Voyage's first prize: the pirate is the ship picked (not the boat she harries), until she is taken.
    {
      const v = sim.state.captain?.voyage;
      const boat = v?.boatId ? sim.state.ships[v.boatId] : undefined;
      if (v?.step === 'prize' && v.pirateId && sim.state.ships[v.pirateId] && target !== v.pirateId && (!target || target === v.boatId)) {
        target = v.pirateId;
        chosen = false;
      } else if (v && v.step !== 'prize' && target && target === v.boatId && !boat?.ai?.voyage) target = undefined;
    }
    // The career's goals: the next is the sea's goal pill and a deed card's "Next", the rest wait in the log.
    const goals = careerGoals(content, sim.state, settlements);
    // Bound for the cay on the First Voyage, the voyage guides her: its orders stand for the goal, its lesson for the prompt.
    const guided = !ship.docked && sim.state.captain?.voyage && !['harbour', 'done'].includes(sim.state.captain.voyage.step) ? sim.state.captain.voyage.step : undefined;
    // Her new honours, queued; a rank and a hoard have their own moments.
    for (const h of sim.state.captain?.honours ?? []) {
      if (deedsSeen.has(h.id)) continue;
      deedsSeen.add(h.id);
      if (h.kind !== 'rank' && h.kind !== 'hoard') deedQueue.push(h);
    }
    // The governors' missions in hand: the nearest is the sea's goal pill, and the log lists them all.
    const missions = missionGoals(sim.state, settlements);
    if (fight) logOpen = false;
    render(
      logOpen ? (
        <Log
          content={content}
          state={sim.state}
          map={map}
          settlements={settlements}
          shipId={ship.id}
          send={(command) => {
            sim.send(command);
            sim.applyCommands();
          }}
          close={() => (logOpen = false)}
          openChart={() => {
            logOpen = false;
            charts.show();
          }}
          goals={[...missions, ...goals]}
          date={(tick) => formatDate(dateOf(def.startDate, Math.floor(tick / content.calendar.ticksPerDay)))}
          plot={(x, y) => {
            // A port already in reach at sea: go in, rather than plot a course to where she lies.
            const port = portAt(x, y);
            const reach = player().docked ? undefined : portInReach();
            if (port && reach && port.id === reach.id) sim.send({ type: 'Dock', shipId: player().id, settlementId: port.id });
            else setCourse(x, y, false);
            logOpen = false;
          }}
        />
      ) : null,
      logRoot,
    );
    // The First Voyage at sea, bound for the cay: the orders, the lesson, the smoke.
    const voyage = sim.state.captain?.voyage;
    const bound = voyage && !ship.docked && !fight && voyage.step !== 'harbour' && voyage.step !== 'done' ? voyage : undefined;
    const toCay = bound?.step === 'helm' || bound?.step === 'salvage';
    // The wreck lies on the cay until she has done with it; it smokes until she has salvaged it.
    const wrecked = voyage && ['helm', 'salvage', 'prize'].includes(voyage.step) ? voyage.cay : undefined;
    sea3d.wreck(wrecked, toCay);
    const irons = Boolean(bound?.step === 'helm' && ship.sails !== 'furled' && pointOfSail(content, offWind).id === 'irons');
    if (irons) windShown = true;
    // Where the order in hand is to be done: the cay, the pirate, then home.
    const quarry = bound?.step === 'prize' && bound.pirateId ? sim.state.ships[bound.pirateId] : undefined;
    const mark = bound && (toCay ? bound.cay : (quarry ?? settlements.find((s) => s.id === bound.home)));
    render(
      bound ? (
        <div class="voyage-sea">
          <OrdersCard
            orders={voyageOrders(bound, settlements.find((s) => s.id === bound.home)?.name ?? '')}
            far={mark && `${Math.max(1, Math.round(Math.hypot(ship.x - mark.x, ship.y - mark.y) * kmPerTile))} km`}
          />
          {bound.step === 'helm' && !moments[0] ? <HelmLessons v={bound} irons={irons} windShown={windShown} /> : null}
          {quarry && !moments[0] && !deedQueue.length ? <NedSays label="Sail ho!" line={`"A pirate's harrying a fishing boat out at sea: follow the line. She's no great guns, Captain: take her."`} /> : null}
          {toCay ? (
            <CayMark
              name={bound.cay.name}
              at={(() => {
                const at = sea3d.project(bound.cay.x, bound.cay.y);
                return at && { px: at.px, py: at.py - 110 };
              })()}
            />
          ) : null}
        </div>
      ) : null,
      voyageRoot,
    );
    // The deed at the head of the queue, once nothing else holds the screen: small at sea (it slides away), standing
    // in port or for a first or a mission (after a fight), until dismissed.
    const deed = !fight && !moments[0] && !logOpen && !hailing ? deedQueue[0] : undefined;
    if (deed && !deedShownAt) {
      deedShownAt = now;
      deedInPort = Boolean(ship.docked);
      deedStays = deedInPort || deed.kind === 'first' || deed.kind === 'mission' || deed.kind === 'marque';
      // Gold rings its own coins; a deed without gold rings the bell.
      if (deed.gold === undefined) audio.honour();
    }
    // A small card slides away; one shown in port goes when she sails.
    if (deed && deedShownAt && ((!deedStays && now - deedShownAt > DEED_SMALL_MS) || (deedInPort && !ship.docked))) closeDeed();
    render(
      deed && deedShownAt ? (
        (() => {
          const bar = meritBar(content, sim.state.captain, deed.nation);
          const goal = nextGoal(goals, sim.state.captain?.gold ?? 0);
          // On the First Voyage the next thing is her next order.
          const order = voyage && voyage.step !== 'done' ? voyageOrders(voyage, settlements.find((s) => s.id === voyage.home)?.name ?? '').find((o) => !o.done) : undefined;
          const lower = (t: string) => t[0]!.toLowerCase() + t.slice(1);
          const next = bar?.next ?? (voyage && voyage.step !== 'done' ? order && lower(order.text) : goal && lower(goal.title));
          return <DeedCard honour={deed} weight={deedStays ? 'standard' : 'small'} age={now - deedShownAt} next={next} bar={bar?.share} close={closeDeed} />;
        })()
      ) : null,
      deedRoot,
    );
    render(
      moments[0] && !fight ? (
        <MomentView
          moment={moments[0]}
          content={content}
          state={sim.state}
          map={map}
          settlements={settlements}
          scene={sceneUrl}
          close={closeMoment}
          plot={(x, y) => setCourse(x, y, false)}
          toGovernor={() => {
            portRequest = { service: 'governor' };
            closeMoment();
          }}
          honour={() => audio.honour()}
        />
      ) : null,
      momentRoot,
    );
    const town = ship.docked ? settlements.find((s) => s.id === ship.docked) : undefined;
    const harbour = town && harbourScene(town);
    void renderer.harbour.show(town && ((service && interior(town, service)) || harbour?.scene));
    stage.classList.toggle('in-port', Boolean(town));
    stage.classList.toggle('log-open', logOpen);
    stage.classList.toggle('moment-open', Boolean(moments[0] && !fight));
    stage.classList.toggle('voyage-guided', Boolean(bound));
    stage.classList.toggle('deed-small-on', Boolean(deed && deedShownAt && !deedStays));
    stage.classList.toggle('hail-open', Boolean(hailing));
    render(
      sim.state.captain?.retired ? (
        <Ending content={content} state={sim.state} again={() => location.reload()} saveFile={(name) => exportSave(toSave(sim.state, seed, fingerprint, Date.now()), name)} />
      ) : town ? (
        <Port
          state={sim.state}
          content={content}
          town={town}
          settlements={settlements}
          shipId={ship.id}
          hotspots={harbour ? hotspotsOnScreen({ ...harbour.hotspots, docks: [harbour.anchor[0] - 60, harbour.anchor[1] - 22, 120, 44] }) : {}}
          onOpen={(s) => (service = s)}
          notice={portNotice}
          date={formatDate(dateOf(def.startDate, Math.floor(sim.state.tick / content.calendar.ticksPerDay)))}
          map={map}
          plot={(x, y) => setCourse(x, y, false)}
          openLog={() => (logOpen = true)}
          request={portRequest}
          send={(command) => {
            sim.send(command);
            sim.applyCommands();
          }}
        />
      ) : null,
      portRoot,
    );
    // Asked once: the port has it now, and a later call must not open the governor again.
    portRequest = undefined;
    // Sound must never stop the game: report a failure once and keep sailing.
    try {
      audio.update(
        {
          wind: content.navigation.windStrength[wind.strength]!,
          offWindDeg: offWind,
          speed: speedPoints(content, ship) / shipStats(content, ship).speed,
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
    // The route plotted to the destination picked on the chart: re-plotted about once a second from where
    // she is (so it never runs through land), drawn on the sea, and measured for the HUD along the way.
    if (destination && !ship.docked && now - lastGuide > REPLAN_MS) {
      lastGuide = now;
      const berth = lanes.berth(destination.id);
      guide = berth ? lanes.path([ship.x, ship.y], berth)?.slice(1) : undefined;
    }
    // No course of her own on the First Voyage: the line runs to her order in hand (the cay, the pirate, home).
    const quest = sim.state.captain?.voyage;
    const questAt = !destination && quest && !ship.docked && !fight
      ? quest.step === 'helm' || quest.step === 'salvage'
        ? ([quest.cay.x, quest.cay.y] as [number, number])
        : quest.step === 'prize' && quest.pirateId && sim.state.ships[quest.pirateId]
          ? ([sim.state.ships[quest.pirateId]!.x, sim.state.ships[quest.pirateId]!.y] as [number, number])
          : quest.step === 'home'
            ? lanes.berth(quest.home)
            : undefined
      : undefined;
    if (questAt && now - lastQuestGuide > REPLAN_MS) {
      lastQuestGuide = now;
      questGuide = lanes.path([ship.x, ship.y], questAt)?.slice(1);
    }
    sea3d.guide(destination && !ship.docked ? guide : questAt ? questGuide : undefined);
    let course: { name: string; distanceKm: number; bearingDeg: number; following: boolean; days: number; food: number } | undefined;
    if (destination && guide?.length) {
      let tiles = 0;
      let [px, py] = [ship.x, ship.y];
      for (const [x, y] of guide) {
        tiles += Math.hypot(x - px, y - py);
        [px, py] = [x, y];
      }
      const [nx, ny] = guide[0]!;
      const bearingDeg = ((Math.atan2(nx - ship.x, -(ny - ship.y)) * 180) / Math.PI + 360) % 360;
      const following = ship.assist?.mode === 'course' && ship.assist.portId === destination.id;
      course = { name: destination.name, distanceKm: tiles * kmPerTile, bearingDeg, following, days: tiles / sailPerDay(ship), food: foodDays(content, ship) };
    }
    const stats = shipStats(content, ship);
    const morale = moraleOf(content, sim.state);
    const hullShare = (ship.hull ?? stats.hullMax) / stats.hullMax;
    const strip = {
      gold: sim.state.captain?.gold ?? 0,
      chest: Math.round(sim.state.captain?.chest ?? 0),
      crew: crewOf(content, ship),
      berths: fleetBerths(content, sim.state, ship),
      foodDays: foodDays(content, ship),
      morale: moraleWord(content, morale),
      moraleLow: morale < 40,
      hull: bandOf(hullShare, [[0, 'Sinking'], [0.3, 'Badly hurt'], [0.6, 'Holed'], [0.9, 'Sound']]),
      hullLow: hullShare < 0.6,
      foul: ship.fouling,
      hold: cargoUsed(ship),
      capacity: fleetHold(content, sim.state, ship),
    };
    // Any change on the strip brings it back; at rest it fades.
    const shown = JSON.stringify({ ...strip, foodDays: Math.floor(strip.foodDays) });
    if (shown !== stripSeen) {
      stripSeen = shown;
      stripChanged = now;
    }
    render(
      <Hud
        state={sim.state}
        content={content}
        wind={wind}
        date={formatDate(dateOf(def.startDate, day))}
        seaArea={(() => {
          // The sea area, and how dangerous its waters are (traffic.json danger).
          const zone = zoneAt(content, map, ship.x, ship.y);
          const tier = content.traffic.danger.zones[zone.id];
          return tier ? `${zone.name} · ${content.traffic.danger.names[tier]}` : zone.name;
        })()}
        inStorm={inStorm}
        sound={
          audio.muted
            ? 'Sound off · V'
            : !audio.unlocked
              ? 'Press any key for sound'
              : !audio.music
                ? 'Music off · N'
                : now < songShownUntil && audio.nowPlaying
                  ? `♪ ${audio.nowPlaying}`
                  : undefined
        }
        breeze={breeze && `${breeze.kind} breeze`}
        destination={course}
        knotsPerTilePerSecond={knotsPerTilePerSecond}
        viewDeg={sea3d.viewDeg()}
        prompt={
          hunter
            ? `A ${shipTitle(hunter)} is closing on you! Run, or stand and fight.`
            : guided === 'helm'
              ? undefined
            : action
              ? `${action.text} · Space`
              : raider && raided?.ai
                  ? raided.ai.role === 'patrol'
                    ? `Gunfire to the ${pointOfCompass(ship, raider)}! The ${shipTitle(raided)} ${raided.ai.name} has caught the pirate ${raider.ai!.name}`
                    : `Gunfire to the ${pointOfCompass(ship, raider)}! The pirate ${raider.ai!.name} has fallen on the ${shipTitle(raided)} ${raided.ai.name}: pick her (Tab) and sail in to take a hand`
                  : ship.assist?.mode === 'course'
                        ? ship.assist.towing
                          ? 'The wind is foul for the harbour: her boats tow her in · steer to take the helm'
                          : `Sailing to ${ship.assist.portId ? (settlements.find((s) => s.id === ship.assist!.portId)?.name ?? 'port') : 'the mark'} · steer to take the helm`
                        : undefined
        }
        hour={hour}
        held={cruise.held}
        saved={now - savedAt < 2000}
        banner={(() => {
          const her = sailHo && now < sailHo.until ? sim.state.ships[sailHo.id] : undefined;
          if (!her?.ai) return undefined;
          const wanted = her.ai.mission ? sim.state.captain?.missions?.find((m) => m.id === her.ai!.mission) : undefined;
          const by = wanted && settlements.find((s) => s.id === wanted.from)?.name;
          const who = her.ai.famous
            ? `${her.ai.name} himself, in a ${shipKind(her.classId)},`
            : wanted
              ? `The pirate ${shipKind(her.classId)} ${her.ai.name}, the one ${by} wants,`
              : // "An English fluyt", not "A English".
                `${/^[aeiou]/i.test(shipTitle(her)) ? 'An' : 'A'} ${shipTitle(her)}`;
          const act = picked?.id === her.id ? shipAction(her) : undefined;
          return { text: `${who} ${fromTheBow(ship, her)}`, act: act && (act.text.startsWith('Hail') ? 'hail' : act.text.startsWith('Stop') ? 'stop' : 'chase') };
        })()}
        picked={(() => {
          if (!picked?.ai) return undefined;
          const act = shipAction(picked);
          const tiles = Math.hypot(picked.x - ship.x, picked.y - ship.y);
          return {
            nation: picked.ai.nation,
            tag: NATION_ADJECTIVE[picked.ai.nation] ?? picked.ai.nation,
            name: picked.ai.name,
            what: `${shipKind(picked.classId)}, ${picked.ai.famous ? 'famous pirate' : picked.ai.role === 'patrol' ? 'man-of-war' : picked.ai.role}`,
            where: `${Math.max(1, Math.round(tiles * kmPerTile))} km ${fromTheBow(ship, picked)}`,
            ...(act ? { act: act.text, run: act.run } : {}),
            drop: () => {
              stopChasing(picked.id);
              pick(undefined);
            },
          };
        })()}
        toasts={[...[digNote, courseNote].flatMap((n) => (n && now < n.until ? [n] : [])), ...(crewWarning ? [crewWarning] : [])]}
        goal={(() => {
          if (guided) return undefined;
          const g = missions[0] ?? nextGoal(goals, sim.state.captain?.gold ?? 0);
          return g && { title: g.title, have: g.have, of: g.of, unit: g.unit, mission: g.mission };
        })()}
        strip={strip}
        faded={now - stripChanged > STRIP_REST_MS}
        setSails={(sails) => sim.send({ type: 'SetSails', shipId: ship.id, sails })}
        cruise={{ speed: wantedSpeed, choose: (n) => (wantedSpeed = n), holds: cruiseHolds, toggleHolds: () => setCruiseHolds(!cruiseHolds) }}
        gentleWind={{ on: gentleWind, toggle: () => setGentleWind(!gentleWind) }}
        help={helpOpen}
        closeHelp={() => (helpOpen = false)}
        fleetPace={(() => {
          const fleet = fleetOf(sim.state);
          if (!fleet.length || ship.fleetSpeed === undefined || ship.fleetSpeed >= shipStats(content, { ...ship, fleetSpeed: undefined }).speed) return undefined;
          const slowest = [...fleet].sort((a, b) => fleetShipPace(content, a) - fleetShipPace(content, b))[0]!;
          const damaged = fleetShipPace(content, slowest) < shipStats(content, slowest).speed;
          return `Fleet of ${fleet.length + 1}, held to ${ship.fleetSpeed} by the ${shipKind(slowest.classId)}${damaged ? "'s damage: mend her at a shipwright" : ''}`;
        })()}
      />,
      hudRoot,
    );
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // The first frame warms the 3D up; the loading screen goes once it has been drawn.
  requestAnimationFrame(() => requestAnimationFrame(() => loading.done()));
}

void main();
