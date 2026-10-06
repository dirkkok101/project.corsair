import { dateOf, rngStream, seedRng } from '@corsair/core';
import type { Captain, EmittedEvent, Nation, NewsItem, Politics, System, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';

// Global politics (PRD section 12): the four nations at war or peace. A monthly tick fires the
// historical events due that month, drifts each pair's tension (toward its base in peace, wearing
// down in war), then rolls: high tension may tip peace into war, low tension war into peace. Every
// declaration and treaty is news, starting from each nation's capital. Pirates are at war with all.

export const NATIONS = ['england', 'france', 'netherlands', 'spain'] as const;
type Realm = (typeof NATIONS)[number];

/** The relations key for a pair: the two nations in alphabetical order. */
export const pairKey = (a: Nation, b: Nation) => [a, b].sort().join(':');

/** Politics as a new career starts it (and as a save from before politics reads it). */
export function initialPolitics(content: ContentPack): Politics {
  return { relations: structuredClone(content.politics.start), piracy: {}, month: 0 };
}

/** True when two nations are at war. Pirates are at war with everyone; no nation with itself. */
export function atWar(content: ContentPack, state: WorldState, a: Nation, b: Nation): boolean {
  if (a === b) return false;
  if (a === 'pirate' || b === 'pirate') return true;
  return (state.politics ?? initialPolitics(content)).relations[pairKey(a, b)]?.war ?? false;
}

/** The nations a nation is at war with now (pirates always among them). */
export function enemiesOf(content: ContentPack, state: WorldState, nation: Nation): Nation[] {
  return ([...NATIONS, 'pirate'] as Nation[]).filter((n) => atWar(content, state, nation, n));
}

/** The nation whose letter of marque covers an attack on `victim`, if the captain holds one. */
export function legalTarget(content: ContentPack, state: WorldState, captain: Captain | undefined, victim: Nation): Nation | undefined {
  if (victim === 'pirate') return undefined;
  return captain?.marques?.find((issuer) => atWar(content, state, issuer, victim));
}

/** Months since the career's start date, by calendar month. */
function monthOf(content: ContentPack, startDate: string, tick: number) {
  const start = dateOf(startDate, 0);
  const now = dateOf(startDate, Math.floor(tick / content.calendar.ticksPerDay));
  return { index: (now.year - start.year) * 12 + (now.month - start.month), year: now.year, month: now.month };
}

/**
 * Pirates took one of a nation's merchants: her pirate pressure rises, and the moment it crosses the
 * plague line the news goes out from her capital (governors then pay more for pirates).
 */
export function raisePiracy(content: ContentPack, state: WorldState, settlements: PlacedSettlement[], nation: Nation, delayDays: number): WorldState {
  if (nation === 'pirate') return state;
  const politics = state.politics ?? initialPolitics(content);
  const before = politics.piracy[nation] ?? 0;
  const after = Math.min(100, before + content.politics.piracy.perTaken);
  let next: WorldState = { ...state, politics: { ...politics, piracy: { ...politics.piracy, [nation]: after } } };
  if (before < content.politics.piracy.plague && after >= content.politics.piracy.plague) {
    const capital = settlements.find((s) => s.type === 'capital' && s.nation === nation) ?? settlements[0]!;
    const n = next.nextNewsId ?? 0;
    const item: NewsItem = { id: `news.${n}`, tick: state.tick, settlementId: capital.id, kind: 'plague', good: '', delayDays, nation };
    next = { ...next, news: [...(next.news ?? []), item], nextNewsId: n + 1 };
  }
  return next;
}

export function createPoliticsSystem(content: ContentPack, startDate: string, settlements: PlacedSettlement[]): System {
  const p = content.politics;
  const capital = (n: Nation) => settlements.find((s) => s.type === 'capital' && s.nation === n) ?? settlements[0]!;

  return {
    name: 'politics',
    tick(state) {
      const tick = state.tick + 1;
      const now = monthOf(content, startDate, tick);
      const politics = state.politics ?? { ...initialPolitics(content), month: now.index };
      if (now.index <= politics.month) return state.politics ? { state, events: [] } : { state: { ...state, politics }, events: [] };

      const rng = rngStream(state.rng?.politics ?? seedRng(0, 'politics'));
      const relations = structuredClone(politics.relations);
      const events: EmittedEvent[] = [];
      const news: NewsItem[] = [];
      let nextNewsId = state.nextNewsId ?? 0;
      const announce = (kind: 'war' | 'peace', nation: Nation, other?: Nation) => {
        news.push({
          id: `news.${nextNewsId++}`,
          tick,
          settlementId: capital(nation).id,
          kind,
          good: '',
          delayDays: Math.floor(rng.range(content.economy.news.delayDays[0], content.economy.news.delayDays[1] + 1)),
          nation,
          other,
        });
      };
      const set = (key: string, war: boolean, tension?: number) => {
        const r = relations[key]!;
        const [a, b] = key.split(':') as [Realm, Realm];
        if (r.war !== war) {
          events.push({ type: war ? 'WarDeclared' : 'PeaceSigned', entityIds: [a, b], payload: {} });
          announce(war ? 'war' : 'peace', a, b);
        }
        relations[key] = { war, tension: tension ?? (war ? p.monthly.warTension : Math.min(r.tension, p.monthly.peaceBelow)) };
      };

      // History first: what happened that month in Europe reaches the Caribbean.
      for (const e of p.events) if (e.year === now.year && e.month === now.month && relations[e.pair]) set(e.pair, e.war, e.tension);

      // Then the drift and the rolls, for pairs history left alone this month.
      for (const key of Object.keys(relations).sort()) {
        if (p.events.some((e) => e.year === now.year && e.month === now.month && e.pair === key)) continue;
        const r = relations[key]!;
        const base = p.start[key]?.tension ?? 50;
        const toward = r.war ? p.monthly.warSettle : base;
        const tension = Math.max(0, Math.min(100, r.tension + (toward - r.tension) * p.monthly.drift + rng.range(-1, 1) * p.monthly.noise));
        relations[key] = { ...r, tension };
        if (!r.war && tension > p.monthly.warAbove && rng.float() < p.monthly.warChance) set(key, true);
        else if (r.war && tension < p.monthly.peaceBelow && rng.float() < p.monthly.peaceChance) set(key, false, tension);
      }

      // Pirate pressure fades month by month (raisePiracy adds to it, and makes the news).
      const piracy: Politics['piracy'] = {};
      for (const [n, level] of Object.entries(politics.piracy) as [Nation, number][]) {
        const next = level * p.piracy.decay;
        if (next >= 1) piracy[n] = next;
      }

      return {
        state: {
          ...state,
          politics: { relations, piracy, month: now.index },
          news: news.length ? [...(state.news ?? []), ...news] : state.news,
          nextNewsId,
          rng: { ...state.rng, politics: rng.state() },
        },
        events,
      };
    },
  };
}
