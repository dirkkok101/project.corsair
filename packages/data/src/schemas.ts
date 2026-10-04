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
  polar: z.string(),
  sprites: z.object({ world: z.string() }),
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
  storms: z.object({
    months: z.array(month),
    spawnChancePerDay: z.record(z.string(), z.number().min(0).max(1)),
    spawnArea: z.array(lonLat).min(3),
    radiusKm: range,
    speedKmPerDay: range,
    headingDeg: range,
    recurveNorthOfLat: z.number(),
    lifetimeDays: range,
  }),
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
