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
  /** Swivel guns mounted (her class's and the fit's), and her chasers at each end. */
  swivels: number;
  chasers: number;
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
    swivels: cls.swivels ?? 0,
    chasers: cls.chasers ?? 0,
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
    stats.swivels += m.swivels ?? 0;
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

/**
 * What her crew and captain make of her (combat.json crewQuality and skill): multiples of reload time, shot scatter
 * and boarding strength, and how many ticks between her captain's decisions. A ship with neither (the player's, or
 * one from before captains) is a regular crew under a captain of 50: every multiple exactly 1, and 8 ticks.
 */
export function crewQualityOf(
  content: ContentPack,
  ai?: { crew?: 'green' | 'regular' | 'seasoned' | 'veteran'; captain?: { gunnery: number; seamanship: number; boarding: number } },
): { reload: number; spread: number; boarding: number; thinkTicks: number } {
  const q = content.combat.crewQuality[ai?.crew ?? 'regular']!;
  const k = content.combat.skill;
  // -1 at 0, 0 at 50, 1 at 100.
  const lean = (v?: number) => ((v ?? 50) - 50) / 50;
  const c = ai?.captain;
  const [slow, quick] = k.thinkTicks;
  return {
    reload: q.reload * (1 - (k.reload / 2) * lean(c?.gunnery)),
    spread: q.spread * (1 - (k.spread / 2) * lean(c?.gunnery)),
    boarding: q.boarding * (1 + (k.boarding / 2) * lean(c?.boarding)),
    thinkTicks: Math.round(slow + ((quick - slow) * (c?.seamanship ?? 50)) / 100),
  };
}
