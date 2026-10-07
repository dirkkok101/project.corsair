import { z } from 'zod';

const windStrength = z.enum(['calm', 'light', 'fresh', 'strong', 'gale']);
const rig = z.enum(['square', 'mixed', 'fore_and_aft']);
const degrees = z.number().min(0).lt(360);

export const shipClassSchema = z.object({
  id: z.string(),
  family: z.string(),
  rig,
  speed: z.number().min(1).max(10),
  turn: z.number().min(1).max(10),
  draft: z.number(),
  hull: z.number(),
  /** Hold capacity in units of cargo. */
  cargo: z.number().int().positive(),
  /** Guns, split evenly between the two broadsides. */
  guns: z.number().int().min(0),
  /** Fewest men to sail her, and the most she berths. */
  minCrew: z.number().int().positive(),
  maxCrew: z.number().int().positive(),
  polar: z.string(),
  sprites: z.object({ world: z.string(), combat: z.string().optional() }),
});

export const polarSchema = z
  .object({
    stepDeg: z.number().positive(),
    values: z.array(z.number().min(0).max(1.5)).min(2),
  })
  .refine((p) => p.stepDeg * (p.values.length - 1) === 180, 'polar must span 0 to 180 degrees');

export const navigationSchema = z.object({
  tilesPerSecondPerSpeedPoint: z.number().positive(),
  turnDegPerSecondPerPoint: z.number().positive(),
  accelPerSecond: z.number().positive(),
  /** How fast a ship loses way toward a lower speed (as through a tack); accelPerSecond when unset. */
  decelPerSecond: z.number().positive().optional(),
  sailSettings: z.record(z.enum(['furled', 'half', 'full']), z.number().min(0).max(1)),
  rigTurnFactor: z.record(rig, z.number().positive()),
  windStrength: z.record(windStrength, z.number().min(0)),
  // Ids name the sprite states too (art pipeline section 4), so they are a closed set.
  pointsOfSail: z
    .array(z.object({ id: z.enum(['irons', 'close', 'beam', 'broad', 'run']), maxDeg: z.number(), name: z.string() }))
    .min(1),
});

export const spriteSchema = z.object({
  cell: z.number().int().positive(),
  facings: z.number().int().positive(),
  pivot: z.object({ x: z.number(), y: z.number() }),
  anims: z.array(z.string()).min(1),
  /** Ships: the masthead the flag streams from, in model units (forward of the pivot, up from the waterline). */
  mast: z.object({ forward: z.number(), up: z.number() }).optional(),
});

/** The player's ship at the start of a career: her class, guns mounted (her class's full battery when
 * unset), and the port she starts docked in (at sea when unset). */
const shipStart = {
  shipId: z.string(),
  classId: z.string(),
  headingDeg: degrees,
  guns: z.number().int().min(0).optional(),
  port: z.string().optional(),
};
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const month = z.number().int().min(1).max(12);
const range = z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, 'range must be [min, max]');
const weights = z
  .record(windStrength, z.number().min(0))
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-3, 'strength weights must sum to 1');

/** A small hand-placed map built from island circles; used by tests. */
export const proceduralMapSchema = z.object({
  id: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileSize: z.number().int().positive(),
  shallowsTiles: z.number().int().min(0),
  islands: z.array(z.object({ x: z.number(), y: z.number(), r: z.number().positive() })),
  start: z.object({ ...shipStart, x: z.number(), y: z.number() }),
  wind: z.object({ fromDeg: degrees, strength: windStrength }),
});

/** A map whose layers are PNGs built from real geography (tools/map/build-caribbean.ts). */
export const rasterMapSchema = z.object({
  id: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileSize: z.number().int().positive(),
  bounds: z.object({ lonMin: z.number(), lonMax: z.number(), latMin: z.number(), latMax: z.number() }),
  layers: z.object({ terrain: z.string(), elevation: z.string(), zones: z.string() }),
  start: z.object({ ...shipStart, lon: z.number(), lat: z.number() }),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Hour of the start day the game opens at, so a new career begins in daylight. */
  startHour: z.number().min(0).lt(24),
  wind: z.object({ fromDeg: degrees, strength: windStrength }),
});

export const settlementSchema = z.object({
  id: z.string(),
  name: z.string(),
  nation: z.enum(['spain', 'england', 'france', 'netherlands', 'pirate']),
  type: z.enum(['capital', 'town', 'haven', 'mission', 'village']),
  size: z.enum(['hamlet', 'town', 'city']),
  lon: z.number(),
  lat: z.number(),
});

const seasonWind = z.object({ fromDeg: degrees, spreadDeg: z.number().min(0).max(180), strength: weights });

export const windZonesSchema = z.object({
  defaultZone: z.string(),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      polygon: z.array(lonLat).min(4),
      // PRD section 3 seasons: dry is December to May, wet (hurricane) is June to November.
      seasons: z.object({ dry: seasonWind, wet: seasonWind }),
      events: z
        .array(
          z.object({
            id: z.string(),
            months: z.array(month).min(1),
            chancePerDay: z.number().min(0).max(1),
            fromDeg: degrees,
            /** The event's direction is drawn within fromDeg ± spreadDeg when it starts. */
            spreadDeg: z.number().min(0).max(180).optional(),
            /** Variable winds: the direction is redrawn at every weather check while the event lasts. */
            variable: z.boolean().optional(),
            strength: windStrength,
            durationDays: range,
          }),
        )
        .optional(),
    }),
  ),
});

export const weatherSchema = z.object({
  checkEveryHours: z.number().positive(),
  shiftChance: z.number().min(0).max(1),
  maxShiftDeg: z.number().min(0),
  strengthChangeChance: z.number().min(0).max(1),
  /** Coastal sea and land breezes (PRD section 3 weather): onshore by day, offshore by night. */
  breeze: z.object({
    reachKm: z.number().positive(),
    /** Peak breeze, in the navigation windStrength multiplier units. */
    strength: z.number().min(0),
    /** Hour of peak sea breeze; the land breeze peaks twelve hours later. */
    seaBreezePeakHour: z.number().min(0).lt(24),
  }),
  /** Roaming weather systems: lows and highs that drift over the map for days, turning the wind around
   * them so the trades don't blow the same way everywhere for weeks. `count` is [min, max] at once;
   * `maxBlend` is how much of the wind a system sets at its centre, fading to none at its edge. */
  systems: z.object({
    count: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    spawnChancePerDay: z.number().min(0).max(1),
    lowShare: z.number().min(0).max(1),
    radiusKm: z.tuple([z.number().positive(), z.number().positive()]),
    speedKmPerDay: z.tuple([z.number().min(0), z.number().min(0)]),
    lifetimeDays: z.tuple([z.number().positive(), z.number().positive()]),
    fadeDays: z.number().positive(),
    maxBlend: z.number().min(0).max(1),
    strength: z.object({ low: z.record(z.string(), z.number().min(0)), high: z.record(z.string(), z.number().min(0)) }),
  }),
  storms: z.object({
    months: z.array(month),
    spawnChancePerDay: z.record(z.string(), z.number().min(0).max(1)),
    spawnArea: z.array(lonLat).min(3),
    radiusKm: range,
    speedKmPerDay: range,
    headingDeg: range,
    recurveNorthOfLat: z.number(),
    /** How fast a storm north of recurveNorthOfLat turns toward the north-east. */
    recurveDegPerDay: z.number().min(0),
    lifetimeDays: range,
  }),
});

export const calendarSchema = z.object({ ticksPerDay: z.number().int().positive() });

export const musicSchema = z.object({
  tunes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      source: z.string(),
      /** lively: under full sail in fair wind; gentle: easier sailing; night: after dark. */
      mood: z.enum(['lively', 'gentle', 'night']),
      bpm: z.number().positive(),
      beatsPerBar: z.number().int().positive(),
      melody: z.string(),
      chords: z.string(),
    }),
  ),
});

export const goodsSchema = z.object({
  goods: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      basePrice: z.number().positive(),
      elasticity: z.number().min(0).max(2),
      /** Too cheap to trade for profit: no trade tags or shocks (bought for the crew). */
      staple: z.boolean().optional(),
    }),
  ),
});

const goodRates = z.record(z.string(), z.number().min(0));

export const economySchema = z.object({
  startingGold: z.number().int().min(0),
  daysPerWeek: z.number().int().positive(),
  /** Price stays within base x [min, max]. */
  priceClamp: z.tuple([z.number().positive(), z.number().positive()]),
  /** Buy/sell spread around the local price, by settlement type. */
  spread: z.record(z.string(), z.number().min(0).max(0.9)),
  /** Normal stock multiplier by settlement size. */
  sizeStock: z.record(z.string(), z.number().positive()),
  /** Reference (demand) stock per good for a town-sized settlement. */
  normalStock: z.record(z.string(), z.number().positive()),
  /** Usual stock, as a multiple of the reference, for a full producer or consumer (rate 1); lighter rates lean less. */
  producerStock: z.number().positive(),
  consumerStock: z.number().positive(),
  /** A port is known for exporting or wanting a good only at this profile rate or more. */
  notableLean: z.number().min(0).max(1),
  /** Share of the gap to its usual stock a market closes each week. */
  weeklyRecovery: z.number().min(0).max(1),
  harvest: z.tuple([z.number().min(0), z.number().min(0)]),
  /** Stock is capped at this multiple of the usual stock. */
  maxStock: z.number().positive(),
  shocks: z.object({
    perWeek: z.number().min(0),
    /** Share of the way to the shocked stock a market jumps when a shock starts. */
    jolt: z.number().min(0).max(1),
    kinds: z.record(
      z.string(),
      z.object({
        on: z.enum(['exports', 'wants']),
        /** Usual stock multiplier while the shock lasts. */
        stock: z.number().positive(),
        weeks: z.tuple([z.number().int().positive(), z.number().int().positive()]),
        /** Chance of being the weekly draw; 0 for kinds only other systems start (storm damage). */
        weight: z.number().min(0),
        /** News text; {town} and {good} are filled in. */
        news: z.string(),
      }),
    ),
  }),
  news: z.object({
    tilesPerDay: z.number().positive(),
    delayDays: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    keepWeeks: z.number().int().positive(),
  }),
  profiles: z.record(z.string(), z.object({ produces: goodRates, consumes: goodRates })),
  settlementProfiles: z.record(z.string(), z.array(z.string()).min(1)),
});

const nation = z.enum(['spain', 'england', 'france', 'netherlands', 'pirate']);

const share = z.number().min(0).max(1);

export const combatSchema = z.object({
  battle: z.object({
    /** Battle speed: navigation's tiles per second per speed point, scaled down so a fight is readable. */
    tilesPerSecondPerSpeedPoint: z.number().positive(),
    /** Battle handling: how fast a ship gathers way, and the slower rate she loses it, so she carries
     * her way through a tack instead of stopping dead. */
    accelPerSecond: z.number().positive(),
    decelPerSecond: z.number().positive(),
    /** The battle is fought on the world map itself, drawn at tileSize px a tile with the ships' world
     * sprites (the ocean map's own zoom), or close up with their 192 px combat set. */
    tileSize: z.number().int().positive(),
    sprites: z.enum(['world', 'combat']),
    /** How far apart the ships start, in battle tiles. */
    startApart: z.number().positive(),
    /** Hulls this close (tiles) touch and the grapples go out; held for grappleSeconds, the boarders go
     * over. Sailing clear past breakTiles cuts the grapples. */
    boardTiles: z.number().positive(),
    grappleSeconds: z.number().positive(),
    breakTiles: z.number().positive(),
    /** While grappled, each ship keeps only this share of her way. */
    grappleDrag: z.number().min(0).max(1),
    /** Past warnTiles apart the HUD warns the ships are drawing apart; past escapeTiles, a gap that
     * keeps widening for escapeSeconds ends the fight with one of them away. */
    warnTiles: z.number().positive(),
    escapeTiles: z.number().positive(),
    escapeSeconds: z.number().positive(),
    /** A fight longer than this (seconds) ends with the enemy slipping away. */
    maxSeconds: z.number().positive(),
  }),
  /**
   * How a pirate fights, in phases. She stalks: holds station off the other ship's bow or stern at
   * standoffShare of her own round-shot reach (within stationTiles counts as on it), out of the other's
   * broadsides, and rakes her from there. She closes to grapple only when it pays: the other's sails
   * below boardBelowSails percent, her crew outnumbering the other's by boardCrewRatio, or (a bold
   * captain) the moment the other's broadside facing her has just fired (more than openingReload of its
   * reload still to go). Badly hurt (hull below fleeBelowHull, or crew below fleeBelowCrew, as shares
   * of her start), she breaks off and runs. Each pirate captain has a temperament, drawn by share.
   */
  tactics: z.object({
    standoffShare: z.number().positive(),
    stationTiles: z.number().positive(),
    openingReload: z.number().min(0).max(1),
    temperaments: z.record(
      z.string(),
      z.object({
        share: z.number().min(0),
        boardBelowSails: z.number().min(0).max(100),
        boardCrewRatio: z.number().positive(),
        seizeOpenings: z.boolean(),
        fleeBelowHull: z.number().min(0).max(1),
        fleeBelowCrew: z.number().min(0).max(1),
      }),
    ),
  }),
  guns: z.object({
    /** A broadside bears within this many degrees of the beam. */
    arcDeg: z.number().positive(),
    rangeTiles: z.number().positive(),
    grapeTiles: z.number().positive(),
    /** Seconds to reload a broadside with a full gun crew; switching ammo costs a reload too. */
    reloadSeconds: z.number().positive(),
    /** Men a gun needs for full-speed reloading; fewer and every broadside reloads slower. */
    crewPerGun: z.number().positive(),
    shotTilesPerSecond: z.number().positive(),
    /** Chance a shot hits at point blank and at full range; raking fire (along the target's length) is surer. */
    hitNear: share,
    hitFar: share,
    rakeBonus: z.number().min(0),
  }),
  ammo: z.record(
    z.enum(['round', 'chain', 'grape']),
    z.object({ hull: z.number().min(0), sails: z.number().min(0), crew: z.number().min(0), short: z.boolean().optional() }),
  ),
  /** Chance a round-shot hit dismounts a gun. */
  gunLoss: share,
  /** A ship strikes when her hull or crew falls below these shares, rolled each second at strikeChance. */
  strike: z.object({
    hull: share,
    crew: share,
    chance: share,
    /** A merchant strikes outright with her sails below this share, or outmanned this many to one within oddsTiles. */
    merchantSails: share,
    odds: z.number().positive(),
    oddsTiles: z.number().positive(),
  }),
  /** After a sinking: barrels of her purse and men in the water to pick up within pickupTiles, for `seconds`. */
  salvage: z.object({
    seconds: z.number().positive(),
    barrels: z.number().int().nonnegative(),
    barrelGold: z.number().int().nonnegative(),
    survivors: share,
    spreadTiles: z.number().positive(),
    pickupTiles: z.number().positive(),
  }),
  /** Boarding: each side's strength is crew x this factor; the player's uses `player`. */
  boarding: z.object({ player: z.number().positive(), merchant: z.number().positive(), patrol: z.number().positive(), pirate: z.number().positive(), losses: share }),
  /** A fight between two AI ships: strength is crew x (1 + guns / 10) x the role's factor; the winner loses `losses` of her crew. */
  autoResolve: z.object({ merchant: z.number().positive(), patrol: z.number().positive(), pirate: z.number().positive(), losses: share }),
  /** Steering style per AI role. */
  personality: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.enum(['runner', 'cautious', 'aggressive'])),
  /** Crew and purse an AI ship sails with, as shares of her class's berths, and gold. */
  crew: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.tuple([share, share])),
  purse: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.tuple([z.number().min(0), z.number().min(0)])),
  /** Pirates (and a hostile nation's patrols) chase a player they sight within chaseTiles, give up past giveUpTiles. */
  chase: z.object({
    chaseTiles: z.number().positive(),
    giveUpTiles: z.number().positive(),
    contactTiles: z.number().positive(),
    calmDays: z.number().min(0),
    /** Hunters sight other AI ships at this range (shorter than the player, who stands out). */
    aiChaseTiles: z.number().positive(),
    /** A pirate with a prize heads home and leaves off hunting this long. */
    prizeCalmDays: z.number().min(0),
    /** Under a port's guns: within this many tiles of a port the hunter fears (by the port's size), she
     * won't chase or fight. Pirates fear every port but a haven; patrols fear their enemies' ports. */
    harbourTiles: z.record(z.string(), z.number().min(0)),
  }),
  /** Standing: attacking a nation's ship costs `attack`; sinking or taking a pirate earns `pirate` with every nation. */
  standing: z.object({
    attack: z.number(),
    pirate: z.number(),
    hostile: z.number(),
    refused: z.number(),
    /** Nations at war with a ship's nation approve when the player beats her; twice for a warship taken. */
    enemyWin: z.number(),
    warshipTaken: z.number().positive(),
  }),
  /** Tavern and shipwright prices. */
  /** Shipwright and tavern prices: a man signed on, a hull point and a sail percent made good, and a
   * cannon bought (gunGold) or sold back (gunSellGold). */
  port: z.object({
    recruitGold: z.number().min(0),
    hullGold: z.number().min(0),
    sailGold: z.number().min(0),
    gunGold: z.number().min(0),
    gunSellGold: z.number().min(0),
  }),
  /** The player's crew at the start of a career, as a share of the class's berths. */
  startCrew: share,
  /** News of a fight: {ship}, {nation} and {town} are filled in. */
  news: z.record(z.string(), z.string()),
});

const pairKey = z.string().regex(/^(england|france|netherlands|spain):(england|france|netherlands|spain)$/);

export const politicsSchema = z.object({
  start: z.record(pairKey, z.object({ war: z.boolean(), tension: z.number().min(0).max(100) })),
  monthly: z.object({
    drift: share,
    noise: z.number().min(0),
    warAbove: z.number(),
    warChance: share,
    peaceBelow: z.number(),
    peaceChance: share,
    /** At war, tension wears down toward this: wars end in exhaustion. */
    warSettle: z.number(),
    /** Tension set when a war breaks out. */
    warTension: z.number(),
  }),
  events: z.array(
    z.object({ year: z.number().int(), month: z.number().int().min(1).max(12), pair: pairKey, war: z.boolean(), tension: z.number().optional() }),
  ),
  piracy: z.object({ perTaken: z.number().min(0), decay: share, plague: z.number().min(0) }),
  marque: z.object({ price: z.number().min(0), freeAt: z.number(), standingGain: z.number() }),
  bounty: z.object({ merchant: z.number(), patrol: z.number(), pirate: z.number(), piracyScale: z.number().positive() }),
  news: z.record(z.string(), z.string()),
});

export const trafficSchema = z.object({
  population: z.number().int().min(0),
  roles: z.object({
    merchant: z.object({ share: z.number().min(0).max(1), classId: z.string() }),
    patrol: z.object({ share: z.number().min(0).max(1), classId: z.string() }),
    pirate: z.object({ share: z.number().min(0).max(1), classId: z.string() }),
  }),
  /** Most units a merchant buys per voyage. */
  voyageUnits: z.number().int().positive(),
  /** A merchant buys only while the far port pays this share over its price. */
  minMargin: z.number().min(0),
  maxPerRoute: z.number().int().positive(),
  sightTiles: z.number().positive(),
  nightSight: z.number().min(0).max(1),
  hailTiles: z.number().positive(),
  laneCell: z.number().int().positive(),
  tackTiles: z.number().min(0),
  /** How far to either side of the lane a ship keeps her own line, so ships on one lane don't overlap. */
  laneSpreadTiles: z.number().min(0),
  portDays: z.tuple([z.number().min(0), z.number().min(0)]),
  /** How long a pirate lies in wait on a lane before going home. */
  lurkDays: z.tuple([z.number().min(0), z.number().min(0)]),
  names: z.record(nation, z.array(z.string()).min(1)),
});

export type ShipClass = z.infer<typeof shipClassSchema>;
export type Polar = z.infer<typeof polarSchema>;
export type NavigationConfig = z.infer<typeof navigationSchema>;
export type SpriteDef = z.infer<typeof spriteSchema>;
export type ProceduralMapDef = z.infer<typeof proceduralMapSchema>;
export type RasterMapDef = z.infer<typeof rasterMapSchema>;
export type MapDef = ProceduralMapDef | RasterMapDef;
export type Settlement = z.infer<typeof settlementSchema>;
export type WindZones = z.infer<typeof windZonesSchema>;
export type Weather = z.infer<typeof weatherSchema>;
export type Calendar = z.infer<typeof calendarSchema>;
export type Music = z.infer<typeof musicSchema>;
export type Goods = z.infer<typeof goodsSchema>;
export type Economy = z.infer<typeof economySchema>;
export type Traffic = z.infer<typeof trafficSchema>;
export type Combat = z.infer<typeof combatSchema>;
export type PoliticsConfig = z.infer<typeof politicsSchema>;
export type Tune = Music['tunes'][number];

/** A shipwright's upgrade (PRD section 7): stat modifiers, a price, and the settlement sizes that sell it. */
export const upgradeSchema = z.object({
  id: z.string(),
  name: z.string(),
  effect: z.string(),
  price: z.number().min(0),
  sizes: z.array(z.enum(['hamlet', 'town', 'city'])),
  modifiers: z.object({
    speed: z.number().optional(),
    upwindDeg: z.number().optional(),
    crewMult: z.number().positive().optional(),
    hullMult: z.number().positive().optional(),
    rangeMult: z.number().positive().optional(),
    reloadMult: z.number().positive().optional(),
  }),
});
export const upgradesSchema = z.object({ upgrades: z.array(upgradeSchema) });
export type Upgrade = z.infer<typeof upgradeSchema>;

const share01 = z.number().min(0).max(1);
/** The crew: rations, morale, the two purses, manning and volunteers (crew.json's $comment explains). */
export const crewSchema = z.object({
  /** Men one unit of food feeds for a day. */
  rationMenPerUnit: z.number().positive(),
  /** Food a new career's ship starts with, in units. */
  startFood: z.number().min(0),
  morale: z.object({
    start: z.number().min(0).max(100),
    /** The mood morale heads toward: base, plus up to fromShares as the chest's gold per head reaches
     * perHeadForFull, minus perDayUnpaid for each day past graceDays since the crew was last paid. */
    mood: z.object({
      base: z.number(),
      perHeadForFull: z.number().positive(),
      fromShares: z.number().min(0),
      graceDays: z.number().min(0),
      perDayUnpaid: z.number().min(0),
    }),
    /** Share of the gap to the mood closed each day. */
    approachPerDay: share01,
    starvingPerDay: z.number().min(0),
    /** Morale for a ship taken or sunk, and for men lost (lossFactor times the share of the crew lost). */
    taken: z.number(),
    sunk: z.number(),
    lossFactor: z.number().min(0),
    grumbling: z.number(),
    deserting: z.number(),
    mutinous: z.number(),
    /** Share of the crew who desert on making port, below `deserting` and below `mutinous`. */
    desertShare: z.object({ deserting: share01, mutinous: share01 }),
    /** Morale after dividing the plunder: base plus fromShare as the share per head reaches perHeadForFull. */
    afterDivision: z.object({ base: z.number(), fromShare: z.number(), min: z.number(), max: z.number() }),
    /** Morale is at least this after wages are paid. */
    afterWages: z.number(),
  }),
  captainShare: share01,
  wagesPerManDay: z.number().min(0),
  /** Reload: manning is crew over the men a broadside needs; at fullManning it reloads reloadBonus faster. */
  manning: z.object({ fullManning: z.number().gt(1), reloadBonus: share01 }),
  /** Below a class's minimum crew, speed and turning scale down with the crew, to no less than this. */
  shortHandedFloor: share01,
  /** Boarding strength times this, from morale 0 to morale 100. */
  boarding: z.object({ at0: z.number().positive(), at100: z.number().positive() }),
  /** AI crews' morale in a fight, by role. */
  enemyMorale: z.record(z.string(), z.number().min(0).max(100)),
  /** Share of a prize's surviving crew who volunteer to join (pirates are readier to). */
  volunteers: z.object({ pirate: share01, other: share01 }),
});
export type CrewConfig = z.infer<typeof crewSchema>;
