import type { RngState } from './rng';

export type WindStrength = 'calm' | 'light' | 'fresh' | 'strong' | 'gale';

/** Helm: -1 = turn to port (anticlockwise), 0 = hold course, 1 = turn to starboard. */
export type Helm = -1 | 0 | 1;

/** How much canvas is set (PRD section 4 sail state). */
export type SailSetting = 'furled' | 'half' | 'full';

/** Which side the wind comes over: starboard tack has it on the starboard (right) side. */
export type Tack = 'port' | 'starboard';

export interface Wind {
  /** Direction the wind blows FROM, degrees clockwise from north (sailing convention). */
  fromDeg: number;
  strength: WindStrength;
}

export type Nation = 'spain' | 'england' | 'france' | 'netherlands' | 'pirate';

/**
 * An AI captain's orders (PRD sections 6 and 4): merchants carry goods between ports, patrols sail
 * between their nation's ports, pirates work out of the havens. They follow a sea lane (`route`,
 * waypoints in tiles) rather than steering by hand; the traffic system moves them.
 */
export interface AiCaptain {
  nation: Nation;
  role: 'merchant' | 'patrol' | 'pirate';
  name: string;
  /** Settlement ids: where it last called, and where it is bound. */
  from: string;
  to: string;
  route: [number, number][];
  /** Tiles travelled along the route. */
  along: number;
  /** Tacking: tiles off the lane (positive to starboard of it), and which way it is heading now. */
  offset: number;
  tackSign: 1 | -1;
  /** In port until this tick, then it sails. */
  waitUntil?: number;
  /** News ids it picked up in its last port, to pass on when hailed. */
  news: string[];
  /** Gold aboard, which a ship that strikes her colours gives up. */
  purse?: number;
  /** Chasing the player: a pirate (or a hostile nation's patrol) that sighted them. */
  chasing?: boolean;
  /** No chase before this tick: a ship that just fought or lost the player leaves them be a while. */
  calmUntil?: number;
  /** An AI ship being hunted (another AI ship; the player is hunted through `chasing`). */
  target?: string;
}

export interface Ship {
  id: string;
  classId: string;
  /** Position in map tiles; y grows southward. */
  x: number;
  y: number;
  /** Degrees clockwise from north, matching sprite facing f00. */
  headingDeg: number;
  /** Tiles per second. */
  speed: number;
  helm: Helm;
  sails: SailSetting;
  /** Helm assist: hold the best upwind course on a tack until the helm is used by hand. */
  assist?: { mode: 'beat'; tack: Tack };
  /** Units of each good in the hold. */
  cargo: Record<string, number>;
  /** Gold paid for the units of each good now in the hold, so the merchant can show the margin. */
  paid?: Record<string, number>;
  /**
   * Condition (PRD section 7, per-ship state): hull points, sails 0 to 100, and men aboard. Absent on
   * saves from before battles, which read as a sound ship (class hull, full sails) with its usual crew.
   */
  hull?: number;
  sailCondition?: number;
  crew?: number;
  /** Outfitting (PRD section 7): guns mounted, absent meaning her class's full battery (AI ships, and
   * saves from before outfitting); and the shipwright's upgrades installed, by id. */
  guns?: number;
  upgrades?: string[];
  /** Set on AI ships; the player's ship has none. */
  ai?: AiCaptain;
  /** Settlement id while the ship is in port; it doesn't sail until it undocks. */
  docked?: string;
  /** True while the ship is pressed against land, so ShipBlocked fires once per contact. */
  blocked: boolean;
}

/** A tropical storm or hurricane: a moving circle of violent wind (PRD section 3). Tile units. */
export interface Storm {
  id: string;
  x: number;
  y: number;
  radius: number;
  headingDeg: number;
  /** Tiles per game day. */
  speed: number;
  endDay: number;
}

export interface ZoneWeather {
  fromDeg: number;
  strength: WindStrength;
  /** A zone event (a norther, a calm) overrides the seasonal wind until endDay. */
  event?: { id: string; endDay: number; variable?: boolean };
}

export interface WeatherState {
  /** Current wind per wind zone id. */
  zones: Record<string, ZoneWeather>;
  storms: Storm[];
  nextStormId: number;
}

export interface KnownPrices {
  /** Game day the prices were seen. */
  day: number;
  /** `depth`: units the market took before its sell price fell a quarter (absent in older saves). */
  prices: Record<string, { buy: number; sell: number; depth?: number }>;
}

export interface Captain {
  gold: number;
  /** Prices the captain last saw in each port, so routes can be planned from memory. */
  knownPrices: Record<string, KnownPrices>;
  /** Ids of news items the captain has heard (in a tavern), oldest first. */
  heard?: string[];
  /** Where each AI ship was last seen from the player's deck, for the chart's fading markers. */
  sightings?: Record<string, Sighting>;
  /** Standing with each nation, -100 to 100 (0 when absent): attacking its ships lowers it. */
  standing?: Partial<Record<Nation, number>>;
  /** Nations whose letter of marque the captain holds; each covers whoever that nation is at war with now. */
  marques?: Nation[];
  /** Ships sunk or taken and not yet paid for by a governor (PRD section 12: bounties). */
  deeds?: Deed[];
}

/** A ship the player sank or took, waiting for a governor's bounty. */
export interface Deed {
  nation: Nation;
  role: AiCaptain['role'];
  kind: 'sunk' | 'taken';
  tick: number;
}

/**
 * The nations' relations (PRD section 12): each pair at war or peace with a tension 0 to 100, and
 * each nation's pirate pressure (how hard pirates are hitting its shipping). Pairs are keyed by the
 * two nations in alphabetical order, as `england:spain`.
 */
export interface Politics {
  relations: Record<string, { war: boolean; tension: number }>;
  piracy: Partial<Record<Nation, number>>;
  /** The month the politics tick last ran, as months since the career's start date. */
  month: number;
}

/** How a sea battle ended, and what each side came out of it with (PRD section 9.1). */
export interface BattleResult {
  /**
   * sunk: the enemy went down with her cargo. struck: she hauled down her colours. boarded: the player
   * carried her by boarding. escaped: she drew clear (or the fight ran out of time). fled: the player
   * drew clear. lost: the player was beaten, boarded or sinking, and struck to her.
   */
  outcome: 'sunk' | 'struck' | 'boarded' | 'escaped' | 'fled' | 'lost';
  /** Each side's state at the end. The fight is virtual: both ships stay where they met on the world map. */
  player: BattleEnd;
  enemy: BattleEnd;
}

export interface BattleEnd {
  hull: number;
  sailCondition: number;
  crew: number;
  /** Guns still mounted: a gun knocked out in the fight stays lost until the shipwright replaces it. */
  guns: number;
}

export interface Sighting {
  x: number;
  y: number;
  tick: number;
  classId: string;
  nation: Nation;
}

/** A market shock (PRD section 6): a glut, blight, shortage or storm damage at one town, for some weeks. */
export interface Shock {
  id: string;
  kind: string;
  settlementId: string;
  good: string;
  startTick: number;
  endTick: number;
}

/**
 * A world fact turned news (PRD section 13). It is known at its town at once and reaches others
 * by distance at the news speed, plus `delayDays`; arrival is computed, never stored per town.
 */
export interface NewsItem {
  id: string;
  tick: number;
  settlementId: string;
  kind: string;
  good: string;
  delayDays: number;
  /** News of a fight: the ship it was about, and her flag. */
  ship?: string;
  nation?: Nation;
  /** News of war or peace, or of a fight between ships: the other nation. */
  other?: Nation;
}

export interface WorldState {
  tick: number;
  /** Fallback wind where no weather system runs (the test maps). */
  wind: Wind;
  ships: Record<string, Ship>;
  weather?: WeatherState;
  /** Named RNG streams, one per system, so one system's draws never shift another's. */
  rng?: Record<string, RngState>;
  /** Stock of each good in each settlement's market (PRD section 6). */
  markets?: Record<string, Record<string, number>>;
  captain?: Captain;
  /** Market shocks in force; saves from before shocks existed have none. */
  shocks?: Shock[];
  news?: NewsItem[];
  /** Counter for shock and news ids. */
  nextNewsId?: number;
  /** Counter for AI ship ids. */
  nextShipId?: number;
  politics?: Politics;
}

export type Command =
  | { type: 'SetHelm'; shipId: string; helm: Helm }
  | { type: 'SetSails'; shipId: string; sails: SailSetting }
  /** Tacking aid: `beat` holds the best upwind course on the current tack, `tack` comes about onto the other. */
  | { type: 'SetAssist'; shipId: string; assist: 'beat' | 'tack' | 'off' }
  | { type: 'SetWind'; fromDeg: number; strength: WindStrength }
  /** Debug: start a storm centred on a tile. */
  | { type: 'SpawnStorm'; x: number; y: number }
  /** Debug: move a ship to a tile (stopped), for tests and trying things out. */
  | { type: 'Teleport'; shipId: string; x: number; y: number }
  | { type: 'Dock'; shipId: string; settlementId: string }
  | { type: 'Undock'; shipId: string }
  | { type: 'Buy'; shipId: string; good: string; quantity: number }
  | { type: 'Sell'; shipId: string; good: string; quantity: number }
  /** Open fire on an AI ship within hailing range: starts a sea battle. */
  | { type: 'Attack'; shipId: string; targetId: string }
  /** A sea battle is over: its result (from the battle minigame) applied to the world. */
  | { type: 'BattleEnded'; shipId: string; targetId: string; result: BattleResult }
  /** In port: sign on men in the tavern, or pay the shipwright to make good hull and sails. */
  | { type: 'Recruit'; shipId: string; count: number }
  | { type: 'Repair'; shipId: string }
  /** At the shipwright: mount or sell back cannon, or install an upgrade. */
  | { type: 'BuyGuns'; shipId: string; count: number }
  | { type: 'SellGuns'; shipId: string; count: number }
  | { type: 'BuyUpgrade'; shipId: string; upgradeId: string }
  /** Debug: put two nations at war or at peace now. */
  | { type: 'SetRelation'; a: Nation; b: Nation; war: boolean }
  /** At a governor: buy a letter of marque from his nation, or collect bounties owed for deeds. */
  | { type: 'BuyMarque'; shipId: string }
  | { type: 'CollectBounties'; shipId: string }
  /** Speak an AI ship within hailing range: learn who it is and hear its news. */
  | { type: 'Hail'; shipId: string; targetId: string }
  /** Debug: start an AI ship of a role at a port, bound for another. */
  | { type: 'SpawnShip'; role: AiCaptain['role']; from: string; to: string }
  /** The captain listens in the tavern of the port the ship is docked at. */
  | { type: 'HearNews'; shipId: string }
  /** Debug: start a market shock now. */
  | { type: 'SpawnShock'; settlementId: string; good: string; kind: string };

export interface GameEvent {
  tick: number;
  type: string;
  system: string;
  entityIds: string[];
  payload: Record<string, unknown>;
}

/** An AI ship lying in port: waiting, with no route out yet. Inside the harbour, not on the sea map. */
export function inPort(ship: Ship): boolean {
  return ship.ai?.waitUntil !== undefined && !ship.ai.route.length;
}
