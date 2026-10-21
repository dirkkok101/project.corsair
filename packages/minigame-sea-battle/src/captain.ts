/**
 * A boarder's mind (utility AI): each tick she weighs what to do (board, stalk, or run) by how much she wants each now,
 * and does the one she wants most. Each want is a reason or several, each read through a curve that rises around her
 * temperament's own threshold (combat.json tactics.temperaments), so reasons add up: a rig half shot through and a
 * crew a little stronger can together send her in where neither would alone. She holds to what she is doing until
 * something else is wanted clearly more (`margin`), so she doesn't dither between two near-equal choices. Pure and
 * deterministic: the fight is seeded and replays must come out the same.
 */
export type Intent = 'board' | 'stalk' | 'flee';

export interface Mind {
  intent: Intent;
  /** How much she wants each, 0..1. */
  wants: Record<Intent, number>;
}

/** What she knows of the fight now. */
export interface Situation {
  /** Her hull and crew left, as shares of what she had. */
  hull: number;
  crew: number;
  /** Her men over the other's. */
  menRatio: number;
  /** The other's sails, 0..100. */
  theirSails: number;
  /** The other's broadside on her side has just fired and is a while reloading. */
  opening: boolean;
  /** Who holds the weather gauge: her, the other, or neither. */
  gauge: 'mine' | 'theirs' | undefined;
}

export interface Temperament {
  boardBelowSails: number;
  boardCrewRatio: number;
  seizeOpenings: boolean;
  fleeBelowHull: number;
  fleeBelowCrew: number;
}

export interface Weighing {
  /** How soft each curve is around its threshold: in shares (hull, crew), sail points, and men ratio. */
  soft: { share: number; sails: number; ratio: number };
  /** How much more another choice must be wanted before she changes her mind. */
  margin: number;
  /** The weather gauge: holding it, she can choose her moment to run down on the other; how much it adds to boarding. */
  gauge: number;
  /** How much she wants to stalk (keep off the other's bow or stern and rake her): her course when nothing else calls. */
  stalk: number;
}

/** 0..1, past one half once `x` falls below `at`, steeper the smaller `soft`. A threshold of 0 never fires. */
const below = (x: number, at: number, soft: number) => (at <= 0 ? 0 : 1 / (1 + Math.exp((x - at) / soft)));
const above = (x: number, at: number, soft: number) => 1 / (1 + Math.exp((at - x) / soft));
/** Reasons together: each takes its share of what the others leave. */
const any = (...ws: number[]) => 1 - ws.reduce((left, w) => left * (1 - w), 1);

export function weigh(s: Situation, t: Temperament, w: Weighing, last?: Intent): Mind {
  const flee = any(below(s.hull, t.fleeBelowHull, w.soft.share), below(s.crew, t.fleeBelowCrew, w.soft.share));
  // A ship falling apart doesn't board: the more she wants to run, the less she wants to close.
  const board =
    any(below(s.theirSails, t.boardBelowSails, w.soft.sails), above(s.menRatio, t.boardCrewRatio, w.soft.ratio), t.seizeOpenings && s.opening ? 1 : 0, s.gauge === 'mine' ? w.gauge : 0) *
    (1 - flee);
  const wants: Record<Intent, number> = { board, stalk: w.stalk, flee };
  const order: Intent[] = ['flee', 'board', 'stalk'];
  let best = order.reduce((a, b) => (wants[b] > wants[a] ? b : a));
  if (last && best !== last && wants[best] < wants[last] + w.margin) best = last;
  return { intent: best, wants };
}
