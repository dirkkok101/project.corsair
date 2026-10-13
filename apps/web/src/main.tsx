import { createAudio } from '@corsair/audio';
import { contentFingerprint, createSim, dateOf, formatDate, inPort, TICKS_PER_SECOND, toSave } from '@corsair/core';
import type { Nation, Ship, WorldState } from '@corsair/core';
import { decodeRasterMap, difficultyOf, gameplayContent, hourOf, isLand, loadContent, placeSettlements, shipStats, tileAt } from '@corsair/data';
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
import type { PlacedSettlement } from '@corsair/data';
import { angleOffWind, pointOfSail, speedPoints } from '@corsair/systems-navigation';
import { render } from 'preact';
import { createDebugApi } from './debug';
import type { LoopControl } from './debug';
import { compassProps, Hud } from './hud';
import type { Toast } from './hud';
import { shipKind } from './ui-art';
import { Port } from './port';
import type { PortNotice, Service } from './port';
import { cargoUsed, closedTo, createEconomySystem, createLogbookSystem, hasGovernor, hoardRing, crewOf, DOCK_RANGE, famine, fleetBerths, fleetHold, fleetMinCrew, fleetOf, fleetShipPace, foodDays, shipValue, townOf, moraleOf, moraleWord, newsAt, newsText, plagued, tradeLean, withEconomy } from '@corsair/systems-economy';
import { createCharts } from './chart';
import type { CardLine } from './chart';
import { bindInput } from './input';
import { exportSave, loadStoredSave, storeSave } from './save';
import { Ending } from './career';
import { chooseCareer } from './start';
import { crewLook, Hail, shipTitle } from './hail';
import { Log } from './log';
import { letterMeans, MomentView } from './ui/moment';
import { showLoading } from './ui/loading';
import type { Moment } from './ui/moment';
import { bandOf } from './ui/kit';
import { createShipLabels } from './shiplabels';
import { bindMouse } from './mouse';
import { BattleHud } from './battle';
import type { BattleReport, PlunderChoice } from './battle';
import { createBattle } from '@corsair/minigame-sea-battle';
import type { Ammo, Battle } from '@corsair/minigame-sea-battle';
import { careerGoals, createSeaLanes, createTrafficSystem, prizePapers, withTraffic } from '@corsair/systems-traffic';
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

const COUNTRY_NAME: Record<string, string> = { england: 'England', spain: 'Spain', france: 'France', netherlands: 'The Netherlands' };

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
  const content = loadContent();
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
  const settlements = placeSettlements(def, map, content.settlements);
  /** A nation's capital: where a career under its flag begins. */
  const capitalOf = (n: string) => settlements.find((s) => s.nation === n && s.type === 'capital') ?? settlements.find((s) => s.id === def.start.port)!;
  loading.progress(0.6, 'Placing the ports');
  // The start screen: continue a stored career, or pick a new one's difficulty.
  // Only gameplay content counts: new music or sprite framing shouldn't flag every old save.
  const fingerprint = contentFingerprint(gameplayContent(content));
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
          settlements,
          levels: content.combat.difficulty.levels,
          defaultLevel: content.combat.difficulty.default,
          flags: (['england', 'spain', 'france', 'netherlands'] as const).map((n) => {
            const home = capitalOf(n);
            // Its wars as the career opens (the politics of the start date).
            const foes = enemiesOf(content, {} as WorldState, n).filter((x) => x !== 'pirate');
            return {
              nation: n,
              name: COUNTRY_NAME[n]!,
              port: home.name.replace(/ \(.*\)$/, ''),
              island: content.politics.flag.nations[n]?.island ?? '',
              about: content.politics.flag.nations[n]?.about ?? '',
              wars: foes.length ? `At war with ${foes.map((x) => COUNTRY_NAME[x]).join(' and ')}` : 'At peace with all',
              peace: !foes.length,
              art: sceneUrl(harbourId(home)),
            };
          }),
          defaultFlag: 'england',
        })
      : { difficulty: difficultyOf(content, params.get('difficulty') ?? undefined).id, nation: params.get('nation') ?? 'england' };
  if (titled) loading = showLoading(stage, sceneUrl('loading.dawn'));
  loading.progress(0.7, 'Raising the wind');
  const resumed = 'save' in choice ? choice.save : undefined;
  const seed = resumed?.seed ?? (Number.isInteger(asked) ? asked >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0]!);
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
    return withPolitics({ ...w, captain: { ...w.captain!, nation, standing: { ...w.captain!.standing, [nation]: content.politics.flag.standing } } }, seed);
  };
  const world = resumed?.state ?? fresh();
  const sim = createSim(world, [
    createWeatherSystem(content, def, map),
    createEconomySystem(content, settlements, map, windAt),
    createPoliticsSystem(content, def.startDate, settlements),
    createTrafficSystem(content, settlements, lanes, map, windAt),
    createNavigationSystem(content, map, windAt, settlements),
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
          // ?sea=plain (then layers by name) for review: what's drawn on the 3D sea.
          sea: new URLSearchParams(location.search).get('sea')?.split(',') ?? undefined,
          sound: (id, opts) => audio.playSfx(id, opts),
          townLine: (s, state) => {
            // "Prosperous English Capital": the town's trend, nation and kind, and anything ailing it.
            const t = townOf(content, state, s);
            const trend = t.trend > 0 ? 'Prosperous ' : t.trend < 0 ? 'Struggling ' : '';
            const nation = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch', pirate: 'Pirate' }[s.nation] ?? '';
            const kind = s.type === 'capital' ? 'Capital' : s.type === 'haven' ? 'Haven' : s.type === 'mission' ? 'Mission' : s.size === 'hamlet' ? 'Settlement' : s.size === 'city' ? 'City' : 'Town';
            const woes = [t.blockaded ? 'blockaded' : '', plagued(state, s.id) ? 'plague' : '', famine(content, state, s.id) ? 'famine' : ''].filter(Boolean);
            return `${trend}${nation} ${kind}${woes.length ? ` · ${woes.join(', ')}` : ''}`;
          },
        });
  viewport.appendChild(sea3d.canvas);
  loading.progress(0.9, 'Setting sail');
  const shipLabels = createShipLabels(viewport);
  // For review and tests: the 3D renderer's showcase and sky controls.
  (window as unknown as { __corsair3d?: typeof sea3d }).__corsair3d = sea3d;
  // ?sky=17.5 starts the 3D sky at that hour, for reviewing sunrise, sunset and night.
  const skyHour = Number(new URLSearchParams(location.search).get('sky'));
  if (Number.isFinite(skyHour) && skyHour > 0) sea3d.setSkyHour(skyHour);
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
  // Moments (storyboard 2.13): a letter, a promotion, a famous pirate's first sighting, a hoard, a map piece; one
  // at a time, over everything, the world waiting.
  const momentRoot = stage.appendChild(document.createElement('div'));
  const moments: Moment[] = [];
  // A career begun from the start screen opens with the governor's letter and the first goal (a ?seed= run, for
  // tests and replays, goes straight in).
  if (!resumed && titled && def.start.port) {
    const me = sim.state.ships[def.start.shipId]!;
    const town = home;
    const at = enemiesOf(content, sim.state, town.nation).filter((n) => n !== 'pirate');
    const goal = careerGoals(content, sim.state, settlements).find((g) => !g.done);
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
    const risk = (a: string, b: string): { risk: 'low' | 'some' | 'high'; haven: string } => {
      const r = lanes.route(a, b) ?? [];
      // The lane's nearest pass by a haven: how near, and whose.
      let near = Infinity;
      let haven = '';
      for (const p of r) {
        for (const h of havens) {
          const d = Math.hypot(h.x - p[0], h.y - p[1]);
          if (d < near) [near, haven] = [d, h.name];
        }
      }
      return { risk: near < reach * 0.35 ? 'high' : near < reach * 0.7 ? 'some' : 'low', haven };
    };
    const toStart = (s: PlacedSettlement) => (me.docked === s.id ? 0 : Math.hypot(s.x - me.x, s.y - me.y) / perDay);
    // Candidates are ranked on the straight-line distance first; only the best few have their lanes found
    // (finding a lane is the slow part), then they are ranked again on the real days at sea.
    const straight = (a: PlacedSettlement, b: PlacedSettlement) => Math.hypot(a.x - b.x, a.y - b.y) / perDay;
    type Candidate = { good: string; from: PlacedSettlement; to: PlacedSettlement; buy?: number; sell?: number; profit?: number; score: number };
    const priced: Candidate[] = [];
    const unpriced: Candidate[] = [];
    const worth = (id: string) => content.goods.find((x) => x.id === id)?.basePrice ?? 0;
    // Ports closed to her (at war with her flag, or that she made an enemy of) are no voyage.
    const open = settlements.filter((s) => {
      const why = closedTo(content, sim.state, s);
      return why !== 'at-war' && why !== 'hostile';
    });
    for (const g of content.goods.filter((x) => !x.staple)) {
      for (const from of open) {
        for (const to of open) {
          if (from === to) continue;
          const buy = known[from.id]?.prices[g.id]?.buy;
          const seen = known[to.id]?.prices[g.id];
          const days = Math.max(0.5, toStart(from) + straight(from, to));
          if (buy !== undefined && seen?.sell !== undefined) {
            const units = Math.min(room, Math.floor(gold / buy));
            if (units < 1 || seen.sell <= buy) continue;
            const sag = 0.125 * Math.min(1, units / Math.max(1, seen.depth ?? 99));
            const profit = Math.round((units * (seen.sell * (1 - sag) - buy)) / 10) * 10;
            if (profit > 0) priced.push({ good: g.id, from, to, buy, sell: seen.sell, profit, score: profit / days });
          } else if (
            // Leads (prices unseen) only within a few days' sail, so the list stays near enough to act on.
            straight(from, to) * perDay <= 360 &&
            tradeLean(content, from, g.id) === 'exports' &&
            tradeLean(content, to, g.id) === 'wants'
          ) {
            unpriced.push({ good: g.id, from, to, score: worth(g.id) / days });
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
        : { good: c.good, from: c.from, to: c.to, go: bought ? c.to : c.from, daysToStart: toStart(c.from), days: length / perDay, ...risk(c.from.id, c.to.id) };
    };
    const trades = priced
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .flatMap((c) => {
        const t = sail(c);
        return t ? [{ ...t, buy: c.buy!, sell: c.sell!, profit: c.profit! }] : [];
      })
      .sort((a, b) => b.profit / perTrip(b) - a.profit / perTrip(a));
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
  let lastGuide = -Infinity;
  const charts = createCharts(stage, map, settlements, (port) => {
    destination = port;
    lastGuide = -Infinity;
  }, {
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
      if (s && plagued(sim.state, id)) return 'Plague: the port is shut to all shipping until it passes.';
      if (!s || s.nation === 'pirate') return undefined;
      const flag = sim.state.captain?.nation;
      if (flag && closedTo(content, sim.state, s) === 'at-war') {
        return `Closed to you: ${COUNTRY_NAME[s.nation]} is at war with ${COUNTRY_NAME[flag]}, and her warships hunt your flag.`;
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
      return `${(Math.round(t.people / 100) * 100).toLocaleString()} people${t.trend > 0 ? ', growing' : t.trend < 0 ? ', shrinking' : ''}${t.blockaded ? ', blockaded: little gets in' : ''}${famine(content, sim.state, id) ? ', famine' : ''}${plagued(sim.state, id) ? ', plague: port shut' : ''}${
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
      // Days by the lanes, at a fair average of her best speed (as the voyage planner reckons them).
      const perDay = content.navigation.tilesPerSecondPerSpeedPoint * shipStats(content, me).speed * 0.6 * (content.calendar.ticksPerDay / TICKS_PER_SECOND);
      const days = me.docked === id ? 0 : (Math.hypot(s.x - me.x, s.y - me.y) * 1.3) / perDay;
      return { painting: sceneUrl(harbourId(s)), days, lines: lines.slice(0, 4) };
    },
    closed: (id) => {
      const port = settlements.find((s) => s.id === id);
      return Boolean(port && closedTo(content, sim.state, port) === 'at-war');
    },
    mark: (id) => {
      if (plagued(sim.state, id)) return 'plague';
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
      if ((e.key === 'Enter' || e.key === 'Escape') && !e.repeat) closeMoment();
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
    // H: hail the ship alongside, or part ways.
    if (e.key.toLowerCase() === 'h' && !e.repeat && !e.ctrlKey && !e.metaKey) {
      if (hailing) hailing = undefined;
      else hail(shipInHail());
    }
    if (e.key === 'Escape') hailing = undefined;
    // K: careen her on a nearby beach when her bottom is foul: free, but days of her time.
    if (e.key.toLowerCase() === 'k' && !e.repeat && !e.ctrlKey && !e.metaKey && !fight && !logOpen && !hailing && !player().docked) {
      const before = sim.events().length;
      const me = player();
      sim.send({ type: 'SetSails', shipId: me.id, sails: 'furled' });
      sim.send({ type: 'Careen', shipId: me.id, beach: true });
      sim.applyCommands();
      const ev = sim.events().slice(before).find((x) => x.type === 'Careened' || x.type === 'TradeRefused');
      if (ev?.type === 'Careened') {
        sim.step(Math.round(content.calendar.ticksPerDay * content.economy.fouling.beachDays));
        digNote = { text: `Hove down on the beach for ${content.economy.fouling.beachDays} days: her bottom is clean, and she sails at her best again`, kind: 'Careened on a beach', icon: 'ui.icon.hull', until: performance.now() + 7000 };
      } else digNote = { text: 'No beach within reach to heave her down on: close the shore first', kind: 'No beach', icon: 'ui.icon.anchor', until: performance.now() + 4000 };
    }
    // G: go ashore and dig, inside a treasure map's search ring and near a beach (D steers; G boards only in battle).
    if (e.key.toLowerCase() === 'g' && !e.repeat && !e.ctrlKey && !e.metaKey && !fight && !logOpen && !hailing && !player().docked) {
      if (digHere()) dig();
      else digNote = { text: "Nothing to dig for here: sail into a treasure map's search ring (M), close to the shore", kind: 'Nothing to dig', icon: 'ui.icon.chest', until: performance.now() + 4000 };
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
    // F: follow the route plotted to the destination (again to stop): the autopilot sails it, beating where it
    // must and keeping off the coasts, and docks her on arrival. Steering by hand takes the helm back.
    if (e.key.toLowerCase() === 'f' && !e.repeat && !e.ctrlKey && !e.metaKey && !player().docked && !fight) {
      const me = player();
      if (me.assist?.mode === 'course') sim.send({ type: 'SetAssist', shipId: me.id, assist: 'off' });
      else if (destination) {
        const berth = lanes.berth(destination.id);
        const route = berth ? lanes.path([me.x, me.y], berth) : undefined;
        if (route) sim.send({ type: 'SetAssist', shipId: me.id, assist: 'course', x: destination.x, y: destination.y, portId: destination.id, route: route.slice(1) });
      }
    }
    // I: intercept the nearest ship in sight (again to stop), steering to meet her until the helm is used.
    if (e.key.toLowerCase() === 'i' && !e.repeat && !e.ctrlKey && !e.metaKey && !player().docked) {
      const me = player();
      if (me.assist?.mode === 'intercept') sim.send({ type: 'SetAssist', shipId: me.id, assist: 'off' });
      else {
        const sight = content.traffic.sightTiles;
        const target = Object.values(sim.state.ships)
          .filter((s) => s.ai && !inPort(s) && Math.hypot(s.x - me.x, s.y - me.y) <= sight)
          .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
        if (target) sim.send({ type: 'SetAssist', shipId: me.id, assist: 'intercept', targetId: target.id });
      }
    }
    // Cruise speed in open water: = faster, - slower (1x to 4x).
    if (e.key === '=' || e.key === '+') wantedSpeed = Math.min(4, wantedSpeed * 2);
    if (e.key === '-') wantedSpeed = Math.max(1, wantedSpeed / 2);
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
  let stripChanged = 0;
  // Said on the port screen when men desert as she makes port; cleared when she sails.
  let portNotice: PortNotice | undefined;
  // The fleet as she last sailed: a ship not in it on making port is a prize brought in, and the harbour says where
  // she is dealt with.
  let fleetSailed = new Set(fleetOf(sim.state).map((f) => f.id));
  /** What a refused order in port means, in words (the rest say so on their own button). */
  const REFUSED: Record<string, string> = {
    'not-enough-gold': 'Not enough gold for that.',
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
    audio: { levels: () => audio.levels() },
    wildlife: sea3d.wildlife,
    ports: () => settlements.map(({ id, name, x, y }) => ({ id, name, x, y })),
    snapshot: { save: () => toSave(sim.state, seed, fingerprint, Date.now()) },
    view: () => (fight ? 'battle' : renderer.harbour.visible ? 'harbour' : 'sea'),
    battle: {
      active: () => Boolean(fight),
      state: () => (fight ? structuredClone(fight.battle.state) : undefined),
      /** Step the battle (it also runs in real time); `autopilot` lets the player's side fight itself. */
      step: (ticks = 1, autopilot?: 'runner' | 'cautious' | 'aggressive') => fight?.battle.step(ticks, autopilot),
      result: () => fight?.battle.result(),
    },
  };
  const player = () => sim.state.ships[def.start.shipId]!;
  // The keys steer the battle while one is on, the world otherwise; the debug wind keys only at sea.
  bindInput(
    () => {
      const b = fight && !fight.battle.result() ? fight.battle : undefined;
      // The battle takes steering and sails; wind is fixed for the fight.
      return b ? { state: b.state, send: (c) => c.type !== 'SetWind' && b.send(c) } : sim;
    },
    def.start.shipId,
    () => windAt(sim.state, player().x, player().y),
    () => !fight,
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
  /** An AI ship at sea under a tile (within a tile and a half), nearest first. */
  const shipAt = (x: number, y: number) =>
    Object.values(sim.state.ships)
      .filter((s) => s.ai && !inPort(s) && Math.hypot(s.x - x, s.y - y) <= 1.5)
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
  // A goal just done (careerGoals), said a while; the goals already done when the career was loaded say nothing.
  let goalNote: (Toast & { until: number }) | undefined;
  let goalsDone: Set<string> | undefined;
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
  const timeScale = (inStorm: boolean): { scale: number; held?: string } => {
    const ship = player();
    // Only close in: cruising carries on along a coast, and holds for the last few tiles before land or a port.
    const nearLand =
      breezes.coastTiles(ship.x, ship.y) <= HOLD_COAST_TILES || settlements.some((s) => Math.hypot(s.x - ship.x, s.y - ship.y) <= HOLD_PORT_TILES);
    if (ship.docked || wantedSpeed <= 1) return { scale: 1 };
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
  const frame = (now: number) => {
    const elapsed = (now - last) / 1000;
    acc = loop.paused ? 0 : Math.min(acc + elapsed * speedNow, 0.25 * speedNow);
    last = now;
    if (fight) {
      // The battle runs in real time (no acceleration) while the world waits.
      if (!loop.paused && !fight.battle.result()) {
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
            // The ship nearest the smoke fired: her broadside is half her guns.
            const shooter = Math.hypot(e.x - me.x, e.y - me.y) < Math.hypot(e.x - bs.ships.enemy.x, e.y - bs.ships.enemy.y) ? me : bs.ships.enemy;
            audio.battle.broadside(Math.floor(shooter.guns / 2), pan, gain);
          } else if (e.kind === 'splash') audio.battle.splash(pan, gain);
          else audio.battle.hit(e.kind === 'sail' ? 'sail' : 'hull', pan, gain);
        }
        fight.heardAt = Math.max(fight.heardAt, ...bs.effects.map((e) => e.at));
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
      // The fight is drawn on the same sea as the map.
      sea3d.canvas.style.display = '';
      sea3d.renderBattle({ ...bs, arcs }, now, fight.nation, fight.famous);
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
                    const whyNot =
                      fleet.length + 2 > content.combat.fleet.maxShips
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
          board={{ odds: fight.battle.boardingOdds(), active: Boolean(bs.boarding) }}
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
    if (player().docked || hailing || charts.open || logOpen || moments.length) {
      // World time stops in port (PRD section 2), while hailing, and while the chart is open; commands
      // still apply at once.
      sim.applyCommands();
      acc = 0;
    }
    while (acc >= dt) {
      sim.step();
      acc -= dt;
      if (player().docked) break;
    }
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
      if (ev.type === 'Promoted') {
        const p = ev.payload as { nation: string; rank: string; acres: number };
        moments.push({ kind: 'promotion', ...p, town: settlements.find((s) => s.id === ev.entityIds[1])?.name ?? '' });
      }
      // A famous pirate in sight for the first time.
      if (ev.type === 'FamousSighted') moments.push({ kind: 'famous', pirateId: ev.payload.pirateId as string });
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
        const port = portInReach();
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
            ? `${name} won't let ${({ england: 'an English', spain: 'a Spanish', france: 'a French', netherlands: 'a Dutch' } as Record<string, string>)[flag]} ship in: ${COUNTRY_NAME[ev.payload.nation as string]} is at war with ${COUNTRY_NAME[flag]}`
            : `${name} won't let you in: you are their enemy`;
        courseNote = { text, kind: 'Port closed', icon: 'ui.icon.anchor', tone: 'warn', until: now + 5000 };
      }
      if (ev.type === 'MenStarved') {
        const n = ev.payload.count as number;
        courseNote = { text: `${n} ${n === 1 ? 'man' : 'men'} died of hunger: make port, or hail a ship (H) and buy food`, kind: 'Starving', icon: 'ui.icon.food', tone: 'warn', until: now + 5000 };
      }
      if (ev.type === 'TradeRefused' && ev.payload.reason === 'plague') {
        const name = settlements.find((s) => s.id === ev.payload.settlementId)?.name ?? 'the port';
        courseNote = { text: `Plague at ${name}: the port is shut to shipping`, kind: 'Port shut', icon: 'ui.icon.anchor', tone: 'warn', until: now + 4000 };
      }
      if (ev.type === 'AssistEnded' && ev.payload.reason === 'aground') {
        // Pressed onto the shore within reach of the port she was bound for: she goes in all the same.
        const port = portInReach();
        if (port && port.id === destination?.id) sim.send({ type: 'Dock', shipId: player().id, settlementId: port.id });
        else courseNote = { text: 'Aground: no way through there. Take the helm', kind: 'Aground', icon: 'ui.icon.hull', tone: 'warn', until: now + 3500 };
      }
      // A fight between other ships within sight: smoke on the water and the thud of distant guns.
      if (ev.type === 'SeaFight') {
        const me = player();
        const x = ev.payload.x as number;
        const y = ev.payload.y as number;
        const d = Math.hypot(x - me.x, y - me.y);
        if (d <= content.traffic.sightTiles) {
          sea3d.seaFight(x, y);
          audio.battle.broadside(6, (x - me.x) / 20, 0.4 / (1 + d / 10));
        }
      }
    }
    eventsSeen = evs.length;
    // Ships hove to fighting within sight (a skirmish): broadsides back and forth until it's settled.
    for (const s of Object.values(sim.state.ships)) {
      const foe = s.ai?.skirmish ? sim.state.ships[s.ai.skirmish.with] : undefined;
      if (!foe) continue;
      const me = player();
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d > content.traffic.sightTiles || loop.paused || now < (nextVolley.get(s.id) ?? 0)) continue;
      // Each side fires every couple of seconds, staggered so the guns answer each other.
      nextVolley.set(s.id, now + VOLLEY_MS * (0.8 + 0.4 * Math.random()));
      sea3d.seaFight(s.x, s.y);
      audio.battle.broadside(4, (s.x - me.x) / 20, 0.4 / (1 + d / 10));
    }
    // In port the harbour scene (2D, illustrated) covers the screen; at sea the 3D view does.
    const atSea = !fight && !renderer.harbour.visible;
    if (!atSea && !fight) renderer.render(sim.state, now);
    sea3d.canvas.style.display = atSea || fight ? '' : 'none';
    if (atSea) sea3d.render(sim.state, now);
    shipLabels.update(sim.state, def.start.shipId, (x, y) => sea3d.project(x, y), atSea);
    charts.update(
      sim.state.ships[def.start.shipId],
      { sightings: sim.state.captain?.sightings ?? {}, tick: sim.state.tick, ticksPerDay: content.calendar.ticksPerDay },
      guide,
    );
    charts.rings(
      content.pirates.captains.flatMap((c) => {
        const hoard = sim.state.famous?.[c.id]?.hoard;
        const held = sim.state.captain?.mapPieces?.[c.id] ?? 0;
        return hoard && held && !hoard.found ? [{ ...hoardRing(content, hoard, held), label: `${c.name}'s hoard: ${held} of ${content.pirates.rules.mapPieces} pieces` }] : [];
      }),
    );
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
      if (!inSight.has(s.id)) sailHo = { id: s.id, until: now + SAIL_HO_MS };
    }
    inSight.clear();
    for (const id of seen) inSight.add(id);
    const intercepting = ship.assist?.mode === 'intercept' && ship.assist.targetId ? sim.state.ships[ship.assist.targetId] : undefined;
    // A pirate fallen on a merchant within sight: the player can sail in and take a hand.
    const raider = Object.values(sim.state.ships).find(
      (s) => s.ai?.role === 'pirate' && s.ai.skirmish && Math.hypot(s.x - ship.x, s.y - ship.y) <= content.traffic.sightTiles,
    );
    const raided = raider?.ai?.skirmish ? sim.state.ships[raider.ai.skirmish.with] : undefined;
    // The crew's needs, when they press: food running out, or a grumbling crew.
    const days = foodDays(content, ship);
    const mood = moraleOf(content, sim.state);
    const left = Math.floor(days);
    const crewWarning: Toast | undefined = ship.docked
      ? undefined
      : days < 1
        ? { text: 'The food is gone: the crew is starving. Make port, or hail a passing ship (H) and buy food from her', kind: 'Warning: hunger', icon: 'ui.icon.food', tone: 'warn' }
        : days <= 3
          ? { text: `Food for ${left === 1 ? 'one more day' : `${left} days`}: buy food in port, or from a passing ship (H)`, kind: 'Warning: hunger', icon: 'ui.icon.food', tone: 'warn' }
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
    const reach = ship.docked ? undefined : portInReach();
    const near = reach || hailing ? undefined : shipInHail();
    // A hunter closing on the player: a warning beats any other prompt.
    const hunter = Object.values(sim.state.ships).find((s) => s.ai?.chasing);
    const treasure = reach || hailing ? undefined : digHere();
    const spoken = hailing && sim.state.ships[hailing.targetId];
    render(
      spoken ? (
        <Hail
          state={sim.state}
          content={content}
          settlements={settlements}
          ship={spoken}
          news={hailing!.news}
          close={() => (hailing = undefined)}
          lawful={spoken.ai ? legalTarget(content, sim.state, sim.state.captain, spoken.ai.nation) : undefined}
          buyFood={(units) => {
            sim.send({ type: 'BuyProvisions', shipId: player().id, targetId: hailing!.targetId, units });
            sim.applyCommands();
          }}
          room={Math.max(0, fleetHold(content, sim.state, player()) - cargoUsed(player()))}
          attack={() => {
            sim.send({ type: 'Attack', shipId: player().id, targetId: hailing!.targetId });
            sim.applyCommands();
            hailing = undefined;
          }}
        />
      ) : null,
      hailRoot,
    );
    // The career's goals: done ones are noticed the moment they are (the HUD says so), the rest wait in the log.
    const goals = careerGoals(content, sim.state, settlements);
    const doneNow = new Set(goals.filter((g) => g.done).map((g) => g.id));
    const fresh = goalsDone ? goals.find((g) => g.done && !goalsDone!.has(g.id)) : undefined;
    if (fresh) {
      const next = goals.find((g) => !g.done);
      goalNote = { text: `Goal done: ${fresh.title}!${next ? ` Next: ${next.title} (L)` : ''}`, kind: 'Goal done', icon: 'ui.icon.cannon_loaded', tone: 'gold', until: now + 7000 };
    }
    goalsDone = doneNow;
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
          goals={goals}
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
    sea3d.guide(destination && !ship.docked ? guide : undefined);
    let course: { name: string; distanceKm: number; bearingDeg: number; following: boolean } | undefined;
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
      course = { name: destination.name, distanceKm: tiles * kmPerTile, bearingDeg, following };
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
              : reach
              ? `Enter ${reach.name} · E`
              : near
                ? `Hail the ${shipTitle(near)} ${near.ai!.name} · H`
                : treasure
                  ? `${treasure}'s hoard could lie on this coast: go ashore and dig · G`
                : raider && raided?.ai
                  ? raided.ai.role === 'patrol'
                    ? `Gunfire to the ${pointOfCompass(ship, raider)}! The ${shipTitle(raided)} ${raided.ai.name} has caught the pirate ${raider.ai!.name}`
                    : `Gunfire to the ${pointOfCompass(ship, raider)}! The pirate ${raider.ai!.name} has fallen on the ${shipTitle(raided)} ${raided.ai.name} · sail in and H to take a hand`
                  : intercepting?.ai
                      ? `Intercepting the ${intercepting.ai.name} · I to stop`
                      : ship.assist?.mode === 'course'
                        ? `Sailing to ${ship.assist.portId ? (settlements.find((s) => s.id === ship.assist!.portId)?.name ?? 'port') : 'the mark'} · steer to take the helm`
                        : undefined
        }
        hour={hour}
        held={cruise.held}
        saved={now - savedAt < 2000}
        banner={(() => {
          const her = sailHo && now < sailHo.until ? sim.state.ships[sailHo.id] : undefined;
          if (!her?.ai) return undefined;
          const who = her.ai.famous ? `${her.ai.name} himself, in a ${shipKind(her.classId)},` : `A ${shipTitle(her)}`;
          return { text: `${who} ${fromTheBow(ship, her)}`, hail: near?.id === her.id };
        })()}
        toasts={[...[goalNote, digNote, courseNote].flatMap((n) => (n && now < n.until ? [n] : [])), ...(crewWarning ? [crewWarning] : [])]}
        goal={(() => {
          const g = goals.find((x) => !x.done);
          return g && { title: g.title, have: g.have, of: g.of, unit: g.unit };
        })()}
        strip={strip}
        faded={now - stripChanged > STRIP_REST_MS}
        setSails={(sails) => sim.send({ type: 'SetSails', shipId: ship.id, sails })}
        cruise={{ speed: wantedSpeed, choose: (n) => (wantedSpeed = n) }}
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
