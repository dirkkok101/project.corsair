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
export type CrewGrade = 'green' | 'regular' | 'seasoned' | 'veteran';
export interface CaptainSkills {
  gunnery: number;
  seamanship: number;
  boarding: number;
  resolve: number;
}

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
  /** A hunter staged for the player to come upon (traffic.json encounters): her fight plays out, though it begins out of sight. */
  staged?: boolean;
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
  /** Lying off it, the two ends of her beat across its approach. */
  beat?: [[number, number], [number, number]];
  /**
   * Ships she has taken and keeps in tow (a pirate): her hold adds theirs, she keeps their pace, and she sells
   * them at her haven after `sellAfter`. Take her, or a patrol beats her, and they are free again.
   */
  prizes?: Prize[];
  /** One of the famous pirates (pirates.json id): her wealth and fate are kept in `WorldState.famous`. */
  famous?: string;
  /** The quarry of a governor's mission (its id): kept on the sea until it is done or lapses. */
  mission?: string;
  /**
   * The First Voyage's own ships: the pirate harrying a fishing boat off the cay (`harry`, the boat's id), meek in
   * battle (she strikes once beaten; never boards, flees or sinks), and the boat, which is `freed` once she is
   * taken (and sails home by the lanes, an ordinary ship again). Neither hunts or is hunted meanwhile.
   */
  voyage?: { harry?: string; meek?: boolean; freed?: boolean };
  /** Ports whose waters she keeps to (a mission's quarry), as a famous pirate keeps to her haunts. */
  haunts?: string[];
  /** Her crew's grade (combat.json crewQuality); regular when unset. */
  crew?: CrewGrade;
  /** Her captain's skills, 0 to 100 (50 when unset): gunnery, seamanship, boarding, and resolve (how long she holds out). */
  captain?: CaptainSkills;
  /** Her own way with her guns, over her role's (a famous pirate's). */
  doctrine?: 'round' | 'chain' | 'pirate';
  /** Her name's terror: she calls on a beaten captain to strike this many times as readily. */
  terror?: number;
  /**
   * Hove to and fighting another AI ship within the player's sight, until `until`: the player can watch,
   * or sail in and take a hand.
   */
  skirmish?: {
    with: string;
    until: number;
    /** When it began, how she stood then, and her foe's share of their strength: she wears down by it as it goes. */
    from?: number;
    start?: { hull: number; sails: number; crew: number };
    foeShare?: number;
  };
}

export interface Ship {
  id: string;
  classId: string;
  /** The player's choice to sail with the gentle wind (navigation.json gentleWind): any heading, and a calm, still make way. */
  gentleWind?: boolean;
  /** Her bottom's fouling: the share of her speed it costs (economy.json fouling), cleaned by careening. */
  fouling?: number;
  /** Hove down on a beach until this tick (a careen): out of the water, her bottom gathers nothing. */
  hoveDownUntil?: number;
  /** Fine-grain powder aboard keeps till this tick, then it is spent. */
  powderUntil?: number;
  /** The player's flagship's name: the career's first ship's, or a prize's (her class's name when unset). */
  name?: string;
  /** The player's flagship taken as a prize: her papers, kept when the flag shifts. */
  prize?: PrizePapers;
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
    /** Where this leg of the course began (her last waypoint, or where it was set): beating keeps near the leg. */
    from?: [number, number];
    /** Her boats are towing her in: her berth lies upwind in the harbour, where she can't beat (navigation.json course). */
    towing?: boolean;
    /** An intercept has come up alongside her quarry (said once, until they draw apart). */
    alongside?: boolean;
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
  /** The player's men hurt in a fight: off the crew until they mend, a few each day at sea. */
  wounded?: number;
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
  /** A ship taken in a fight: whose she was, and her papers (absent for a ship bought at a yard). */
  prize?: PrizePapers;
}

/**
 * A prize's papers, stamped when she is taken and kept: whose she was, and the nation whose ports condemn her as a
 * lawful prize (she was taken under its letter of marque). A later peace doesn't undo them. Without papers a
 * shipwright pays little for her, more at a pirate haven, which no nation likes.
 */
export interface PrizePapers {
  from: Nation;
  lawful?: Nation;
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
  /** Men looking for a berth here, as last counted at `handsTick` (they come back over the week; absent: all). */
  hands?: number;
  handsTick?: number;
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

/**
 * A governor's mission the captain took (docs/design/governor-missions.md): hunt a named pirate, or carry a
 * letter to another governor and bring his reply. Done, the governor who gave it pays `reward` into the chest
 * and `merit` with his nation; not done by `endTick`, it lapses with no penalty.
 */
export interface Mission {
  id: string;
  kind: 'hunt' | 'courier';
  /** The governor who gave it (settlement id), and his nation. */
  from: string;
  nation: Nation;
  /** Hunt: the port whose waters the quarry haunts. Courier: the town the letter goes to. */
  to: string;
  /** Hunt: the quarry, her ship id while she is afloat, her class and name. */
  target?: string;
  classId?: string;
  name?: string;
  reward: number;
  merit: number;
  tick: number;
  endTick: number;
  /** Courier: the letter given at `to`, his reply to carry back. */
  delivered?: number;
  /** Done (the quarry beaten, or the reply brought home): waiting for the governor at `from` to pay. */
  done?: number;
  /** Courier: gold already paid on delivery (politics.json missions.courier.advance); the rest is owed on return. */
  paid?: number;
}

/** What the captain has done, kept as she goes (the Goals page in the log reads it). */
export interface CareerRecord {
  /** Gold made selling trade goods, over what they cost (plunder's sale goes to the chest, not here). */
  tradeProfit?: number;
  /** Ships taken (struck or boarded). */
  prizes?: number;
  /** Pirates beaten (taken or sunk), by their class. */
  beaten?: Record<string, number>;
  /** Famous pirates beaten by her. */
  famousBeaten?: number;
}

export interface Captain {
  gold: number;
  /** The pirate coves she has found (havens drawn per career are hidden until found; absent in older saves: none). */
  knownHavens?: string[];
  /** The flag the career sails under, chosen at its start (absent in older saves: none). */
  nation?: Nation;
  /** Prices the captain last saw in each port, so routes can be planned from memory. */
  knownPrices: Record<string, KnownPrices>;
  /** Ids of news items the captain has heard (in a tavern), oldest first. */
  heard?: string[];
  /** The tick of his last call on each town's governor (by settlement id), so the governor says what happened since. */
  calledOn?: Record<string, number>;
  /** The captain's log (storyboard 6.1): his deeds and the news he has heard, oldest first, the last 200. */
  logbook?: LogEntry[];
  /** Where each AI ship was last seen from the player's deck, for the chart's fading markers. */
  sightings?: Record<string, Sighting>;
  /** The famous pirates (pirates.json ids) the captain has ever had in sight, first seen first. */
  famousSeen?: string[];
  /** Standing with each nation, -100 to 100 (0 when absent): attacking its ships lowers it. */
  standing?: Partial<Record<Nation, number>>;
  /** Merit with each nation: a point for each deed its governors paid a bounty for (more for a famous pirate); it raises his rank there. */
  merit?: Partial<Record<Nation, number>>;
  /** He retired (in port): when, his score, and what became of him. The career is over. */
  retired?: { tick: number; score: number; fate: string };
  /** The career so far, for the captain's goals: gold made trading, prizes taken, pirates beaten by class, famous pirates beaten. */
  record?: CareerRecord;
  /** Pieces of each famous pirate's hoard map held (by her id): keepsakes, never sold. */
  mapPieces?: Record<string, number>;
  /** The tavern strangers' offers already bought from (`town:week`). */
  strangerDeals?: string[];
  /** The governors' missions taken and not yet paid for, and the offers already taken (`town:week`). */
  missions?: Mission[];
  missionDeals?: string[];
  /** Food bought from each ship spoken at sea (by her id): she has only so much to spare. */
  provisionsFrom?: Record<string, number>;
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
  /** Days in a row the crew has gone without food (none: fed). */
  hungry?: number;
  /**
   * The rest of her fleet (PRD section 7): ships sailing with the flagship, off the map, following her. Their
   * holds and berths join the flagship's (cargo and crew are counted for the fleet as a whole); only the
   * flagship fights; the fleet keeps the pace of its slowest ship (the flagship's `fleetSpeed`).
   */
  fleet?: FleetShip[];
  /** Ships of the player's freed from pirates, waiting in port to be taken back. */
  laidUp?: LaidUpShip[];
  /** Her deeds said out loud (docs/design/first-voyage.md): each achievement once, oldest first, the last 200. */
  honours?: Honour[];
  /** The career's goals done (careerGoals ids, sorted), so a goal newly done is said once; absent until first seen. */
  goalsDone?: string[];
  /** The First Voyage, while she sails it (docs/design/first-voyage.md); absent: a veteran's career, nothing guided. */
  voyage?: Voyage;
}

/**
 * The First Voyage: the chapter she is in (in port before the first sailing, at the helm bound for the cay, the
 * salvage, the first prize, home with it, the governor), the cay a storm wrecked a sloop on, and what she has been
 * taught.
 */
export interface Voyage {
  step: 'harbour' | 'helm' | 'salvage' | 'prize' | 'home' | 'governor' | 'done';
  /** The wreck's place (water, off the cay's shore), its name, and its bearing and distance from the home berth. */
  cay: { x: number; y: number; name: string; bearing: string; tiles: number };
  /** The home capital she sails from and returns to. */
  home: string;
  /** The lessons she has been shown (steer, sail, wind, ...). */
  lessons?: string[];
  /** The pirate of the first prize, once she is on the sea: her ship's id and her name. */
  pirateId?: string;
  pirate?: string;
  /** The fishing boat she harries. */
  boatId?: string;
  /** Home with her prize, in port: the chores before the governor (sold, battery, shared, in `lessons`). */
  ashore?: boolean;
  /** The commission she chose from the governor's three: her first on her own. */
  commission?: 'courier' | 'trade' | 'hunt';
}

/** A deed said out loud: what kind, what she did (past tense), the one figure and where it went, up to two lines. */
export interface Honour {
  /** Unique: a first ('first:sale'), a goal ('goal:guns'), a mission leg ('letter:<mission id>'), else kind and tick. */
  id: string;
  kind: 'first' | 'goal' | 'mission' | 'bounty' | 'trade' | 'marque' | 'rank' | 'hoard' | 'contract';
  title: string;
  tick: number;
  gold?: number;
  /** Where the gold went: her purse, the crew's chest, owed her by a governor, or a sale's profit. */
  into?: 'purse' | 'chest' | 'owed' | 'profit';
  lines?: string[];
  place?: string;
  /** The nation whose merit it raised, for the bar to her next rank there. */
  nation?: Nation;
  /** The career goal it marks done (careerGoals id). */
  goal?: string;
}

/** One line in the captain's log: a deed of his (a loss among them), or news heard, with where it was. */
export interface LogEntry {
  tick: number;
  kind: 'deed' | 'loss' | 'news';
  text: string;
  /** The settlement it happened at or is about. */
  place?: string;
  /** A sale: what was sold, so lots of one good sold in one port on one day add up to one line. */
  sale?: { good: string; quantity: number; gold: number; profit?: number };
}

/** A ship the player sank or took, waiting for a governor's bounty. */
export interface Deed {
  nation: Nation;
  role: AiCaptain['role'];
  kind: 'sunk' | 'taken';
  tick: number;
  /** A famous pirate (pirates.json id) held prisoner for this bounty: she sails again only once handed over. */
  captive?: string;
  /** A blockader beaten off a port of this nation: its governors pay politics.json bounty.blockade more for it. */
  relieved?: Nation;
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
   * drew clear. lost: the player was beaten, boarded or sinking, and struck to her. yielded: the player struck her
   * colours when a famous pirate called on her to (she keeps her ship and men, and gives up the chest and the hold).
   */
  outcome: 'sunk' | 'struck' | 'boarded' | 'escaped' | 'fled' | 'lost' | 'yielded';
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
  /** News of a famous pirate's deed: her name. */
  captain?: string;
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
  /** The career's difficulty level (combat.json difficulty levels), picked at its start; the default when unset. */
  difficulty?: string;
  /** Market shocks in force; saves from before shocks existed have none. */
  shocks?: Shock[];
  contracts?: Contract[];
  news?: NewsItem[];
  /** Counter for shock and news ids. */
  nextNewsId?: number;
  /** Counter for AI ship ids. */
  nextShipId?: number;
  /** When the player last saw two other ships fight (a quiet sea stages one in her sight, traffic.json encounters). */
  fightSeenAt?: number;
  politics?: Politics;
  /**
   * A ship just taken, waiting on the captain's word (TakePlunder): her cargo to choose from, the men
   * who would sign on, and whether she was carried by boarding or struck.
   */
  prize?: { ship: Ship; volunteers: number; captive?: string };
  /** The famous pirates (pirates.json) by id: their wealth, and when one beaten sails again. */
  famous?: Record<string, FamousPirate>;
}

export interface FamousPirate {
  /** Gold to her name, which ranks her on the Top Ten. */
  wealth: number;
  /** Beaten and lying low: she sails again in a new ship from this tick. */
  returnAt?: number;
  /** Times she has been beaten. */
  defeats?: number;
  /** Set free by the captain: she leaves her be, until the captain attacks her. */
  spared?: boolean;
  /** Her buried hoard, placed when the captain gets the first piece of its map. */
  hoard?: Hoard;
  /** The captain dug up her hoard before ever beating her: she hunts the captain, at any odds, until beaten. */
  revenge?: boolean;
  /** She swore to take the captain once her fame grew (pirates.json huntFame): hunting her as for revenge; once only. */
  sworn?: boolean;
  /** Her haven this career, where the havens are drawn per career (absent: pirates.json's own). */
  haven?: string;
}

/** A famous pirate's buried hoard (treasure.json): where it lies, what marks it, and what it holds. */
export interface Hoard {
  /** The spot (tile coordinates, the tile's centre). */
  x: number;
  y: number;
  /** Water off the coast there: where a ship sails to look for it. */
  landing: [number, number];
  landmark: string;
  /** Gold buried. */
  value: number;
  /** The widest search ring's centre, off the spot; the ring closes on the spot as pieces come in. */
  dx: number;
  dy: number;
  /** The port the coast lies nearest, which the first piece names. */
  near: string;
  /** Dug up already (slice 4). */
  found?: boolean;
}

export type Command =
  | { type: 'SetHelm'; shipId: string; helm: Helm }
  | { type: 'SetSails'; shipId: string; sails: SailSetting }
  /** The gentle wind on or off for her (the player's setting). */
  | { type: 'SetGentleWind'; shipId: string; on: boolean }
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
      /** A famous pirate taken prisoner: ask her for a piece of her hoard's map, hold her for a bounty, or set her free (the default). */
      captive?: 'hoard' | 'bounty' | 'free';
    }
  /** Go ashore on the nearest beach and dig for a hoard whose map the captain holds a piece of. */
  | { type: 'Dig'; shipId: string }
  /** The First Voyage: take off what the storm left on the cay's wreck. */
  | { type: 'Salvage'; shipId: string }
  /** In a tavern: buy the piece of a famous pirate's map the shady stranger offers this week. */
  | { type: 'BuyMapPiece'; shipId: string; pirateId: string }
  /** At the shipwright: sell a ship of the fleet, or make one the flagship. */
  | { type: 'SellShip'; shipId: string; fleetId: string }
  | { type: 'MakeFlagship'; shipId: string; fleetId: string }
  /** Buy a new ship of a class the port's shipwright builds; she joins the fleet. */
  | { type: 'BuyShip'; shipId: string; classId: string }
  /** Take back a ship of the player's laid up in this port. */
  | { type: 'ReclaimShip'; shipId: string; laidUpId: string }
  /** In port: sign on men in the tavern, or pay the shipwright to make good hull and sails. */
  /** `shares`: for a share of the plunder instead of a bounty, only when her gold won't pay for the men (crew.json shares). */
  | { type: 'Recruit'; shipId: string; count: number; shares?: boolean }
  /** Mend the fleet at the shipwright: one ship (`fleetId` a fleet ship's id, or `shipId` for the flagship), or all. */
  | { type: 'Repair'; shipId: string; only?: string }
  /** At the shipwright: mount or sell back cannon, or install an upgrade. */
  | { type: 'BuyGuns'; shipId: string; count: number; only?: string }
  | { type: 'SellGuns'; shipId: string; count: number; only?: string }
  | { type: 'BuyUpgrade'; shipId: string; upgradeId: string; only?: string }
  /** Clean her foul bottom: at a shipwright (gold), or on a beach nearby (`beach`: days of her time, no gold). */
  | { type: 'Careen'; shipId: string; beach?: boolean }
  /** At the tavern: divide the plunder chest with the crew, or pay them wages from the captain's purse. */
  | { type: 'DividePlunder'; shipId: string }
  /** Retire in port: the career is scored (politics.json career) and over. */
  | { type: 'Retire'; shipId: string }
  | { type: 'PayWages'; shipId: string }
  /** Debug: put two nations at war or at peace now. */
  | { type: 'SetRelation'; a: Nation; b: Nation; war: boolean }
  /** At a governor: buy a letter of marque from his nation, or collect bounties owed for deeds. */
  | { type: 'BuyMarque'; shipId: string }
  | { type: 'CollectBounties'; shipId: string }
  /** At a governor: take the mission he offers this week. */
  /** Take the governor's mission this week; `kind` asks for one of that kind (the First Voyage's commissions). */
  | { type: 'AcceptMission'; shipId: string; kind?: 'hunt' | 'courier' }
  /** The First Voyage: the governor's free letter of marque, and the commission she chooses (which ends the voyage). */
  | { type: 'VoyageMarque'; shipId: string }
  | { type: 'ChooseCommission'; shipId: string; kind: 'courier' | 'trade' | 'hunt' }
  /** The First Voyage given up (the quartermaster sent ashore): every port open, no one at her elbow. */
  | { type: 'SkipVoyage'; shipId: string }
  /** Speak an AI ship within hailing range: learn who it is and hear its news. */
  | { type: 'Hail'; shipId: string; targetId: string }
  /** Buy provisions from a ship spoken at sea (her spare stores, dear): up to `units` of food. */
  | { type: 'BuyProvisions'; shipId: string; targetId: string; units: number }
  /** Debug: start an AI ship of a role at a port, bound for another. */
  | { type: 'SpawnShip'; role: AiCaptain['role']; from: string; to: string }
  /** The captain listens in the tavern of the port the ship is docked at. */
  /** Hear the news this port has (in its tavern), or only the one item `id` (read in a letter). */
  | { type: 'HearNews'; shipId: string; id?: string }
  | { type: 'CallOnGovernor'; shipId: string }
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
