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

export const mapSchema = z.object({
  id: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileSize: z.number().int().positive(),
  shallowsTiles: z.number().int().min(0),
  islands: z.array(z.object({ x: z.number(), y: z.number(), r: z.number().positive() })),
  start: z.object({ shipId: z.string(), classId: z.string(), x: z.number(), y: z.number(), headingDeg: degrees }),
  wind: z.object({ fromDeg: degrees, strength: windStrength }),
});

export type ShipClass = z.infer<typeof shipClassSchema>;
export type Polar = z.infer<typeof polarSchema>;
export type NavigationConfig = z.infer<typeof navigationSchema>;
export type SpriteDef = z.infer<typeof spriteSchema>;
export type MapDef = z.infer<typeof mapSchema>;
