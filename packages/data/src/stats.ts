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
export function shipStats(content: ContentPack, ship: { classId: string; guns?: number; upgrades?: string[]; fleetSpeed?: number }): ShipStats {
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
  // With a fleet she keeps the pace of its slowest ship.
  if (ship.fleetSpeed !== undefined) stats.speed = Math.min(stats.speed, ship.fleetSpeed);
  stats.hullMax = Math.round(stats.hullMax);
  stats.maxCrew = Math.round(stats.maxCrew);
  return stats;
}

/** How an upgrade's price grows with the ship: by her guns, her hull or her berths. */
const PER = { gun: 'guns', hull: 'hull', berth: 'maxCrew' } as const;

/**
 * What an upgrade costs on a ship of this class: its listed price (for upgrades.json's priceFor class, the brig)
 * scaled by the work, gun for gun, hull point for hull point or berth for berth, to the nearest 10 gold. A sloop's
 * bronze cannon cost a fraction of a ship of the line's. `each` and `units` explain the sum on the shipwright's row.
 */
export function upgradePrice(content: ContentPack, classId: string, upgradeId: string): { price: number; each: number; units: number; per: 'gun' | 'hull' | 'berth' } {
  const u = content.upgrades[upgradeId]!;
  const ref = content.ships[content.upgradePriceFor]!;
  const cls = content.ships[classId]!;
  const stat = PER[u.per];
  const each = u.price / ref[stat];
  return { price: Math.max(10, Math.round((each * cls[stat]) / 10) * 10), each, units: cls[stat], per: u.per };
}
