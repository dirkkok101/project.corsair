import type { ContentPack } from './index';

/** What a ship really is: her class, as her mounted guns and installed upgrades change it. */
export interface ShipStats {
  /** Speed points (the class's, plus upgrades). */
  speed: number;
  hullMax: number;
  maxCrew: number;
  /** Guns mounted now, and the most her gun deck takes. */
  guns: number;
  maxGuns: number;
  /** Degrees closer to the wind she sails than her class's polar. */
  upwindDeg: number;
  /** Gun range (round and grape) and reload time, as multiples of combat.json's. */
  rangeMult: number;
  reloadMult: number;
}

/**
 * A ship's stats from her class, mounted guns and upgrades. Every system reads a ship through this, so an
 * upgrade bought at the shipwright reaches sailing, the battle, repairs and recruiting alike. A ship with
 * no `guns` carries her class's full battery (AI ships, and saves from before outfitting).
 */
export function shipStats(content: ContentPack, ship: { classId: string; guns?: number; upgrades?: string[] }): ShipStats {
  const cls = content.ships[ship.classId]!;
  const stats: ShipStats = {
    speed: cls.speed,
    hullMax: cls.hull,
    maxCrew: cls.maxCrew,
    guns: Math.min(ship.guns ?? cls.guns, cls.guns),
    maxGuns: cls.guns,
    upwindDeg: 0,
    rangeMult: 1,
    reloadMult: 1,
  };
  for (const id of ship.upgrades ?? []) {
    const m = content.upgrades[id]?.modifiers;
    if (!m) continue;
    stats.speed += m.speed ?? 0;
    stats.upwindDeg += m.upwindDeg ?? 0;
    stats.hullMax *= m.hullMult ?? 1;
    stats.maxCrew *= m.crewMult ?? 1;
    stats.rangeMult *= m.rangeMult ?? 1;
    stats.reloadMult *= m.reloadMult ?? 1;
  }
  // Whole hull points and berths, so repair bills and the crew count stay whole.
  stats.hullMax = Math.round(stats.hullMax);
  stats.maxCrew = Math.round(stats.maxCrew);
  return stats;
}
