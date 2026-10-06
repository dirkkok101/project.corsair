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

const shipStart = { shipId: z.string(), classId: z.string(), headingDeg: degrees };
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
    /** The battle map, in world tiles around the meeting, drawn at tileSize px a tile. */
    widthTiles: z.number().int().positive(),
    heightTiles: z.number().int().positive(),
    tileSize: z.number().int().positive(),
    /** How far apart the ships start, in battle tiles. */
    startApart: z.number().positive(),
    /** Hulls this close (tiles) touch: boarding. */
    boardTiles: z.number().positive(),
    /** A fight longer than this (seconds) ends with the enemy slipping away. */
    maxSeconds: z.number().positive(),
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
  strike: z.object({ hull: share, crew: share, chance: share }),
  /** Boarding: each side's strength is crew x this factor; the player's uses `player`. */
  boarding: z.object({ player: z.number().positive(), merchant: z.number().positive(), patrol: z.number().positive(), pirate: z.number().positive(), losses: share }),
  /** Steering style per AI role. */
  personality: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.enum(['runner', 'cautious', 'aggressive'])),
  /** Crew and purse an AI ship sails with, as shares of her class's berths, and gold. */
  crew: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.tuple([share, share])),
  purse: z.record(z.enum(['merchant', 'patrol', 'pirate']), z.tuple([z.number().min(0), z.number().min(0)])),
  /** Pirates (and a hostile nation's patrols) chase a player they sight within chaseTiles, give up past giveUpTiles. */
  chase: z.object({ chaseTiles: z.number().positive(), giveUpTiles: z.number().positive(), contactTiles: z.number().positive(), calmDays: z.number().min(0) }),
  /** Standing: attacking a nation's ship costs `attack`; sinking or taking a pirate earns `pirate` with every nation. */
  standing: z.object({ attack: z.number(), pirate: z.number(), hostile: z.number(), refused: z.number() }),
  /** Tavern and shipwright prices. */
  port: z.object({ recruitGold: z.number().min(0), hullGold: z.number().min(0), sailGold: z.number().min(0) }),
  /** The player's crew at the start of a career, as a share of the class's berths. */
  startCrew: share,
  /** News of a fight: {ship}, {nation} and {town} are filled in. */
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
export type Tune = Music['tunes'][number];
