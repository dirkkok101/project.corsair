import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { inPort } from '@corsair/core';
import type { Ship, Wind, WorldState } from '@corsair/core';
import { hourOf, isLand, shipStats, tickAtHour, tileAt, viewTiles } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import type { BattleViewState } from './battleView';

export type { BattleViewPlace, BattleViewShip, BattleViewState } from './battleView';
export { renderShipCard } from './card';
import { sailAnim } from './sails';
import { normalizeDeg } from '@corsair/systems-navigation';
import { CLOUD_SPEED, createOcean } from './sea/ocean';
import { HAZE_AROUND, installHaze } from './haze';
import type { SeaState, WakeShip } from './sea/ocean';
import { RIGS } from './rigs';
import { buildShip, flagTexture, makeFlag, prepareKits, SAIL_GLOW, WINDOW_GLOW } from './shipyard';
import { drawFlagIcon } from './flags';
import type { BuiltShip, FlagDesign, ShipPlan } from './shipyard';
import { createBattleFx, fallSide, MAST_FALL_SECONDS } from './battle';
import { createShake, drawShaken } from './shake';
import { createStorm } from './storm';
import type { SprayShip } from './storm';
import type { BattleHull } from './battle';
import { createLandmarks } from './landmarks';
import { createWildlife } from './wildlife';
import type { WildlifeKind, WildlifeSound } from './wildlife';
import { createTowns, TOWN_GLOW, TOWN_RADIUS } from './towns';
import { createGround } from './terrain';
import { createSky } from './sky';
import { createSeaNames } from './seanames';
import { createConsorts } from './consorts';

// The 3D sea map (art direction: Sid Meier's Pirates! 2004, in HD): the world in map tiles, x east and z south,
// y up; the camera follows the player's ship and zooms from her deck to the whole region (the mouse wheel),
// overhead by default or from astern (C). Only drawing: the simulation, input and UI are the game's.

/**
 * Ships are drawn larger than the map's own proportion (Pirates! 2004 draws a ship nearly the size of a small
 * island): this many times her 2D sprite's size. Drawing only; the world and its distances are unchanged.
 */
const SHIP_SCALE = 1.6;
/** One model unit in tiles: a ship as big as her 2D sprite (96 px over 3.7 units, 24 px a tile), times SHIP_SCALE. */
const MODEL_SCALE = (96 / 3.7 / 24) * SHIP_SCALE;
/** Camera distance from the ship, in tiles: from close aboard to the whole region. */
const ZOOM = { min: 9, max: 630, start: 32 };
/** Tiles round the camera's target within which land gets the sun's shadows (the shadow box is 30 either way). */
const SHADOW_REACH = 42;
/** The view's top corners (NDC x), and how far along a ray toward the sea it must meet it for the sky to be hidden. */
const SKY_CORNERS = [-1, 1];
const SKY_SEA_REACH = 1800;
/**
 * The 3D view's resolution, in device pixels per CSS pixel (the HUD is HTML and stays sharp whatever this is): the
 * screen's own (up to 2 on a Retina screen) on a machine that keeps up, stepping down by `step` toward `min` while
 * frames run slower than `slowMs` (smoothed) for `slowSeconds`, and back up after `fastSeconds` under `fastMs`,
 * never again to a step that proved slow. The first `warmSeconds` of frames (shaders compiling, textures loading)
 * don't count.
 */
const RENDER_SCALE = { min: 1, step: 0.25, slowMs: 22, slowSeconds: 2, fastMs: 17.5, fastSeconds: 8, warmSeconds: 5 };
/** The chase camera holds its heading while hers stays within this of it, so small helm corrections don't swing it. */
const CHASE_SLACK_DEG = 20;
/** Past the slack it catches up over about this (s); on a steady course it settles back astern over this. */
const CHASE_CATCH_S = 0.35;
const CHASE_SETTLE_S = 3;
/** It rises to keep this much (tiles) above the land between it and her, trees and roofs included: fast, and settles slowly; never steeper than this. */
const CHASE_CLEAR = 3.5;
const CHASE_RISE_S = 0.25;
const CHASE_FALL_S = 1.5;
const CHASE_MAX_PITCH = (62 * Math.PI) / 180;
/**
 * The chase camera's pitch (degrees) at the closest zoom, and how much it steepens out to the furthest: low, so
 * the horizon and the sky stand over her (at the default zoom about 18 degrees).
 */
const CHASE_PITCH = { min: 9, span: 30 };
/**
 * The overhead camera's pitch (degrees) at the closest zoom, and how much it steepens out to the furthest: looking
 * down as Pirates! does (about 50 degrees at the default zoom, near straight down far out), so the sea map never
 * shows the horizon and everything in frame is near.
 */
const MAP_PITCH = { min: 38, span: 44 };
/** The chase camera looks this share of its distance ahead of her, so she sits low in the frame and the sea ahead shows. */
const CHASE_AHEAD = 0.3;
/** Clouds show from this camera distance out, fully by the second (close in, they'd smear across the view). */
const CLOUDS_FROM = [70, 160];
/**
 * At sea the haze lies on the horizon, as in battle: past the camera's target by her view (viewTiles in @corsair/data,
 * by the weather and the hour), clear to this share of it and all haze at its end, so the open sea reads far out and
 * a sail comes up over the horizon out of it. Ships are drawn as far as that. Zoomed out it moves out with the camera,
 * and overhead (looking down, never at the horizon) it lifts (HAZE_RING: all of it to MARKS_FROM, none by `to`), so
 * the map reads clearly.
 */
const HAZE_CLEAR = 0.5;
/** From astern, looking along the sea to the horizon, the haze holds off longer: clear to this share of her view. */
const HAZE_CLEAR_CHASE = 0.8;
const HAZE_RING = { to: 140, least: 0 };
/**
 * In battle the haze is by depth from the camera: clear to the far edge of the fight, then thickening over this many
 * tiles (narrower under cloud).
 */
const HAZE_BAND = 150;
/** Zoomed out this far (camera distance in tiles) the map shows through the haze, and ships out of sight leave a mark where last seen. */
const MARKS_FROM = 60;
/** A ship new to the sea within sight (a debug spawn, a fleet ship rejoining) comes up over this many seconds. */
const RISE_SECONDS = 2;
/** A ship gone from the sea within sight (sunk or taken) settles by the stern and goes down over this many seconds. */
const GHOST_SECONDS = 5;
/** A last-seen mark fades over this many days. */
const MARK_DAYS = 1;
/** Town names show within this many tiles of the camera's target. */
const NAMES_WITHIN = 240;
/** Far out, ships grow so they stay readable (as Pirates! draws them), up to this many times life. */
const FAR_SHIP_SCALE = 4;
/** A ship's length in tiles at model scale (the brig's hull, 2.4 model units). */
const SHIP_LENGTH = 2.4 * MODEL_SCALE;
/** Ships in company sail this many ship's lengths apart, in line astern. */
const CONSORT_SPACING = 1.7;
/** How fast a ship eases into the swell's pitch and roll (per second): slow, so she rocks rather than bounces. */
const RIDE_EASE = 1.1;
/** A fast ship's speed in speed points, for how hard a ship heels in a turn. */
const FAST_SHIP = 7;
/** The speed in speed points at which the water round a ship is at its whitest (an ordinary good pace). */
const BRISK = 4.5;
/** The battle camera's distance in tiles: no nearer or further than this, whatever the zoom. */
const BATTLE_VIEW = { min: 6, max: 90 };
/**
 * The battle camera's pitch (degrees) at its nearest, and how much it steepens out to its furthest: low and astern of
 * her, so port is left and starboard right whichever way she heads, and the sea and the enemy stand up in the frame.
 */
const BATTLE_PITCH = { min: 30, span: 18 };
/** The wheel in battle scales the framing, no closer or further than this (a zoom of its own: the sea's stays the sea's). */
const BATTLE_ZOOM = { min: 0.5, max: 3 };
/**
 * In battle the camera frames the fight, as Pirates! does (the ships as big in the frame as keeps both in it): it
 * eases in or out until the further of the two lies this far from the middle of the screen (1 is the edge), as
 * the projection measures it (an oblique view shows the near sea larger than the far, so no rule of thumb fits).
 */
const BATTLE_FIT = 0.68;
/** Her own ship, nearest the camera and so drawn largest, is kept this far in (her hull and rigging stand well out
 * from her middle). */
const BATTLE_FIT_OWN = 0.5;
/**
 * How hard each thing in a fight shakes the camera (shake.ts trauma, 0..1; the camera turns by its square): her own
 * broadside a kick, a ball through her side a jolt, a mast by the board or a magazine going up a blow. The same blow
 * to the enemy shakes less: the camera stands with the player. Her broadside is fainter the further off she fires.
 */
const SHAKE = { broadside: 0.4, theirBroadside: 0.3, hull: 0.45, rigging: 0.25, mast: 0.7, explosion: 0.9, enemyShare: 0.45 };
/**
 * In battle ships are drawn at their true size (MODEL_SCALE without the map's enlargement) times the fight's own
 * scale (combat.json battle.shipScale), which the battle aims and strikes by too: big in the frame, a length or
 * two apart at a broadside, as in Pirates!.
 */
const BATTLE_MODEL_SCALE = MODEL_SCALE / SHIP_SCALE;
/**
 * A ship heels outward as she turns (Pirates! 2004: her masts lean well over in a hard turn and come upright as
 * she steadies): this many radians at full speed in a turn this fast (degrees a second) or faster, easing in
 * over about half a second.
 */
const TURN_HEEL = 0.28;
const TURN_FULL_DEG = 30;
const TURN_EASE = 2.5;
/** A sunk ship takes this long to go under. */
const SINK_SECONDS = 6;

/** What shows of her fit: the shipwright's upgrades, and her class's own oars and swivels. */
function fitOfClass(content: ContentPack, s: { classId: string; upgrades?: string[] }): string[] {
  const cls = content.ships[s.classId];
  return [...(s.upgrades ?? []), ...(cls?.oars ? ['sweeps'] : []), ...(cls?.swivels ? ['swivel_guns'] : [])];
}

const DAY_SUN = new THREE.Color('#fff4d6');
const GOLD_SUN = new THREE.Color('#ffa860');
const MOON = new THREE.Color('#8aa4ff');
const DAY_SKY = new THREE.Color('#9fd3f0');
/**
 * The haze's colour, as the sky's times this: the far sea (blue-grey, darker than the sky over it), not the sky.
 * Hazed into the sky's own colour, the sea turned to sky at the haze's end, a curved false horizon short of the
 * real one (a disc of sea in fog, from astern); hazed into far-sea, it runs on to meet the sky in a crisp line.
 */
const FAR_SEA = new THREE.Color(0.28, 0.42, 0.56);
const GOLD_SKY = new THREE.Color('#f2a679');
const NIGHT_SKY = new THREE.Color('#2c4670');
const DAY_ZENITH = new THREE.Color('#2f7fcf');
const GOLD_ZENITH = new THREE.Color('#5568a8');
const NIGHT_ZENITH = new THREE.Color('#0d1a33');
// Overcast and storm (Black Flag: a lid of grey cloud, flat grey-green light, the horizon closing in).
const STORM_HORIZON = new THREE.Color('#6f7a80');
const STORM_ZENITH = new THREE.Color('#3b434b');
const STORM_SUN = new THREE.Color('#c9d0d4');
/**
 * How overcast the weather makes it, 0 clear .. 1 a storm: by the wind's strength where the camera is, and
 * deepest inside a storm (and closing in as one nears, from half again its radius).
 */
const GLOOM_BY_WIND: Record<string, number> = { calm: 0, light: 0, fresh: 0.12, strong: 0.4, gale: 0.7 };
/** How fast the sky clouds over or clears, per second: a squall rolls in over some seconds, not in a frame. */
const GLOOM_EASE = 0.35;
const PENNANT: Record<string, string> = { spain: '#e8c170', england: '#a53030', france: '#ebede9', netherlands: '#de9e41', pirate: '#090a14' };

export interface SeaRenderer {
  canvas: HTMLCanvasElement;
  /** Called at each lightning strike, with the thunder's delay (seconds, longer the further off it struck). */
  onLightning(cb: (delayS: number) => void): void;
  /** Draws the sea map for this state; `nowMs` is the frame time (the sky keeps its own slow day). */
  render(state: WorldState, nowMs: number): void;
  /** Draws the sea battle (on the same sea: its positions are world tiles); `enemyNation` flies her colours. */
  renderBattle(view: BattleViewState, nowMs: number, enemyNation?: string, enemyFamous?: string): void;
  /** CSS size of the view; the canvas renders at the device's pixel ratio. */
  resize(width: number, height: number): void;
  /** The resolution the 3D view is drawn at now, in device pixels per CSS pixel (it adapts to the machine). */
  renderScale(): number;
  /** Zoom by wheel steps (positive out): the sea's, or in battle the battle's own. */
  zoom(steps: number): void;
  /** Overhead or from astern. */
  toggleChase(): void;
  /** Which way is up the screen (degrees clockwise from north): 0 overhead, her heading from astern and in battle. */
  viewDeg(): number;
  /** The player's camera shake in battle: 1 the full shake, 0 none. */
  setShake(scale: number): void;
  /** Debug: how much the battle camera is shaking now (trauma, 0..1). */
  readonly shaking: number;
  /** Debug: the ship labels showing now, by what they say. */
  readonly shipLabels: string[];
  /** For tests: each ship drawn on the sea now (her own, and those in a flagship's company as `flagship~ship`), where, in tiles. */
  readonly shipsDrawn: { id: string; x: number; y: number }[];
  /** Shifts the sky to an hour of the day (for reviewing sunrise, sunset and night); the game's clock is untouched. */
  setSkyHour(hour: number): void;
  /**
   * The point on the sea under a spot on the canvas (CSS pixels from its top left), in the tiles the last frame drew
   * (world tiles at sea and in battle alike); undefined above the horizon.
   */
  pick(px: number, py: number): { x: number; y: number } | undefined;
  /** Where a point on the sea (tiles) lies on the canvas, in CSS pixels; undefined behind the camera. */
  project(x: number, y: number): { px: number; py: number } | undefined;
  /** Debug: start a sea-life event now, by the player's ship, and count the animals out. */
  wildlife: { spawn(kind: WildlifeKind): void; readonly count: number };
  /** Two other ships firing on each other at (x, y) tiles: a bank of gun smoke there, drifting and thinning. */
  seaFight(x: number, y: number): void;
  /** A wreck burning at (x, y) tiles: a column of dark smoke rising there, seen from afar, until cleared (undefined). */
  beacon(at: { x: number; y: number } | undefined): void;
  /** The plotted route to the destination (waypoints after the ship, tiles), drawn on the sea until cleared. */
  guide(points: [number, number][] | undefined): void;
  /** For review: a row of these classes under sail, abeam of the player, drawn only (not in the world). */
  showcase(classIds: string[], state: WorldState): void;
}

export async function createSeaRenderer(
  content: ContentPack,
  map: TileMap,
  options: {
    playerId: string;
    settlements: PlacedSettlement[];
    windAt: (state: WorldState, x: number, y: number) => Wind;
    /** The wind the sea runs with, if not the local one (the game's leaves out the coastal breezes' daily turn). */
    seaWindAt?: (state: WorldState, x: number, y: number) => Wind;
    /** A town's line under its name ("Prosperous English Capital"), from the game's state. */
    townLine?: (s: PlacedSettlement, state: WorldState) => string;
    /** What a ship in sight is ("Pirate sloop"), shown over her (none where it returns undefined); omit for no labels. */
    shipLabel?: (s: Ship, player: Ship) => string | undefined;
    /**
     * For review, what to draw on the sea (`?sea=`): "plain" alone is the bare water; add layers by name to
     * bring them back (flecks, shadows, ripples, surf, swell, clouds, wakes). Unset, everything.
     */
    sea?: string[];
    /** Sea life's sounds (dolphins, gulls, a whale blowing); omit for silence. */
    sound?: WildlifeSound;
  },
): Promise<SeaRenderer> {
  prepareKits(Object.values(RIGS));
  // No multisampling on the canvas itself: the scene is drawn into the composer's own (multisampled) target, and
  // the canvas only ever receives the finished image.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // ?quality=high holds the screen's own resolution (up to 2), ?quality=low holds 1; otherwise it adapts down from
  // the screen's own.
  const quality = new URLSearchParams(location.search).get('quality');
  const screenScale = Math.min(2, devicePixelRatio);
  const ceiling = quality === 'low' ? 1 : screenScale;
  let renderScale = ceiling;
  renderer.setPixelRatio(renderScale);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  // Drawn only while land lies within the sun's shadow box (finishFrame).
  renderer.shadowMap.autoUpdate = false;
  // (Soft PCF is gone from three: it fell back to this with a warning.)
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'sea3d';

  installHaze();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  // One haze on everything (land, towns, ships; the sea's shader follows the same rule), in the sky's horizon colour.
  const haze = new THREE.Fog(new THREE.Color(), 0, 1);
  scene.fog = haze;
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 4000);
  // Mouse picks: a ray from the camera onto the sea's mean level.
  const pickRay = new THREE.Raycaster();
  const SEA_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // The finished image: soft bloom on sun, sails and foam (Pirates!'s glow), anti-aliased, tone-mapped last. (4x
  // multisampling of the half-float scene target measured dearer than SMAA's passes on a Mac.)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.22, 0.45, 0.94);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());

  // Sky and light: a clear Caribbean sky, the sun (with a shadow near the player), a soft fill from the sky.
  const sky = createSky();
  scene.add(sky.mesh);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  sc.near = 1;
  sc.far = 400;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight('#bfe3ff', '#2f6f6a', 0.9);
  scene.add(fill);

  const ground = createGround(map, options.settlements.map((s) => ({ x: s.x, y: s.y, r: TOWN_RADIUS[s.size] ?? 3.5 })));
  scene.add(ground.object);
  const shown = (layer: string) => !options.sea?.includes('plain') || options.sea.includes(layer);
  const ocean = createOcean(ground.depth, map.width, map.height, shown);
  scene.add(ocean.mesh);

  // Towns: houses in the nation's style up from the shore, a church, a fort with its flag, a pier; the name over it.
  const names: { sprite: THREE.Sprite; x: number; y: number; s: PlacedSettlement; banner: Banner; inRange: boolean; shown: number }[] = [];
  const towns = createTowns(options.settlements, ground.heightAt, makeFlag, (s) => {
    const banner = createBanner(s.name ?? s.id, s.nation);
    names.push({ sprite: banner.sprite, x: s.x, y: s.y, s, banner, inRange: false, shown: 0 });
    return banner.sprite;
  });
  let bannersAt = -Infinity;
  scene.add(towns.object);
  // Each ship in sight carries a label saying what she is (her flag and "Pirate sloop"), over her masts.
  const shipLabels = new Map<string, { banner: Banner; text: string; x: number; y: number; inRange: boolean; shown: number }>();
  const labelLayer = new THREE.Group();
  scene.add(labelLayer);
  // The seas, passages and banks named on the water.
  const seaNames = createSeaNames(content.maps.caribbean, content.seaNames);
  scene.add(seaNames.object);
  // The treasure maps' landmarks on their coasts (and a dug pit once a hoard is found).
  const landmarks = createLandmarks(ground.heightAt);
  scene.add(landmarks.object);

  // Clouds: soft white puffs drifting downwind (Pirates!: white clouds are wind, dark ones a storm), going into the
  // haze toward the horizon with the sea under them.
  const puff = puffTexture();
  const cloudMat = new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, opacity: 0.85 });
  const clouds: THREE.Sprite[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 520; i++) {
    const c = new THREE.Sprite(cloudMat);
    const s = 10 + rand() * 18;
    c.scale.set(s * 1.6, s, 1);
    c.position.set(rand() * map.width, 50 + rand() * 14, rand() * map.height);
    clouds.push(c);
    scene.add(c);
  }

  const worldShips = new THREE.Group();
  scene.add(worldShips);
  // The course to the destination: a gold line on the water from her bow along the route, over the waves.
  // A fat line (pixels wide at any zoom, which plain WebGL lines can't be), drawn over the waves.
  const guideMaterial = new LineMaterial({ color: '#e8c170', linewidth: 1.5, dashed: true, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.9, depthTest: false });
  const guideLine = new Line2(new LineGeometry(), guideMaterial);
  guideLine.renderOrder = 10;
  guideLine.frustumCulled = false;
  scene.add(guideLine);
  let guidePoints: [number, number][] | undefined;
  /** A famous pirate's own flag (pirates.json), by her id. */
  const famousFlag = (id?: string) => (id ? content.pirates.captains.find((c) => c.id === id)?.flag : undefined);
  // Gun smoke where other ships fight within sight: puffs that swell, rise and thin over SMOKE_SECONDS.
  const SMOKE_SECONDS = 5;
  const smokeLayer = new THREE.Group();
  scene.add(smokeLayer);
  // Sea life about her: dolphins, flying fish, a whale, gulls near land.
  const wildlife = createWildlife(ground.heightAt, options.sound ?? (() => {}));
  scene.add(wildlife.object);
  const smokes: { sprite: THREE.Sprite; at: number; size: number; drift: number; column?: boolean }[] = [];
  let smokeClock = 0;
  // A wreck's smoke: a puff every BEACON_EVERY seconds, rising high as it thins.
  const BEACON_EVERY = 0.3;
  let beacon: { x: number; y: number } | undefined;
  let beaconDue = 0;
  const ships = new Map<string, { root: THREE.Object3D; setSails(anim: string): void; setCrew(share: number): void; built: BuiltShip; holes: number; classId: string }>();
  /** The ships in company with each flagship, kept in line astern on her track (consorts.ts). */
  const consorts = createConsorts();
  // Fog of war: how much of each ship showed last frame; ships new to the sea in sight, by when they
  // came; ships gone from it in sight, going down; and frames drawn at sea since the view (re)started, as on the first
  // frame, or back from a battle, nothing is new or gone.
  const shownLast = new Map<string, number>();
  const born = new Map<string, number>();
  let knownIds = new Set<string>();
  const ghosts: { root: THREE.Object3D; at: number; len: number }[] = [];
  let seaFrames = 0;
  // Last-seen marks, by ship id.
  const marks = new Map<string, THREE.Sprite>();
  const markLayer = new THREE.Group();
  scene.add(markLayer);
  const shipFor = (s: Ship) => {
    let m = ships.get(s.id);
    if (m && m.classId !== s.classId) {
      worldShips.remove(m.root);
      m = undefined;
    }
    if (!m) {
      // Built in code from her class's plan (cloth sails, her nation's colours).
      // A famous pirate flies her own flag.
      const built = buildShip(RIGS[s.classId] ?? RIGS['ship.brig']!, s.ai?.nation ?? 'player', famousFlag(s.ai?.famous));
      m = {
        root: built.root,
        setSails: (anim: string) => built.setSails(...sailsOf(anim), lastMs),
        setCrew: (share: number) => built.setCrew(share, lastMs),
        built,
        holes: 0,
        classId: s.classId,
      };
      ships.set(s.id, m);
      worldShips.add(m.root);
    }
    return m;
  };

  let distance = ZOOM.start;
  // The battle's wheel: a share of the framing, kept from one fight to the next.
  let battleZoom = 1;
  let chase = false;
  /** The heading the camera from astern looks along (the player's, at sea or in battle). */
  let viewHeading = 0;
  // The chase camera's own heading and lift: it follows her lazily, and rises over land between it and her.
  let camYaw: number | undefined;
  let camLift = 0;
  /**
   * The chase camera's heading: held while hers stays within CHASE_SLACK_DEG of it (a helm's small corrections
   * don't swing the view); past that, turned just enough to bring her back to the edge, smoothly; and on a steady
   * course drifting back to dead astern.
   */
  const chaseYaw = (heading: number, dt: number) => {
    if (camYaw === undefined) camYaw = heading;
    const diff = ((heading - camYaw + 540) % 360) - 180;
    const beyond = Math.abs(diff) - CHASE_SLACK_DEG;
    camYaw += beyond > 0 ? Math.sign(diff) * beyond * Math.min(1, dt / CHASE_CATCH_S) : diff * Math.min(1, dt / CHASE_SETTLE_S);
    camYaw = (camYaw + 360) % 360;
    return camYaw;
  };
  /**
   * The pitch that keeps the line from her to the camera clear of the land behind her by CHASE_CLEAR tiles, eased
   * up fast and down slowly so a passing headland doesn't set it bobbing.
   */
  const chasePitch = (pitch: number, view: number, yawDeg: number, dt: number) => {
    const back = (yawDeg * Math.PI) / 180;
    // Astern of her along the boom: her heading's opposite.
    const [bx, bz] = [-Math.sin(back), Math.cos(back)];
    let need = pitch;
    const reach = view * Math.cos(pitch);
    for (let d = 1; d <= reach + 3; d += 1) {
      const h = Math.max(0, ground.heightAt(target.x + bx * d, target.z + bz * d));
      if (h > 0) need = Math.max(need, Math.atan2(h + CHASE_CLEAR - 0.6, d));
    }
    const lift = Math.min(CHASE_MAX_PITCH, need) - pitch;
    camLift += (lift - camLift) * Math.min(1, dt / (lift > camLift ? CHASE_RISE_S : CHASE_FALL_S));
    return pitch + Math.max(0, camLift);
  };
  const target = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const zenith = new THREE.Color();
  /** The sky dome's colour at the horizon (paler than the far sea below it). */
  const skyLine = new THREE.Color();
  const light = {
    sunDir,
    sun: new THREE.Color(),
    power: 2,
    sky: new THREE.Color(),
    zenith,
    ambient: new THREE.Color(),
    level: 1,
    overcast: 0,
    fog: new THREE.Color(),
    fogNear: 0,
    fogFar: 1,
  };
  const strengthOf = (w: Wind) => content.navigation.windStrength[w.strength] ?? 0.8;
  let lastMs = 0;
  const skyRay = new THREE.Vector3();
  /** Land within `r` tiles of (x, z), sampled every few tiles; remembered while she stays on the same tile. */
  let landSeen = { key: '', near: false };
  const landWithin = (x: number, z: number, r: number) => {
    const key = `${Math.round(x)},${Math.round(z)}`;
    if (key === landSeen.key) return landSeen.near;
    let near = false;
    for (let dz = -r; dz <= r && !near; dz += 3) for (let dx = -r; dx <= r && !near; dx += 3) near = isLand(tileAt(map, x + dx, z + dz));
    landSeen = { key, near };
    return near;
  };
  // The view's CSS size, and the resolution it is drawn at (RENDER_SCALE).
  const cssSize = { width: 1, height: 1 };
  const applySize = () => {
    renderer.setPixelRatio(renderScale);
    renderer.setSize(cssSize.width, cssSize.height);
    composer.setPixelRatio(renderScale);
    composer.setSize(cssSize.width, cssSize.height);
  };
  let frameMs = 1000 / 60;
  let slowFor = 0;
  let fastFor = 0;
  let provedSlow = Infinity;
  let warmFor = 0;
  /** Draw at the finest resolution the machine keeps up with (RENDER_SCALE), unless ?quality holds it. */
  const adaptScale = (dt: number) => {
    if (quality || dt <= 0) return;
    // Not while the first frames are still compiling shaders and loading textures: they'd prove any scale slow.
    warmFor += dt;
    if (warmFor < RENDER_SCALE.warmSeconds) return;
    frameMs += (dt * 1000 - frameMs) * 0.1;
    slowFor = frameMs > RENDER_SCALE.slowMs ? slowFor + dt : 0;
    fastFor = frameMs < RENDER_SCALE.fastMs ? fastFor + dt : 0;
    let next = renderScale;
    if (slowFor > RENDER_SCALE.slowSeconds && renderScale > RENDER_SCALE.min) {
      provedSlow = renderScale;
      next = Math.max(RENDER_SCALE.min, renderScale - RENDER_SCALE.step);
    } else if (fastFor > RENDER_SCALE.fastSeconds && renderScale + RENDER_SCALE.step < Math.min(provedSlow, ceiling + 1e-6)) {
      next = renderScale + RENDER_SCALE.step;
    }
    if (next === renderScale) return;
    renderScale = next;
    slowFor = fastFor = 0;
    applySize();
  };
  /** The game's tick, for the time of day (calendar.json daylight), held through a battle; and ?sky='s shift of it. */
  let skyTick = 0;
  let skyShift = 0;
  let skyWant: number | undefined;
  /** The weather's overcast, eased toward `gloomWant`. */
  let gloom = 0;
  let gloomWant = 0;
  let gloomSeen = false;
  // Each ship's ride: her height on the swell and her pitch and roll, eased toward the sea's each frame.
  const rides = new Map<string, { bob: number; pitch: number; roll: number; lean: number; heading: number }>();

  /** The frame's clock and the hour's light: sun, sky, sea and sails blend smoothly by the sun's height. */
  const beginFrame = (nowMs: number, view: number, around?: { x: number; z: number; reach: number }) => {
    const dt = lastMs ? Math.min(0.1, (nowMs - lastMs) / 1000) : 0;
    lastMs = nowMs;
    adaptScale(dt);
    const hour = hourOf(content.calendar, skyTick + skyShift);
    // The weather's overcast, easing in and out (the first frame takes it as it is).
    gloom = gloomSeen ? gloom + (gloomWant - gloom) * (1 - Math.exp(-dt * GLOOM_EASE)) : gloomWant;
    gloomSeen = true;
    const g = THREE.MathUtils.smoothstep(gloom, 0, 1);
    light.overcast = g;
    // The sun's arc from 6 to 18; golden low, moonlit blue at night.
    const e = Math.sin(((hour - 6) / 12) * Math.PI);
    const dayness = THREE.MathUtils.smoothstep(e, 0.05, 0.4);
    const night = 1 - THREE.MathUtils.smoothstep(e, -0.14, 0.02);
    const elevation = Math.max(4, e * 70);
    const azimuth = ((hour - 6) / 12) * 180 + 90;
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    // Bright through the golden hours (a Technicolor sunset, not a dim one); a readable moonlit night.
    const level = THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.smoothstep(e, -0.12, 0.08));
    light.level = level;
    light.sun.copy(GOLD_SUN).lerp(DAY_SUN, dayness).lerp(MOON.clone().multiplyScalar(0.6), night);
    light.sky.copy(GOLD_SKY).lerp(DAY_SKY, dayness).lerp(NIGHT_SKY, night);
    // The dome: deep blue overhead, the horizon in the hour's colour.
    zenith.copy(GOLD_ZENITH).lerp(DAY_ZENITH, dayness).lerp(NIGHT_ZENITH, night);
    // Overcast: the sky greys toward a lid of cloud (darker by night), the sun turns pale and weak behind it.
    const dim = THREE.MathUtils.lerp(0.35, 1, level);
    light.sky.lerp(STORM_HORIZON.clone().multiplyScalar(dim), g * 0.9);
    zenith.lerp(STORM_ZENITH.clone().multiplyScalar(dim), g * 0.9);
    light.sun.lerp(STORM_SUN.clone().multiplyScalar(dim), g * 0.8);
    skyLine.copy(light.sky).lerp(new THREE.Color('#ffffff'), 0.08 * dayness * (1 - g));
    // Under cloud the distance closes in as grey mist again (the sky's colour), not far-off sea.
    light.fog.copy(light.sky).multiply(FAR_SEA).lerp(light.sky, 0.75 * g);
    (scene.background as THREE.Color).copy(light.sky);
    sun.intensity = THREE.MathUtils.lerp(0.9, 2.6, THREE.MathUtils.smoothstep(e, -0.05, 0.12)) * (1 - 0.72 * g);
    sun.color.copy(light.sun);
    // Sails catch the light: a touch of the sky's colour in their glow (lavender and gold at dusk, blue at night).
    SAIL_GLOW.set('#fffaf0').lerp(light.sky, 0.18 + 0.3 * (1 - dayness)).lerp(light.sun, 0.12);
    // Lamps lit in the stern windows as the day goes: dark by day, warm at dusk and by night.
    TOWN_GLOW.set('#ffb35c').multiplyScalar(1.4 * (1 - THREE.MathUtils.smoothstep(e, -0.05, 0.25)));
    WINDOW_GLOW.set('#ffb35c').multiplyScalar(1.6 * (1 - THREE.MathUtils.smoothstep(e, -0.05, 0.25)) + 0.15 * g);
    fill.intensity = (0.55 + level * 0.5) * (1 - 0.25 * g);
    fill.color.copy(light.sky).lerp(new THREE.Color('#ffffff'), 0.4);
    // The water is lit as the scene is: the sun's power, and the sky's light over it.
    light.power = sun.intensity;
    light.ambient.copy(fill.color).multiplyScalar(fill.intensity);
    renderer.toneMappingExposure = (0.7 + level * 0.3) * (1 - 0.12 * g);
    // The horizon closes in under the cloud, and the clouds themselves darken.
    if (around) {
      // Her view (the weather has already closed it in), past the camera's own distance from her.
      light.fogNear = view + around.reach * (chase ? HAZE_CLEAR_CHASE : HAZE_CLEAR);
      light.fogFar = view + around.reach;
      // From astern the camera looks out to the horizon (and past the map's edge, far out): the haze stays.
      HAZE_AROUND.x = chase ? 1 : 1 - (1 - HAZE_RING.least) * THREE.MathUtils.smoothstep(view, MARKS_FROM, HAZE_RING.to);
    } else {
      light.fogNear = Math.max(view, BATTLE_VIEW.max);
      light.fogFar = light.fogNear + HAZE_BAND / (1 + 2.2 * g);
      HAZE_AROUND.x = 1;
    }
    haze.color.copy(light.fog);
    haze.near = light.fogNear;
    haze.far = light.fogFar;
    cloudMat.color.setScalar(1 - 0.55 * g);
    sky.setOvercast(g, nowMs / 1000);
    return dt;
  };

  /**
   * A ship at her place, riding the swell under her whole hull (so she rides it rather than every ripple),
   * heeled by the wind on her beam. Returns her drawn length.
   */
  const placeShip = (
    id: string,
    root: THREE.Object3D,
    s: { x: number; y: number; headingDeg: number; sails: string },
    w: Wind,
    dt: number,
    scale: number,
    /** Her speed as a share of a fast ship's (0..1): she heels in a turn only as hard as she is going. */
    pace: number,
    model = MODEL_SCALE,
  ) => {
    const len = SHIP_LENGTH * scale;
    const r = (s.headingDeg * Math.PI) / 180;
    const fx = Math.sin(r);
    const fz = -Math.cos(r);
    const at = (along: number, abeam: number) => ocean.heightAt(s.x + fx * along - fz * abeam, s.y + fz * along + fx * abeam);
    const bow = at(len * 0.4, 0);
    const stern = at(-len * 0.4, 0);
    const port = at(0, -len * 0.12);
    const starboard = at(0, len * 0.12);
    let rel = normalizeDeg(w.fromDeg - s.headingDeg);
    if (rel > 180) rel -= 360;
    const press = s.sails === 'furled' ? 0 : (s.sails === 'full' ? 1 : 0.6) * strengthOf(w);
    const heel = Math.sin((rel * Math.PI) / 180) * press * 0.12;
    const ride = rides.get(id) ?? { bob: 0, pitch: 0, roll: 0, lean: 0, heading: s.headingDeg };
    const ease = 1 - Math.exp(-dt * RIDE_EASE);
    ride.bob += ((bow + stern + port + starboard) / 4 - ride.bob) * ease;
    ride.pitch += (Math.atan2(bow - stern, len * 0.8) - ride.pitch) * ease;
    ride.roll += (Math.atan2(starboard - port, len * 0.24) * 0.5 + heel - ride.roll) * ease;
    // Turning to starboard (heading rising) she leans out to port, and the other way round; positive roll is
    // to port, as for the wind on her starboard side.
    const turned = ((s.headingDeg - ride.heading + 540) % 360) - 180;
    ride.heading = s.headingDeg;
    const rate = dt > 0 ? turned / dt : 0;
    // Even a ship at a modest pace leans well over in a hard turn (the square root keeps it readable).
    const lean = THREE.MathUtils.clamp(rate / TURN_FULL_DEG, -1, 1) * Math.sqrt(THREE.MathUtils.clamp(pace, 0, 1)) * TURN_HEEL;
    ride.lean += (lean - ride.lean) * (1 - Math.exp(-dt * TURN_EASE));
    rides.set(id, ride);
    root.position.set(s.x, ride.bob, s.y);
    root.rotation.set(0, 0, 0);
    root.rotateY(-r);
    root.rotateX(ride.pitch);
    // A positive turn about her fore-and-aft axis lays her masts over to port (her local -x).
    root.rotateZ(ride.roll + ride.lean);
    root.scale.setScalar(model * scale);
    return len;
  };

  const bannerAt = new THREE.Vector3();
  const viewSize = new THREE.Vector2();
  /**
   * Town banners never overlap (they are drawn the same size at every zoom, so from afar neighbours would pile
   * up): the most important are placed first (capitals, then cities and towns, nearer ones first), and one that
   * would cover a banner already placed fades out until there is room for it again.
   */
  const declutterBanners = (dt: number) => {
    camera.updateMatrixWorld();
    renderer.getSize(viewSize);
    const unit = (camera.projectionMatrix.elements[5]! * viewSize.y) / 2;
    const rank = (s: PlacedSettlement) => (s.type === 'capital' ? 4 : s.size === 'city' ? 3 : s.size === 'hamlet' ? 1 : 2);
    const placed: [number, number, number, number][] = [];
    const order = names
      .filter((n) => n.inRange)
      .sort((a, b) => rank(b.s) - rank(a.s) || Math.hypot(a.x - target.x, a.y - target.z) - Math.hypot(b.x - target.x, b.y - target.z));
    const keep = new Set<(typeof names)[number]>();
    for (const n of order) {
      n.sprite.getWorldPosition(bannerAt).project(camera);
      if (bannerAt.z > 1) continue;
      // Its box on screen, in pixels, with a little room around it.
      const cx = ((bannerAt.x + 1) / 2) * viewSize.x;
      const cy = ((1 - bannerAt.y) / 2) * viewSize.y;
      const hw = (n.sprite.scale.x * unit) / 2 + 4;
      const hh = (n.sprite.scale.y * unit) / 2 + 3;
      if (placed.some(([x, y, w, h]) => Math.abs(cx - x) < hw + w && Math.abs(cy - y) < hh + h)) continue;
      placed.push([cx, cy, hw, hh]);
      keep.add(n);
    }
    // Ships' labels: nearer ones first, none over a town's name or another's.
    const keepLabels = new Set<string>();
    const labelOrder = [...shipLabels].filter(([, l]) => l.inRange).sort(([, a], [, b]) => Math.hypot(a.x - target.x, a.y - target.z) - Math.hypot(b.x - target.x, b.y - target.z));
    for (const [id, l] of labelOrder) {
      bannerAt.copy(l.banner.sprite.position).project(camera);
      if (bannerAt.z > 1) continue;
      const cx = ((bannerAt.x + 1) / 2) * viewSize.x;
      const cy = ((1 - bannerAt.y) / 2) * viewSize.y;
      const hw = (l.banner.sprite.scale.x * unit) / 2 + 4;
      const hh = (l.banner.sprite.scale.y * unit) / 2 + 3;
      if (placed.some(([x, y, w, h]) => Math.abs(cx - x) < hw + w && Math.abs(cy - y) < hh + h)) continue;
      placed.push([cx, cy, hw, hh]);
      keepLabels.add(id);
    }
    const step = Math.min(1, dt * 5);
    for (const [id, l] of shipLabels) {
      const want = keepLabels.has(id) ? 1 : 0;
      l.shown = dt ? l.shown + (want - l.shown) * step : want;
      if (Math.abs(want - l.shown) < 0.01) l.shown = want;
      // Readable to the edge of the haze, then gone with her into it.
      const clear = 1 - THREE.MathUtils.smoothstep(l.banner.sprite.position.distanceTo(camera.position), haze.far * 0.85, haze.far);
      l.banner.sprite.visible = l.shown * clear > 0.01;
      (l.banner.sprite.material as THREE.SpriteMaterial).opacity = l.shown * clear;
    }
    for (const n of names) {
      // Fades rather than pops; a fresh view (no time passed yet) shows the outcome at once.
      const want = keep.has(n) ? 1 : 0;
      n.shown = dt ? n.shown + (want - n.shown) * step : want;
      if (Math.abs(want - n.shown) < 0.01) n.shown = want;
      // A name fades into the haze with its town.
      n.sprite.getWorldPosition(bannerAt);
      const clear = 1 - THREE.MathUtils.smoothstep(bannerAt.distanceTo(camera.position), haze.near, haze.far) * HAZE_AROUND.x;
      n.sprite.visible = n.shown * clear > 0.01;
      (n.sprite.material as THREE.SpriteMaterial).opacity = n.shown * clear;
    }
  };

  /** Clouds drifting downwind (shown only from afar), the camera, and the frame drawn. */
  const finishFrame = (view: number, pitch: number, yaw: number, wind: Wind, sea: SeaState, t: number, dt: number, ahead = 0) => {
    cloudMat.opacity = shown('clouds') ? 0.85 * THREE.MathUtils.smoothstep(view, CLOUDS_FROM[0]!, CLOUDS_FROM[1]!) : 0;
    const drift = strengthOf(wind) * CLOUD_SPEED * dt;
    const to = ((wind.fromDeg + 180) * Math.PI) / 180;
    // Faded right out (close in), the sprites aren't drawn at all: three draws a transparent sprite all the same.
    const cloudsShow = cloudMat.opacity > 0.01;
    for (const c of clouds) {
      c.position.x = (c.position.x + Math.sin(to) * drift + map.width) % map.width;
      c.position.z = (c.position.z - Math.cos(to) * drift + map.height) % map.height;
      c.visible = cloudsShow;
    }
    const back = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(view);
    back.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.position.copy(target).add(back);
    // Looking `ahead` tiles past the target, away from the camera.
    const run = Math.hypot(back.x, back.z) || 1;
    camera.lookAt(target.x - (back.x / run) * ahead, 0.6, target.z - (back.z / run) * ahead);
    declutterBanners(dt);
    // Heavy weather: rain round the camera, lightning, spray off the bows; a strike lights the whole scene.
    const flash = storm.update({
      camera: camera.position,
      target,
      dt,
      t,
      rain: THREE.MathUtils.smoothstep(gloom, 0.4, 0.85),
      lightning: THREE.MathUtils.smoothstep(stormShare, 0.5, 1),
      // Spray only in a real blow (a strong wind or worse): a fresh breeze's bow wave is foam, not spray.
      rough: THREE.MathUtils.smoothstep(sea.strength, 0.9, 1.1),
      windToDeg: sea.toDeg,
      windStrength: sea.strength,
      ships: sprayShips,
      viewHeight: renderer.domElement.height,
    });
    if (flash > 0) {
      const white = new THREE.Color(0.85, 0.9, 1);
      light.sky.lerp(white, flash * 0.7);
      zenith.lerp(white, flash * 0.5);
      fill.intensity += flash * 3;
      light.ambient.add(white.clone().multiplyScalar(flash * 2.5));
      renderer.toneMappingExposure *= 1 + flash * 0.5;
      (scene.background as THREE.Color).copy(light.sky);
    }
    sprayShips = [];
    sun.position.copy(target).addScaledVector(sunDir, 200);
    sun.target.position.copy(target);
    // Only land, towns and landmarks take shadows (the sea and the ships don't): on open water the shadow map isn't
    // drawn at all. (Turning the light's shadow off instead would recompile every material as land came and went.)
    renderer.shadowMap.needsUpdate = landWithin(target.x, target.z, SHADOW_REACH);
    ground.update(camera.position, target);
    ocean.update(target, sea, t, light);
    // The sky's horizon in its own colour, paler than the far sea below it (the same, under a storm's mist).
    sky.update(camera.position, zenith, skyLine, sunDir, light.sun);
    // Looking down on the sea (the usual view) no sky shows past the view's top corners: the dome would be shaded
    // across the whole screen only for the sea to cover it.
    camera.updateMatrixWorld();
    sky.mesh.visible = SKY_CORNERS.some((c) => {
      const ray = skyRay.set(c, 1, 0.5).unproject(camera).sub(camera.position).normalize();
      return ray.y > -0.02 || camera.position.y / -ray.y > SKY_SEA_REACH;
    });
    towns.update(t);
    // A blow in a fight shakes the frame drawn, and only that: the labels, the framing and picks see the camera still.
    drawShaken(camera, shake.update(dt), () => composer.render(dt));
  };

  // Heavy weather's rain, lightning and spray (storm.ts); the bows throwing spray this frame.
  const storm = createStorm();
  scene.add(storm.object);
  const shake = createShake();
  let sprayShips: SprayShip[] = [];
  /** Each ship's pitch last frame, for how fast her bow is dropping into a sea. */
  const lastPitch = new Map<string, number>();
  /** A ship's bow, for spray: where it is, and how fast it is dropping. */
  const bowOf = (id: string, root: THREE.Object3D, headingDeg: number, length: number, pace: number, dt: number): SprayShip => {
    const r = (headingDeg * Math.PI) / 180;
    const ride = rides.get(id);
    const pitch = ride?.pitch ?? 0;
    const dip = dt > 0 ? -(pitch - (lastPitch.get(id) ?? pitch)) / dt : 0;
    lastPitch.set(id, pitch);
    return {
      x: root.position.x + Math.sin(r) * length * 0.46,
      y: root.position.y + length * 0.06,
      z: root.position.z - Math.cos(r) * length * 0.46,
      headingDeg,
      length,
      pace,
      dip,
    };
  };

  // The sea battle: its two ships, built like any other, and its layer of shot, smoke and wreckage.
  const fx = createBattleFx();
  fx.object.visible = false;
  scene.add(fx.object);
  const fighters = new Map<'player' | 'enemy', { built: BuiltShip; classId: string; plan: ShipPlan }>();
  let inBattle = false;
  let battleView = BATTLE_VIEW.min;
  /** Battle ships' model scale: true size times the fight's scale (battle.shipScale). */
  const battleScale = BATTLE_MODEL_SCALE * content.combat.battle.shipScale;
  /** How far the battle camera's framing stands off its first guess, eased each frame to put the ships at BATTLE_FIT. */
  let battleFit = 1;
  const fitPoint = new THREE.Vector3();
  const fitAhead = new THREE.Vector3();
  const fitOff = new THREE.Vector3();
  let sinkingFrom: number | undefined;
  /** Masts going by the board, by ship and mast: when it began, and the way it falls on her bearings. */
  const falls = new Map<string, { from: number; towardDeg: number }>();
  let fallsSeen = -Infinity;
  /** Back to the sea map: the fight's ships and its wreckage go; the world's ships return. */
  const leaveBattle = () => {
    inBattle = false;
    seaFrames = 0;
    for (const [side, f] of fighters) {
      scene.remove(f.built.root);
      rides.delete(`battle.${side}`);
    }
    fighters.clear();
    fx.object.visible = false;
    fx.reset();
    worldShips.visible = true;
    markLayer.visible = true;
  };

  /** The overcast at a point: the wind's strength there, deepest within a storm. */
  const gloomAt = (state: WorldState, x: number, y: number) => {
    const byWind = GLOOM_BY_WIND[options.windAt(state, x, y).strength] ?? 0;
    let byStorm = 0;
    for (const s of state.weather?.storms ?? []) {
      const d = Math.hypot(s.x - x, s.y - y);
      byStorm = Math.max(byStorm, 1 - THREE.MathUtils.smoothstep(d, s.radius * 0.7, s.radius * 1.5));
    }
    battleStorm = byStorm;
    stormShare = byStorm;
    return Math.max(byWind, byStorm);
  };
  /** The storm's share of the overcast where the player last was (a fight joined there keeps it). */
  let battleStorm = 0;
  /** How deep in a storm the camera is now (lightning strikes only in storms). */
  let stormShare = 0;

  const render = (state: WorldState, nowMs: number) => {
    if (inBattle) leaveBattle();
    const me = state.ships[options.playerId];
    if (!me) return;
    gloomWant = gloomAt(state, me.x, me.y);
    skyTick = state.tick;
    if (skyWant !== undefined) {
      skyShift = tickAtHour(content.calendar, skyWant, skyTick) - skyTick;
      skyWant = undefined;
    }
    const reach = viewTiles(content, state.tick, options.windAt(state, me.x, me.y), me, state.weather?.storms);
    const dt = beginFrame(nowMs, distance, { x: me.x, z: me.y, reach });
    wildlife.update(me, dt, hourOf(content.calendar, skyTick + skyShift));
    // The smoke of distant fights: swelling, rising downwind, thinning to nothing.
    smokeClock += dt;
    const downwind = (options.windAt(state, me.x, me.y).fromDeg + 180) * (Math.PI / 180);
    if (beacon && smokeClock >= beaconDue) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#8a837b', transparent: true, depthWrite: false, opacity: 0 }));
      sprite.position.set(beacon.x + (Math.random() - 0.5) * 0.3, 0.6, beacon.y + (Math.random() - 0.5) * 0.3);
      smokeLayer.add(sprite);
      smokes.push({ sprite, at: smokeClock, size: 1.1 + Math.random() * 0.6, drift: Math.random(), column: true });
      beaconDue = smokeClock + BEACON_EVERY;
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const p = smokes[i]!;
      const age = (smokeClock - p.at) / SMOKE_SECONDS;
      if (age >= 1) {
        smokeLayer.remove(p.sprite);
        p.sprite.material.dispose();
        smokes.splice(i, 1);
        continue;
      }
      const k = Math.max(0, age);
      p.sprite.scale.setScalar(p.size * (1 + k * 3));
      p.sprite.position.x += Math.sin(downwind) * dt * (0.5 + p.drift * 0.3);
      p.sprite.position.z -= Math.cos(downwind) * dt * (0.5 + p.drift * 0.3);
      p.sprite.position.y = p.column ? 0.6 + k * 14 : 0.4 + k * 2.5;
      p.sprite.material.opacity = (p.column ? 0.7 : 0.55) * (1 - k) * Math.min(1, (smokeClock - p.at) * 6 + 0.2);
    }
    // The course she is sailing (the autopilot's route to its mark, or the ship she is intercepting), else the
    // route plotted to the destination picked on the chart.
    const plan = me.assist;
    const them = plan?.mode === 'intercept' && plan.targetId ? state.ships[plan.targetId] : undefined;
    const ahead: [number, number][] | undefined =
      plan?.mode === 'course' && plan.x !== undefined && plan.y !== undefined ? [...(plan.route ?? []), [plan.x, plan.y]] : them ? [[them.x, them.y]] : guidePoints;
    guideLine.visible = Boolean(ahead?.length);
    if (ahead?.length) {
      // A fresh geometry each frame: LineGeometry's buffers are sized by the first points it is given.
      guideLine.geometry.dispose();
      guideLine.geometry = new LineGeometry().setPositions([[me.x, me.y] as [number, number], ...ahead].flatMap(([x, y]) => [x, 0.3, y]));
      guideLine.computeLineDistances();
    }
    landmarks.set(
      content.pirates.captains.flatMap((c) => {
        const hoard = state.famous?.[c.id]?.hoard;
        return hoard && state.captain?.mapPieces?.[c.id] ? [{ id: c.id, x: hoard.x, y: hoard.y, kind: hoard.landmark, found: hoard.found }] : [];
      }),
    );
    const t = nowMs / 1000;
    const wind = options.windAt(state, me.x, me.y);
    const runOf = options.seaWindAt?.(state, me.x, me.y) ?? wind;
    const sea: SeaState = { toDeg: normalizeDeg(runOf.fromDeg + 180), strength: strengthOf(wind) };

    // Ships: each at her place, her sails for the wind; far out they grow so they stay readable.
    const farScale = THREE.MathUtils.clamp(distance / 140, 1, FAR_SHIP_SCALE);
    const seen = new Set<string>();
    const zoomedOut = distance >= MARKS_FROM && !chase;
    const wakes = new Set<string>();
    const labelled = new Set<string>();
    // The ships in company with each flagship, the player's fleet or a pirate's prizes in tow: not on the sea map of
    // their own (the sim pools them with her), so placed here each frame in line astern of her, on her track.
    const company: Ship[] = [];
    const leading = new Set<string>();
    for (const s of Object.values(state.ships)) {
      const fleet = s.id === options.playerId ? (state.captain?.fleet ?? []) : (s.ai?.prizes ?? []);
      if (!fleet.length || s.docked || inPort(s)) continue;
      leading.add(s.id);
      const stations = consorts.stations(s.id, s, fleet.length, SHIP_LENGTH * farScale * CONSORT_SPACING, (x, y) => !isLand(tileAt(map, x, y)));
      // Those not yet out of port behind her are not drawn till they are.
      fleet.slice(0, stations.length).forEach((f, i) => {
        const at = stations[i]!;
        company.push({
          ...s,
          id: `${s.id}~${f.id}`,
          classId: f.classId,
          hull: f.hull,
          sailCondition: f.sailCondition,
          guns: f.guns,
          upgrades: f.upgrades,
          crew: undefined,
          assist: undefined,
          x: at.x,
          y: at.y,
          headingDeg: at.headingDeg,
          // A prize in tow flies her taker's colours, plain.
          ...(s.ai ? { ai: { ...s.ai, famous: undefined } } : {}),
        });
      });
    }
    consorts.keep(leading);
    const inCompany = new Set(company.map((c) => c.id));
    for (const s of [...Object.values(state.ships), ...company]) {
      seen.add(s.id);
      // (Not a ship in company: she sails out behind her flagship, she doesn't rise from the sea.)
      if (seaFrames > 0 && !knownIds.has(s.id) && !inCompany.has(s.id)) born.set(s.id, t);
      // Short of the haze's end she shows (out of the haze on the horizon as she closes it); zoomed out, where the
      // haze has lifted, within her view of the player's ship (a mark where she was last seen past it).
      const inView = zoomedOut ? Math.hypot(s.x - me.x, s.y - me.y) <= reach : Math.hypot(s.x - camera.position.x, camera.position.y, s.y - camera.position.z) <= haze.far;
      let shown = s.id === options.playerId || inView ? 1 : 0;
      const from = born.get(s.id);
      if (from !== undefined) {
        if (t - from >= RISE_SECONDS) born.delete(s.id);
        else shown = Math.min(shown, THREE.MathUtils.smoothstep(t - from, 0, RISE_SECONDS));
      }
      shownLast.set(s.id, shown);
      if (shown <= 0) {
        // Out of view: not drawn (built only once she first comes into it).
        const m = ships.get(s.id);
        if (m) m.root.visible = false;
        continue;
      }
      const m = shipFor(s);
      m.root.visible = true;
      const w = options.windAt(state, s.x, s.y);
      m.setSails(sailAnim(content, s, w, nowMs));
      // Her men on deck, as many as she has hands for (a full complement shows a full deck).
      const maxCrew = content.ships[s.classId]?.maxCrew ?? 100;
      m.setCrew((s.crew ?? maxCrew * 0.7) / maxCrew);
      // Her damage, as a fight left it: canvas in rags by her sails' state, her side holed by her hull's, empty
      // ports for guns lost. Holes are placed the same way each time (her id's own rolls), patched when repaired.
      m.built.setTatters(1 - (s.sailCondition ?? 100) / 100);
      // Her shipwright's fit, as it shows.
      m.built.setFit(fitOfClass(content, s));
      const stats = shipStats(content, s);
      const holes = Math.round(Math.max(0, 1 - (s.hull ?? stats.hullMax) / stats.hullMax) * 24);
      if (holes < m.holes) {
        m.built.clearHoles();
        m.holes = 0;
      }
      for (; m.holes < holes; m.holes++) {
        const r = (k: number) => {
          const v = Math.sin((m.holes + 1) * 12.9898 + k * 78.233 + s.id.length * 3.1) * 43758.5453;
          return v - Math.floor(v);
        };
        m.built.hole(r(1) - 0.5, r(2) < 0.5 ? -1 : 1, 0.25 + r(3) * 0.6);
      }
      const battery = content.ships[s.classId]?.guns;
      if (battery) m.built.setGuns((s.guns ?? battery) / battery);
      const pace = s.speed / content.navigation.tilesPerSecondPerSpeedPoint / FAST_SHIP;
      const len = placeShip(s.id, m.root, s, w, dt, farScale, pace);
      // New to the sea in sight: she comes up from below, by the share of her not yet shown (about her height: a
      // ship's masts stand about as high as she is long).
      m.root.position.y -= (1 - shown) * len * 1.3;
      if (shown < 0.5) continue;
      // Her own name over her; not over the ships in her company.
      const text = s.id !== options.playerId && !inCompany.has(s.id) ? options.shipLabel?.(s, me) : undefined;
      if (text !== undefined) {
        let l = shipLabels.get(s.id);
        if (l && l.text !== text) {
          labelLayer.remove(l.banner.sprite);
          l.banner.dispose();
          l = undefined;
        }
        if (!l) {
          l = { banner: createBanner(text, s.ai?.nation ?? 'pirate', SHIP_LABEL_SIZE, famousFlag(s.ai?.famous)), text, x: s.x, y: s.y, inRange: false, shown: 0 };
          labelLayer.add(l.banner.sprite);
          shipLabels.set(s.id, l);
        }
        // Over her masts (a ship's masts stand about as high as she is long).
        l.banner.sprite.position.set(m.root.position.x, m.root.position.y + len * 1.15, m.root.position.z);
        l.x = s.x;
        l.y = s.y;
        l.inRange = true;
        labelled.add(s.id);
      }
      wakes.add(s.id);
      if (Math.hypot(s.x - me.x, s.y - me.y) < 30 + distance * 0.6) sprayShips.push(bowOf(s.id, m.root, s.headingDeg, len, Math.min(1, pace * 1.4), dt));
    }
    // Labels only on ships drawn this frame; a ship gone from the sea takes hers with her.
    for (const [id, l] of shipLabels) {
      l.inRange = labelled.has(id);
      if (seen.has(id)) continue;
      labelLayer.remove(l.banner.sprite);
      l.banner.dispose();
      shipLabels.delete(id);
    }
    for (const [id, m] of ships) {
      if (seen.has(id)) continue;
      ships.delete(id);
      rides.delete(id);
      born.delete(id);
      // Gone from the sea in her sight (sunk, or taken and broken up): she goes down rather than vanish.
      if (seaFrames > 0 && (shownLast.get(id) ?? 0) > 0.5 && m.root.visible) ghosts.push({ root: m.root, at: t, len: SHIP_LENGTH * farScale });
      else worldShips.remove(m.root);
      shownLast.delete(id);
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i]!;
      const k = (t - g.at) / GHOST_SECONDS;
      if (k >= 1) {
        worldShips.remove(g.root);
        ghosts.splice(i, 1);
        continue;
      }
      // Settling by the stern and heeling, then gone under.
      g.root.rotateX((-0.35 * dt) / GHOST_SECONDS);
      g.root.rotateZ((0.9 * k * dt) / GHOST_SECONDS);
      g.root.position.y -= ((2 * k * dt) / GHOST_SECONDS) * g.len * 1.6;
    }
    knownIds = seen;
    // Zoomed out, where each ship out of sight was last seen, fading over MARK_DAYS.
    const keepMarks = new Set<string>();
    if (zoomedOut) {
      const tpd = content.calendar.ticksPerDay;
      for (const [id, seenAt] of Object.entries(state.captain?.sightings ?? {})) {
        if ((shownLast.get(id) ?? 0) > 0) continue;
        const age = (state.tick - seenAt.tick) / (tpd * MARK_DAYS);
        if (age >= 1) continue;
        let mark = marks.get(id);
        if (!mark) {
          mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: lastSeenMark(), sizeAttenuation: false, depthTest: false, fog: false, transparent: true }));
          mark.scale.set(0.028, 0.028, 1);
          mark.renderOrder = 9;
          marks.set(id, mark);
          markLayer.add(mark);
        }
        mark.position.set(seenAt.x, 0.5, seenAt.y);
        mark.material.opacity = 0.8 * (1 - age);
        keepMarks.add(id);
      }
    }
    for (const [id, mark] of marks) {
      if (keepMarks.has(id)) continue;
      markLayer.remove(mark);
      mark.material.dispose();
      marks.delete(id);
    }
    // Wakes behind the ships near the camera (far out they'd be finer than a pixel).
    ocean.ships(
      [...Object.values(state.ships), ...company]
        .filter((s) => wakes.has(s.id) && Math.hypot(s.x - me.x, s.y - me.y) < 60 + distance)
        .map((s) => ({
          id: s.id,
          x: s.x,
          z: s.y,
          headingDeg: s.headingDeg,
          speed: s.speed,
          pace: Math.min(1, s.speed / content.navigation.tilesPerSecondPerSpeedPoint / BRISK),
          length: SHIP_LENGTH * farScale,
        })),
    );

    for (const n of names) n.inRange = Math.hypot(n.x - me.x, n.y - me.y) < NAMES_WITHIN * Math.max(1, distance / 120);
    seaNames.update(distance, !chase);
    // Each town's line, from the game's state, freshened every couple of seconds (redrawn only when it changes).
    if (options.townLine && nowMs - bannersAt > 2000) {
      bannersAt = nowMs;
      for (const n of names) if (n.inRange) n.banner.setLine(options.townLine(n.s, state));
    }

    // Camera: overhead (steeper the further out) or from astern, following the player.
    target.set(me.x, 0, me.y);
    const zt = Math.log(distance / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min);
    const base = THREE.MathUtils.degToRad(chase ? CHASE_PITCH.min + zt * CHASE_PITCH.span : MAP_PITCH.min + zt * MAP_PITCH.span);
    viewHeading = chase ? chaseYaw(me.headingDeg, dt) : me.headingDeg;
    const pitch = chase ? chasePitch(base, distance, viewHeading, dt) : base;
    finishFrame(distance, pitch, chase ? (-viewHeading * Math.PI) / 180 : 0, wind, sea, t, dt, chase ? distance * CHASE_AHEAD : 0);
    seaFrames++;
  };

  /** The sea battle, on the same sea as the map (its positions are world tiles). */
  const renderBattle = (view: BattleViewState, nowMs: number, enemyNation?: string, enemyFamous?: string) => {
    if (!inBattle) {
      // A fresh fight: the world's ships give way to the two fighting, the camera starts framing them.
      inBattle = true;
      worldShips.visible = false;
      markLayer.visible = false;
      seaNames.object.visible = false;
      fx.object.visible = true;
      fx.reset();
      // The smoke of the map's distant fights ages only on the map: left, it would hang frozen over this one.
      for (const p of smokes) {
        smokeLayer.remove(p.sprite);
        p.sprite.material.dispose();
      }
      smokes.length = 0;
      sinkingFrom = undefined;
      falls.clear();
      fallsSeen = -Infinity;
      battleView = 0;
      battleFit = 1;
      // The camera comes round astern of her at once, not from wherever the sea's chase camera last looked.
      camYaw = undefined;
      shake.reset();
    }
    const wind = view.wind;
    const sea: SeaState = { toDeg: normalizeDeg(wind.fromDeg + 180), strength: strengthOf(wind) };
    const { player, enemy } = view.ships;
    const apart = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    // Frame both ships (Pirates! keeps both in view), closer as they close: a first
    // guess by how far apart they lie, corrected each frame by where they fall on screen (battleFit); the wheel
    // pulls back from that, or closes in, as at sea.
    const want = THREE.MathUtils.clamp((apart * 0.5 + 2) * battleFit * battleZoom, BATTLE_VIEW.min, BATTLE_VIEW.max);
    // The fight keeps the weather it began in: its wind's strength, and any storm it was joined in.
    gloomWant = Math.max(GLOOM_BY_WIND[view.wind.strength] ?? 0, battleStorm);
    stormShare = battleStorm;
    const dt = beginFrame(nowMs, battleView || want);
    const t = nowMs / 1000;
    battleView = battleView ? battleView + (want - battleView) * (1 - Math.exp(-dt * 1.5)) : want;

    const hulls: Partial<Record<'player' | 'enemy', BattleHull>> = {};
    const wakeShips: WakeShip[] = [];
    for (const [side, s] of [['player', player], ['enemy', enemy]] as const) {
      let f = fighters.get(side);
      if (f && f.classId !== s.classId) {
        scene.remove(f.built.root);
        f = undefined;
      }
      if (!f) {
        const plan = RIGS[s.classId] ?? RIGS['ship.brig']!;
        f = { built: buildShip(plan, side === 'player' ? 'player' : (enemyNation ?? 'pirate'), side === 'enemy' ? famousFlag(enemyFamous) : undefined), classId: s.classId, plan };
        fighters.set(side, f);
        scene.add(f.built.root);
      }
      // Sails shot through show it: holes, then rags (her canvas set as she set it).
      f.built.setTatters(1 - (s.sailCondition ?? 100) / 100);
      f.built.setFit(fitOfClass(content, s));
      // Her men on deck: grapeshot sweeping her deck cuts them down, and they fall where they stood.
      const maxCrew = content.ships[s.classId]?.maxCrew ?? 100;
      f.built.setCrew(view.wreck && side === 'enemy' ? 0 : (s.crew ?? maxCrew * 0.7) / maxCrew, nowMs);
      // Masts shot away: each comes down over her side when it goes, and stays down.
      for (const e of view.effects) {
        if (e.ship !== side || e.at <= fallsSeen) continue;
        if (e.kind === 'mast' && e.mast !== undefined) {
          falls.set(`${side}:${e.mast}`, { from: t, towardDeg: fallSide(s.headingDeg, e.towardDeg ?? s.headingDeg + 90) });
        } else if (e.place?.part === 'rigging' && e.place.up !== undefined) {
          // Through her rigging: a hole in the canvas where the ball crossed it (in her own frame).
          const sz = content.ships[s.classId]?.size;
          const along = e.place.along * (sz ? sz.length * content.combat.battle.shipScale : f.plan.hull.length * battleScale);
          f.built.sailHole(e.place.up / battleScale, -along / battleScale);
        } else if (e.kind === 'hit' && e.place?.part === 'hull') {
          // Round shot through her side: a hole on the side facing the ship that fired.
          const foe = side === 'player' ? enemy : player;
          const r = (s.headingDeg * Math.PI) / 180;
          const starboard = (foe.x - s.x) * Math.cos(r) + (foe.y - s.y) * Math.sin(r);
          f.built.hole(e.place.along, starboard >= 0 ? 1 : -1, 0.25 + Math.random() * 0.6);
        }
      }
      // Guns recoil when a broadside fires and stay in while she loads; loaded and bearing, they roll out over the
      // tell (combat.json battle.tellSeconds), so the other ship sees a broadside coming.
      if (s.runOut) {
        const tell = Math.max(1e-6, content.combat.battle.tellSeconds);
        f.built.setRunOut(Math.min(1, s.runOut.port / tell), Math.min(1, s.runOut.starboard / tell));
      }
      // Guns knocked out show as empty ports.
      const battery = content.ships[s.classId]?.guns;
      if (battery && s.guns !== undefined) f.built.setGuns(s.guns / battery);
      (s.masts ?? []).forEach((m, i) => {
        const fall = falls.get(`${side}:${i}`);
        // Fished after it fell: a jury mast stands again (her sails show what canvas it carries).
        if (fall && m > 0) f!.built.setMast(i, 0, 90);
        else if (fall) f!.built.setMast(i, (t - fall.from) / MAST_FALL_SECONDS, fall.towardDeg);
        else f!.built.setMast(i, m > 0 ? 0 : 1, 90);
      });
      f.built.setSails(...sailsOf(sailAnim(content, s, wind, nowMs)), nowMs);
      const pace = (s.speed ?? 0) / content.combat.battle.tilesPerSecondPerSpeedPoint / FAST_SHIP;
      const length = placeShip(`battle.${side}`, f.built.root, s, wind, dt, content.combat.battle.shipScale / SHIP_SCALE, pace, battleScale);
      if (!(side === 'enemy' && view.wreck)) sprayShips.push(bowOf(`battle.${side}`, f.built.root, s.headingDeg, length, Math.min(1, pace * 1.4), dt));
      // Going down: she settles by the stern, rolls and is gone under the sea.
      if (side === 'enemy' && view.wreck) {
        if (sinkingFrom === undefined) {
          sinkingFrom = t;
          shake.add(SHAKE.explosion);
          fx.splash(t, s.x, s.y);
          ocean.splash(s.x, s.y, 1.8);
        }
        const k = Math.min(1, (t - sinkingFrom) / SINK_SECONDS);
        const root = f.built.root;
        root.rotateX(-0.35 * k);
        root.rotateZ(0.45 * k * k);
        root.position.y -= k * k * (f.plan.masts.reduce((h, m) => Math.max(h, m.height), 1) + 0.6) * battleScale;
        root.visible = k < 1;
      } else f.built.root.visible = true;
      const tallest = f.plan.masts.reduce((h, m) => Math.max(h, m.height), 1);
      hulls[side] = {
        x: s.x,
        z: s.y,
        headingDeg: s.headingDeg,
        length: f.plan.hull.length * battleScale,
        halfBeam: f.plan.hull.beam * battleScale,
        deck: f.plan.hull.rail * battleScale,
        sails: tallest * 0.6 * battleScale,
        masts: f.plan.masts.map((m) => ({ along: m.at / f!.plan.hull.length, height: m.height * battleScale })),
      };
      if (!(side === 'enemy' && view.wreck)) wakeShips.push({ id: `battle.${side}`, x: s.x, z: s.y, headingDeg: s.headingDeg, speed: s.speed ?? 0, pace: Math.min(1, (pace * FAST_SHIP) / BRISK), length });
    }
    ocean.ships(wakeShips);
    // Shot into the sea, a mast over the side: rings run out across the water.
    for (const e of view.effects) {
      if (e.at <= fallsSeen) continue;
      if (e.kind === 'splash') ocean.splash(e.x, e.y, 0.35);
      else if (e.kind === 'mast') ocean.splash(e.x, e.y, 1.1);
      // And the blows shake the camera: the ship nearest the smoke fired (gun smoke carries no ship).
      if (e.kind === 'smoke') {
        const theirs = Math.hypot(e.x - player.x, e.y - player.y) >= Math.hypot(e.x - enemy.x, e.y - enemy.y);
        shake.add(theirs ? SHAKE.theirBroadside / (1 + apart / 8) : SHAKE.broadside);
      } else if (e.kind !== 'splash') {
        const blow = e.kind === 'mast' ? SHAKE.mast : e.kind === 'hit' && e.place?.part === 'hull' ? SHAKE.hull : SHAKE.rigging;
        shake.add(e.ship === 'player' ? blow : blow * SHAKE.enemyShare);
      }
    }
    fallsSeen = Math.max(fallsSeen, ...view.effects.map((e) => e.at));
    for (const n of names) n.inRange = false;

    fx.update({
      t,
      dt,
      view,
      hulls: { player: hulls.player!, enemy: hulls.enemy },
      seaAt: (x, z) => ocean.heightAt(x, z),
      windToDeg: sea.toDeg,
      windStrength: sea.strength,
      level: light.level,
      viewHeight: renderer.domElement.height,
    });

    // The camera: astern of her, turning lazily with her (as the chase camera does), on the pair a little toward her
    // and low; from close astern of her alone on C.
    target.set(player.x + (enemy.x - player.x) * 0.35, 0, player.y + (enemy.y - player.y) * 0.35);
    if (chase) target.set(player.x, 0, player.y);
    const zt = Math.log(Math.max(ZOOM.min, battleView * SHIP_SCALE) / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min);
    const zb = Math.log(battleView / BATTLE_VIEW.min) / Math.log(BATTLE_VIEW.max / BATTLE_VIEW.min);
    const base = THREE.MathUtils.degToRad(chase ? CHASE_PITCH.min + zt * CHASE_PITCH.span : BATTLE_PITCH.min + zb * BATTLE_PITCH.span);
    const span = chase ? Math.min(battleView, 30) : battleView;
    viewHeading = chaseYaw(player.headingDeg, dt);
    const pitch = chasePitch(base, span, viewHeading, dt);
    finishFrame(span, pitch, (-viewHeading * Math.PI) / 180, wind, sea, t, dt, chase ? span * CHASE_AHEAD : 0);
    // Where the two ships fell on screen (their hulls and lower sails): ease the framing to put the further at BATTLE_FIT,
    // and her own no further out than BATTLE_FIT_OWN.
    // One behind the camera (an enemy close astern) projects mirrored, so it counts as off the screen.
    if (!chase) {
      camera.getWorldDirection(fitAhead);
      const over = Math.max(
        ...([[player, BATTLE_FIT_OWN], [enemy, BATTLE_FIT]] as const).map(([s, fit]) => {
          fitPoint.set(s.x, 1, s.y);
          if (fitOff.subVectors(fitPoint, camera.position).dot(fitAhead) <= 0) return 2;
          fitPoint.project(camera);
          return Math.max(Math.abs(fitPoint.x), Math.abs(fitPoint.y)) / fit;
        }),
      );
      battleFit = THREE.MathUtils.clamp(battleFit * Math.pow(Math.max(0.05, over), Math.min(1, dt * 2)), 0.4, 4);
    }
  };

  return {
    canvas,
    onLightning: (cb) => storm.onLightning(cb),
    render,
    renderBattle,
    resize(width, height) {
      cssSize.width = width;
      cssSize.height = height;
      applySize();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      guideMaterial.resolution.set(width, height);
    },
    renderScale: () => renderScale,
    zoom(steps) {
      if (inBattle) battleZoom = THREE.MathUtils.clamp(battleZoom * Math.pow(1.12, steps), BATTLE_ZOOM.min, BATTLE_ZOOM.max);
      else distance = THREE.MathUtils.clamp(distance * Math.pow(1.12, steps), ZOOM.min, ZOOM.max);
    },
    pick(px, py) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return undefined;
      pickRay.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), camera);
      const hit = pickRay.ray.intersectPlane(SEA_PLANE, new THREE.Vector3());
      return hit ? { x: hit.x, y: hit.z } : undefined;
    },
    project(x, y) {
      const r = canvas.getBoundingClientRect();
      const v = new THREE.Vector3(x, 0, y).project(camera);
      if (v.z > 1) return undefined;
      return { px: ((v.x + 1) / 2) * r.width, py: ((1 - v.y) / 2) * r.height };
    },
    viewDeg: () => (chase || inBattle ? viewHeading : 0),
    wildlife: {
      spawn: (kind) => wildlife.spawn(kind),
      get count() {
        return wildlife.count;
      },
    },
    seaFight(x, y) {
      for (let k = 0; k < 6; k++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: '#b8b5ad', transparent: true, depthWrite: false, opacity: 0.55 }));
        const a = (k / 6) * Math.PI * 2 + Math.random();
        sprite.position.set(x + Math.cos(a) * 0.6, 0.4, y + Math.sin(a) * 0.6);
        smokeLayer.add(sprite);
        smokes.push({ sprite, at: smokeClock + k * 0.08, size: 1.2 + Math.random() * 0.8, drift: Math.random() });
      }
    },
    guide(points) {
      guidePoints = points;
    },
    beacon(at) {
      beacon = at;
    },
    toggleChase() {
      chase = !chase;
    },
    showcase(classIds, state) {
      const me = state.ships[options.playerId];
      if (!me) return;
      classIds.forEach((id, i) => {
        const plan = RIGS[id];
        if (!plan) return;
        const built = buildShip(plan, i % 2 ? 'spain' : 'england');
        built.setSails('full', 'beam', 1, 0);
        built.root.position.set(me.x - 9 + (i % 4) * 6, 0, me.y + 5 + Math.floor(i / 4) * 5);
        built.root.rotation.y = -Math.PI / 2;
        built.root.scale.setScalar(MODEL_SCALE);
        scene.add(built.root);
      });
    },
    setSkyHour(hour) {
      skyWant = hour;
    },
    setShake(scale) {
      shake.setScale(scale);
    },
    get shaking() {
      return shake.trauma;
    },
    get shipLabels() {
      return [...shipLabels.values()].filter((l) => l.banner.sprite.visible).map((l) => l.text);
    },
    get shipsDrawn() {
      return [...ships].filter(([, m]) => m.root.visible && worldShips.visible).map(([id, m]) => ({ id, x: m.root.position.x, y: m.root.position.z }));
    },
  };
}

interface Banner {
  sprite: THREE.Sprite;
  /** Sets the line under the name (redrawn only when it changes). */
  setLine(line: string): void;
  dispose(): void;
}
/** A ship's label against a town's banner: smaller, so a town's name still reads first. */
const SHIP_LABEL_SIZE = 0.7;

/** A ship last seen here: a small sail, as the chart marks one. */
function lastSeenMark(): THREE.Texture {
  if (LAST_SEEN) return LAST_SEEN;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(30, 24, 18, 0.9)';
  ctx.fillStyle = '#f3e6c8';
  // Hull.
  ctx.beginPath();
  ctx.moveTo(12, 44);
  ctx.lineTo(52, 44);
  ctx.lineTo(44, 54);
  ctx.lineTo(20, 54);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Sail.
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(32, 40);
  ctx.lineTo(12, 40);
  ctx.closePath();
  ctx.moveTo(35, 12);
  ctx.lineTo(52, 40);
  ctx.lineTo(35, 40);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  LAST_SEEN = new THREE.CanvasTexture(c);
  LAST_SEEN.colorSpace = THREE.SRGBColorSpace;
  return LAST_SEEN;
}
let LAST_SEEN: THREE.Texture | undefined;

/** A flag as the sea flies it, as a picture for the page (a famous pirate's demand shows hers). */
export function flagPicture(nation: string, design?: FlagDesign): string {
  const key = design ? `${design.field}|${design.colour}|${design.device}` : nation;
  let url = FLAG_PICTURES.get(key);
  if (!url) FLAG_PICTURES.set(key, (url = (flagTexture(nation, design).image as HTMLCanvasElement).toDataURL()));
  return url;
}
const FLAG_PICTURES = new Map<string, string>();

/**
 * A town's banner over it, the same size on screen at every zoom (Pirates! 2004 shows the nation's colours, the
 * name and a line on the town's state): the nation's flag, the name in a serif, and the line beneath.
 */
function createBanner(name: string, nation: string, size = 1, design?: FlagDesign): Banner {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const nameFont = '600 46px Georgia, serif';
  const lineFont = 'italic 26px Georgia, serif';
  const flagW = 74;
  // Drawn flat at the banner's own size: the cloth flag shrunk this far is mush, and its frayed fly lets the frame through.
  const flag = drawFlagIcon(nation, design, flagW - 8, 42);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, fog: false }));
  sprite.renderOrder = 10;
  let shown: string | undefined;
  const draw = (line: string) => {
    ctx.font = nameFont;
    const nameW = ctx.measureText(name).width;
    ctx.font = lineFont;
    const lineW = line ? ctx.measureText(line).width : 0;
    const [width, height] = [Math.ceil(Math.max(nameW, lineW) + flagW + 44), line ? 104 : 72];
    // A texture keeps the size it was first sent to the GPU at: a banner that grows or shrinks (a town's line coming
    // or going) needs a fresh one, or it draws squeezed into the old shape.
    if (width !== c.width || height !== c.height) texture.dispose();
    c.width = width;
    c.height = height;
    ctx.fillStyle = 'rgba(16, 24, 36, 0.66)';
    ctx.beginPath();
    ctx.roundRect(0, 4, c.width, c.height - 8, 12);
    ctx.fill();
    // The nation's flag, with a thin gilt frame.
    ctx.fillStyle = '#e6bf6a';
    ctx.fillRect(12, 14, flagW - 8 + 4, 42 + 4);
    ctx.drawImage(flag, 14, 16, flagW - 8, 42);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f7eedb';
    ctx.font = nameFont;
    ctx.fillText(name, flagW + 22, 38);
    if (line) {
      ctx.fillStyle = '#e6c98a';
      ctx.font = lineFont;
      ctx.fillText(line, flagW + 24, 78);
    }
    texture.needsUpdate = true;
    const h = (line ? 0.05 : 0.036) * size;
    sprite.scale.set((c.width / c.height) * h, h, 1);
  };
  draw('');
  return {
    sprite,
    setLine(line) {
      if (line === shown) return;
      shown = line;
      draw(line);
    },
    dispose() {
      texture.dispose();
      sprite.material.dispose();
    },
  };
}

/** A sprite animation name (`sail_full_beam_s`) as the builder's setting, point of sail, and wind side (+1 starboard). */
function sailsOf(anim: string): ['full' | 'half' | 'furled', string, number] {
  const [, setting, point, tack] = anim.split('_') as [string, 'full' | 'half' | 'furled', string?, string?];
  if (setting === 'furled') return ['furled', 'run', 0];
  return [setting, point ?? 'run', tack?.startsWith('s') ? 1 : tack?.startsWith('p') ? -1 : 0];
}

/** A soft cloud puff, drawn once into a canvas. */
function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  const blob = (x: number, y: number, r: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const [x, y, r] of [[80, 95, 55], [130, 75, 62], [180, 95, 50], [110, 110, 48], [160, 115, 44]] as const) blob(x, y, r);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
