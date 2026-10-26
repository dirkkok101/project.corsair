import type { Captain, Nation, WorldState } from '@corsair/core';
import { difficultyOf } from '@corsair/data';
import { NATIONS } from '@corsair/systems-politics';
import type { ContentPack } from '@corsair/data';

// Ranks, fame and the retirement score (slice 8 of docs/design/combat-model.md; politics.json ranks and career).
// Everything here is read from the captain's merit and record, so nothing is stored twice.

export type Perk = 'recruit' | 'repair' | 'bestFits' | 'price' | 'frigate' | 'upgrade' | 'estate';

/** His rung with a nation (an index into the ladder, 0 its letter of marque), or -1 without its letter. */
export function rankOf(content: ContentPack, captain: Captain | undefined, nation: Nation): number {
  if (!captain?.marques?.includes(nation)) return -1;
  const merit = captain.merit?.[nation] ?? 0;
  return content.politics.ranks.ladder.reduce((r, rung, i) => (merit >= rung.merit ? i : r), 0);
}

/** The rung a perk comes with, as a ladder index. */
export function perkRung(content: ContentPack, perk: Perk): number {
  return content.politics.ranks.ladder.findIndex((r) => r.id === content.politics.ranks.perks[perk]!.rung);
}

export function hasPerk(content: ContentPack, captain: Captain | undefined, nation: Nation, perk: Perk): boolean {
  return rankOf(content, captain, nation) >= perkRung(content, perk);
}

/** A perk's multiple on a price at that nation's ports (recruits, repairs, upgrades): 1 without the rank. */
export function perkPrice(content: ContentPack, captain: Captain | undefined, nation: Nation, perk: 'recruit' | 'repair' | 'upgrade'): number {
  return hasPerk(content, captain, nation, perk) ? (content.politics.ranks.perks[perk]!.value ?? 1) : 1;
}

/** His edge on every trade at that nation's ports (a share: buys that much cheaper, sells that much dearer). */
export function tradeEdge(content: ContentPack, captain: Captain | undefined, nation: Nation): number {
  return hasPerk(content, captain, nation, 'price') ? (content.politics.ranks.perks.price!.value ?? 0) : 0;
}

/** Acres he holds of a nation: the estates he bought there, his title's land, and more for each merit past his first title. */
export function landOf(content: ContentPack, captain: Captain | undefined, nation: Nation): number {
  const r = rankOf(content, captain, nation);
  const ladder = content.politics.ranks.ladder;
  const first = ladder.findIndex((l) => l.acres);
  const bought = captain?.estates?.[nation] ?? 0;
  if (r < 0 || first < 0 || r < first) return bought;
  const titled = ladder.slice(0, r + 1).reduce((a, l) => l.acres ?? a, 0);
  return bought + titled + Math.round(content.politics.ranks.acresPerMerit * Math.max(0, (captain?.merit?.[nation] ?? 0) - ladder[first]!.merit));
}

/** What his next lot of estate land costs: dearer for every lot he has bought, in any nation. */
export function estatePrice(content: ContentPack, captain: Captain | undefined): number {
  const e = content.politics.ranks.estate;
  const lots = Object.values(captain?.estates ?? {}).reduce((n, a) => n + (a ?? 0), 0) / e.acres;
  return Math.round(e.gold * e.rise ** lots);
}

/**
 * Points on a rising ladder: the first at `step` gold, each after it `step` dearer than the last (n points take
 * step x n(n+1)/2), so a fortune counts but a second counts for less than the first.
 */
export function ladderPoints(gold: number, step: number): number {
  return Math.floor((Math.sqrt(1 + (8 * Math.max(0, gold)) / step) - 1) / 2 + 1e-9);
}

/** The gold the next point on the ladder takes, from `points` held. */
export function ladderNext(points: number, step: number): number {
  return (step * (points + 1) * (points + 2)) / 2;
}

export interface Fames {
  trade: number;
  war: number;
  adventure: number;
}

/** The three fames, from the career's record: trade, war and adventure. */
export function famesOf(content: ContentPack, state: WorldState): Fames {
  const f = content.politics.career.fame;
  const record = state.captain?.record ?? {};
  const pirates = Object.values(record.beaten ?? {}).reduce((n, k) => n + k, 0);
  const hoards = content.pirates.captains.filter((c) => state.famous?.[c.id]?.hoard?.found).length;
  const pieces = Object.values(state.captain?.mapPieces ?? {}).reduce((n, k) => n + k, 0);
  return {
    trade: ladderPoints(record.tradeProfit ?? 0, f.trade.goldStep),
    war: (record.prizes ?? 0) * f.war.prize + pirates * f.war.pirate + (record.famousBeaten ?? 0) * f.war.famous,
    adventure: hoards * f.adventure.hoard + pieces * f.adventure.mapPiece,
  };
}

export interface CareerScore {
  fames: Fames;
  /** His gold and his share of the plunder chest, and the points it makes. */
  gold: number;
  wealth: number;
  acres: number;
  land: number;
  /** Each nation's rank (its name) and the points it makes. */
  ranks: { nation: Nation; name: string; points: number }[];
  rank: number;
  /** The difficulty's multiple, and the total after it. */
  multiple: number;
  total: number;
  fate: string;
}

/** The retirement score as it stands: the fames, wealth, land and ranks, times the difficulty's multiple. */
export function careerScore(content: ContentPack, state: WorldState): CareerScore {
  const nations: Nation[] = [...NATIONS];
  const c = content.politics.career;
  const captain = state.captain;
  const fames = famesOf(content, state);
  // His gold, and the captain's share of the chest the crew would divide.
  const gold = Math.floor((captain?.gold ?? 0) + (captain?.chest ?? 0) * content.crew.captainShare);
  const wealth = ladderPoints(gold, c.score.goldStep);
  const acres = nations.reduce((n, nation) => n + landOf(content, captain, nation), 0);
  const land = Math.floor(acres / c.score.acresPer);
  const ladder = content.politics.ranks.ladder;
  const ranks = nations.flatMap((nation) => {
    const r = rankOf(content, captain, nation);
    return r < 0 ? [] : [{ nation, name: ladder[r]!.name, points: c.score.rank[r] ?? c.score.rank.at(-1) ?? 0 }];
  });
  const rank = ranks.reduce((n, r) => n + r.points, 0);
  const multiple = difficultyOf(content, state.difficulty).score;
  const total = Math.round((fames.trade + fames.war + fames.adventure + wealth + land + rank) * multiple);
  const fate = c.fates.reduce((f, x) => (total >= x.score ? x.title : f), c.fates[0]!.title);
  return { fames, gold, wealth, acres, land, ranks, rank, multiple, total, fate };
}

/** What became of him if he retired today, and the next fate up with the score it takes (none past the highest). */
export function fateNow(content: ContentPack, state: WorldState): { total: number; fate: string; next?: { title: string; score: number } } {
  const s = careerScore(content, state);
  const next = content.politics.career.fates.find((f) => f.score > s.total);
  return { total: s.total, fate: s.fate, ...(next ? { next: { title: next.title, score: next.score } } : {}) };
}

/** What a rung brings at its nation's ports, in words (a rung with nothing new brings nothing). */
export function rungBrings(content: ContentPack, rung: number, land = true): string[] {
  const r = content.politics.ranks;
  const id = r.ladder[rung]?.id;
  const off = (v?: number) => Math.round((1 - (v ?? 1)) * 100);
  const words: string[] = [];
  for (const [perk, p] of Object.entries(r.perks) as [Perk, { rung: string; value?: number }][]) {
    if (p.rung !== id) continue;
    if (perk === 'recruit') words.push(`men sign on for ${off(p.value)}% less`);
    if (perk === 'repair') words.push(`repairs ${off(p.value)}% cheaper`);
    if (perk === 'bestFits') words.push("the city-only fits at its towns' yards");
    if (perk === 'price') words.push(`${Math.round((p.value ?? 0) * 100)}% better prices`);
    if (perk === 'frigate') words.push("a frigate from its capital's yard");
    if (perk === 'upgrade') words.push(`upgrades ${off(p.value)}% cheaper`);
    if (perk === 'estate') words.push(`estates of ${r.estate.acres} acres to buy from its governors, paying rent and adding to your name`);
  }
  const acres = r.ladder[rung]?.acres;
  if (acres && land) words.push(`a title and ${acres} acres of land paying ${Math.round(acres * r.rentPerAcre)} gold a month`);
  return words;
}
