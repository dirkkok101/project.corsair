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
  /** A pirate's temperament (combat.json tactics): how long the odds she takes, and how she fights. */
  temperament?: string;
  /** A pirate's nerve: her temperament's attack odds times this (below 1, she chances stronger ships). */
  nerve?: number;
  /** A convoy on her line's voyage (inbound to her port, then homeward to the Atlantic, where she leaves the map). */
  convoy?: { line: string; stage: 'inbound' | 'homeward' };
  /** She sailed from a plagued port, and may bring it to her next. */
  carries?: boolean;
  /** A patrol bound to blockade an enemy port; and, lying off it, the port she blockades (until `waitUntil`). */
  blockading?: string;
  blockadeOf?: string;
  /**
   * Ships she has taken and keeps in tow (a pirate): her hold adds theirs, she keeps their pace, and she sells
   * them at her haven after `sellAfter`. Take her, or a patrol beats her, and they are free again.
   */
  prizes?: Prize[];
  /**
   * Hove to and fighting another AI ship within the player's sight, until `until`: the player can watch,
   * or sail in and take a hand.
   */
  skirmish?: { with: string; until: number };
}

export interface Ship {
  id: string;
  classId: string;
  /** The player's flagship's name, when she was a prize (her class's name otherwise). */
  name?: string;
  /** The player's flagship sailing with a fleet: the slowest of its ships' speeds, which she keeps to. */
  fleetSpeed?: number;
  /** Position in map tiles; y grows southward. */
  x: number;
  y: number;
  /** Degrees clockwise from north, matching sprite facing f00. */
  headingDeg: number;
  /** Tiles per second. */
  speed: number;
  helm: Helm;
  sails: SailSetting;
  /**
   * Helm assist until the helm is used by hand: `beat` holds the best upwind course on a tack; `intercept`
   * steers to meet another ship (leading her by her course and speed); `course` sails to a point (x, y),
   * or to a port (`portId`) and ends there for docking. Both beat on `tack` when the way lies upwind.
   */
  assist?: {
    mode: 'beat' | 'intercept' | 'course';
    tack: Tack;
    targetId?: string;
    x?: number;
    y?: number;
    portId?: string;
    /** A course's waypoints still ahead (the sea lanes' way round the land), ending at (x, y). */
    route?: [number, number][];
    /** Ticks a course has been pressed against land; past a few seconds she gives the helm back. */
    aground?: number;
  };
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
  /** Units of her cargo, by good, that were taken as prizes: selling them goes into the plunder chest. */
  plunder?: Record<string, number>;
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

/**
 * A roaming weather system: a low turns the wind anticlockwise around it and blows fresh, a high turns it
 * clockwise and blows light. Its wind blends into the zones' trades, strongest at the centre.
 */
export interface WeatherSystem {
  id: string;
  kind: 'low' | 'high';
  x: number;
  y: number;
  radius: number;
  headingDeg: number;
  /** Tiles per game day. */
  speed: number;
  strength: WindStrength;
  startDay: number;
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
  /** Roaming weather systems (absent on saves from before them; they form over the first days). */
  systems?: WeatherSystem[];
  nextSystemId?: number;
}

export interface KnownPrices {
  /** Game day the prices were seen. */
  day: number;
  /** `depth`: units the market took before its sell price fell a quarter (absent in older saves). */
  prices: Record<string, { buy: number; sell: number; depth?: number }>;
}

/** A ship of the player's fleet other than her flagship: her own condition; her hold and men are the fleet's. */
/** A ship a pirate has taken: who from (a nation's, or the player's), what she was, and when she is sold. */
export interface Prize extends FleetShip {
  takenFrom: Nation | 'player';
  role: AiCaptain['role'];
  sellAfter: number;
}

/** A ship of the player's laid up in a port (retaken from pirates), to be taken back for `fee` gold. */
export interface LaidUpShip extends FleetShip {
  settlementId: string;
  fee: number;
}

export interface FleetShip {
  id: string;
  name: string;
  classId: string;
  hull: number;
  sailCondition: number;
  guns?: number;
  upgrades?: string[];
}

/** A port that lives (PRD section 6): its people, the gold its merchant has to buy with, and its trend. */
export interface TownState {
  people: number;
  cash: number;
  trend: -1 | 0 | 1;
  /** Enemy warships lie off it: little gets in. */
  blockaded?: boolean;
  /** Plague: the port is shut to shipping until this tick. */
  plague?: number;
}

/**
 * A governor's offer for goods his town is short of (a shortage or famine): the reward is paid, on top of
 * the sale, when `units` have been sold to the town's merchant; it lapses with the shortage at `endTick`.
 */
export interface Contract {
  id: string;
  settlementId: string;
  good: string;
  units: number;
  delivered: number;
  reward: number;
  endTick: number;
  /** The news of the shortage: where it has been heard, the contract is known. */
  newsId: string;
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
  /**
   * The crew's side (PRD section 4): the plunder chest they sail "on account" for (gold from prizes,
   * bounties and captured cargo sold; the captain's trade profit is `gold`), their morale 0 to 100, the
   * tick they were last paid (divided the plunder, or wages), and the share of a day's rations already
   * eaten. Absent on saves from before the crew slice.
   */
  chest?: number;
  morale?: number;
  paidTick?: number;
  mess?: number;
  /**
   * The rest of her fleet (PRD section 7): ships sailing with the flagship, off the map, following her. Their
   * holds and berths join the flagship's (cargo and crew are counted for the fleet as a whole); only the
   * flagship fights; the fleet keeps the pace of its slowest ship (the flagship's `fleetSpeed`).
   */
  fleet?: FleetShip[];
  /** Ships of the player's freed from pirates, waiting in port to be taken back. */
  laidUp?: LaidUpShip[];
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
  /** After a sinking: the gold from barrels and the men out of the water the player picked up. */
  salvage?: { gold: number; men: number };
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
  /** News of a ship changing hands: the ship taken, sold or freed ("brig Swallow"). */
  vessel?: string;
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
  /** Each port's people, its merchant's purse, and whether it is growing (+1), steady (0) or shrinking (-1). */
  towns?: Record<string, TownState>;
  captain?: Captain;
  /** Market shocks in force; saves from before shocks existed have none. */
  shocks?: Shock[];
  contracts?: Contract[];
  news?: NewsItem[];
  /** Counter for shock and news ids. */
  nextNewsId?: number;
  /** Counter for AI ship ids. */
  nextShipId?: number;
  politics?: Politics;
  /**
   * A ship just taken, waiting on the captain's word (TakePlunder): her cargo to choose from, the men
   * who would sign on, and whether she was carried by boarding or struck.
   */
  prize?: { ship: Ship; volunteers: number };
}

export type Command =
  | { type: 'SetHelm'; shipId: string; helm: Helm }
  | { type: 'SetSails'; shipId: string; sails: SailSetting }
  /** Tacking aid: `beat` holds the best upwind course on the current tack, `tack` comes about onto the other. */
  | {
      type: 'SetAssist';
      shipId: string;
      assist: 'beat' | 'tack' | 'off' | 'intercept' | 'course';
      targetId?: string;
      x?: number;
      y?: number;
      portId?: string;
      route?: [number, number][];
    }
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
  /**
   * The plunder screen's word on the prize: goods to take from her, the player's own goods to throw over
   * to make room, whether the volunteers sign on, and whether she is let go (else she is sunk).
   */
  | {
      type: 'TakePlunder';
      shipId: string;
      take: Record<string, number>;
      jettison?: Record<string, number>;
      volunteers: boolean;
      release: boolean;
      /** Keep her: she joins the fleet (needs room in the fleet and men to sail her). */
      keep?: boolean;
    }
  /** At the shipwright: sell a ship of the fleet, or make one the flagship. */
  | { type: 'SellShip'; shipId: string; fleetId: string }
  | { type: 'MakeFlagship'; shipId: string; fleetId: string }
  /** Buy a new ship of a class the port's shipwright builds; she joins the fleet. */
  | { type: 'BuyShip'; shipId: string; classId: string }
  /** Take back a ship of the player's laid up in this port. */
  | { type: 'ReclaimShip'; shipId: string; laidUpId: string }
  /** In port: sign on men in the tavern, or pay the shipwright to make good hull and sails. */
  | { type: 'Recruit'; shipId: string; count: number }
  | { type: 'Repair'; shipId: string }
  /** At the shipwright: mount or sell back cannon, or install an upgrade. */
  | { type: 'BuyGuns'; shipId: string; count: number }
  | { type: 'SellGuns'; shipId: string; count: number }
  | { type: 'BuyUpgrade'; shipId: string; upgradeId: string }
  /** At the tavern: divide the plunder chest with the crew, or pay them wages from the captain's purse. */
  | { type: 'DividePlunder'; shipId: string }
  | { type: 'PayWages'; shipId: string }
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
  | { type: 'SpawnShock'; settlementId: string; good: string; kind: string }
  | { type: 'SpawnPlague'; settlementId: string };

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
