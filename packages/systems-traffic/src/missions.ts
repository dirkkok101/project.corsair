import { rngStream, seedRng } from '@corsair/core';
import type { Mission, Nation, WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { crewOf, hasGovernor, plagued } from '@corsair/systems-economy';
import { atWar } from '@corsair/systems-politics';
import type { Goal } from './goals';

// Governors' missions (docs/design/governor-missions.md): each governor offers one a week, the captain takes it or
// not, and the open ones are goals at sea. Traffic puts a hunt's quarry on the sea and sees her beaten; the
// economy's governor pays.

/** What a governor offers this week: the mission, and the key that marks it taken. */
export interface MissionOffer {
  key: string;
  kind: Mission['kind'];
  from: string;
  nation: Nation;
  to: string;
  classId?: string;
  name?: string;
  reward: number;
  merit: number;
}

const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };

/** "brigantine", as a ship's class is said. */
const kindOf = (classId: string) => classId.replace(/^ship\./, '').replace(/_/g, ' ');

/** A fight's weight of a ship: her men, and a tenth more for every gun. */
const strength = (men: number, guns: number) => men * (1 + guns / 10);

/** The hunt's quarry: the class whose manned strength comes nearest the flagship's (times hunt.match), so a strong captain is sent after a strong pirate. */
export function quarryClass(content: ContentPack, state: WorldState): string {
  const h = content.politics.missions.hunt;
  const me = state.ships.player;
  const want = me ? strength(crewOf(content, me), shipStats(content, me).guns) * h.match : 0;
  const of = (id: string) => {
    const c = content.ships[id]!;
    return strength(c.maxCrew * h.crew, shipStats(content, { classId: id }).maxGuns);
  };
  return h.classes.reduce((a, b) => (Math.abs(of(b) - want) < Math.abs(of(a) - want) ? b : a));
}

/**
 * The mission a town's governor offers this week, if any: a hunt for a named pirate haunting waters near his town,
 * or a letter to carry to a friendly governor. Pure (the town and the week decide it), so the port screen may ask
 * every frame and "Not now" keeps it. None to a captain his nation counts hostile, none taken twice.
 */
export function missionOffer(
  content: ContentPack,
  state: WorldState,
  town: PlacedSettlement,
  settlements: PlacedSettlement[],
  only?: 'hunt' | 'courier',
): MissionOffer | undefined {
  const captain = state.captain;
  if (!captain || !state.ships.player || !hasGovernor(town)) return undefined;
  if ((captain.standing?.[town.nation] ?? 0) <= content.combat.standing.hostile) return undefined;
  const week = Math.floor(state.tick / (content.economy.daysPerWeek * content.calendar.ticksPerDay));
  const key = `${town.id}:${week}`;
  if (captain.missionDeals?.includes(key)) return undefined;
  const m = content.politics.missions;
  let h = 2166136261;
  for (let i = 0; i < town.id.length; i++) h = Math.imul(h ^ town.id.charCodeAt(i), 16777619);
  const draw = rngStream(seedRng(week * 7919 + ((h >>> 0) % 7907), 'mission'));
  const far = (s: PlacedSettlement) => Math.hypot(s.x - town.x, s.y - town.y);
  const ports = settlements.filter((s) => s.nation !== 'pirate' && s.type !== 'haven');
  const areas = ports.filter((s) => far(s) <= m.hunt.areaTiles);
  const letters = ports.filter(
    (s) => s.id !== town.id && hasGovernor(s) && !atWar(content, state, town.nation, s.nation) && !plagued(state, s.id) && far(s) >= m.courier.tiles[0] && far(s) <= m.courier.tiles[1],
  );
  const weights = { hunt: areas.length && only !== 'courier' ? m.hunt.weight : 0, courier: letters.length && only !== 'hunt' ? m.courier.weight : 0 };
  if (weights.hunt + weights.courier <= 0) return undefined;
  const kind = draw.weighted(weights);
  const base = { key, kind, from: town.id, nation: town.nation };
  if (kind === 'courier') {
    const to = letters[Math.floor(draw.float() * letters.length)]!;
    const reward = Math.max(m.courier.minReward, Math.round((far(to) * 2 * m.courier.goldPerTile) / 10) * 10);
    return { ...base, to: to.id, reward, merit: m.courier.merit };
  }
  const to = areas[Math.floor(draw.float() * areas.length)]!;
  // The First Voyage's hunt is a lighter one than her match: her first real fight.
  const classId = captain.voyage && captain.voyage.step !== 'done' ? content.voyage.commissions.quarry : quarryClass(content, state);
  const names = content.traffic.names.pirate ?? [];
  const name = names[Math.floor(draw.float() * names.length)] ?? 'Revenge';
  const reward = Math.max(m.hunt.minReward, Math.round((content.ships[classId]!.price * m.hunt.rewardShare) / 10) * 10);
  return { ...base, to: to.id, classId, name, reward, merit: m.hunt.merit };
}

/** What a mission asks, as the governor and the goals say it ("Hunt the pirate brigantine Night Rambler"). */
export function missionTitle(m: Pick<Mission, 'kind' | 'classId' | 'name'>, to: string): string {
  return m.kind === 'hunt' ? `Hunt the pirate ${kindOf(m.classId ?? '')} ${m.name}` : `Carry the governor's letter to ${to}`;
}

/** The captain's open missions as goals, nearest first: where each gets done next, and what it pays. */
export function missionGoals(state: WorldState, settlements: PlacedSettlement[]): Goal[] {
  const me = state.ships.player;
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const goals = (state.captain?.missions ?? []).map((m): Goal => {
    const pays = `${m.reward.toLocaleString('en-GB')} gold and ${m.merit} merit with ${COUNTRY[m.nation] ?? m.nation}`;
    const step = (title: string, why: string, port: string): Goal => ({ id: m.id, title, why, have: 0, of: 1, unit: '', done: false, port, mission: true });
    if (m.done !== undefined) return step(`Collect your reward at ${name(m.from)}`, `The governor owes you ${pays}`, m.from);
    if (m.kind === 'courier' && m.delivered !== undefined) return step(`Bring the reply to ${name(m.from)}`, `${pays} when he has it`, m.from);
    if (m.kind === 'courier') return step(missionTitle(m, name(m.to)), `Then bring the reply back: ${pays}`, m.to);
    return step(missionTitle(m, name(m.to)), `She haunts the waters off ${name(m.to)}: ${pays}`, m.to);
  });
  const far = (g: Goal) => {
    const s = g.port ? byId.get(g.port) : undefined;
    return s && me ? Math.hypot(s.x - me.x, s.y - me.y) : 0;
  };
  return goals.sort((a, b) => far(a) - far(b));
}
