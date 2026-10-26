import type { GameEvent, Honour, System, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { fateNow } from '@corsair/systems-economy';
import { careerGoals } from './goals';
import { topTen } from './index';

/** She keeps this many honours, the oldest dropped first. */
export const HONOURS_SIZE = 200;

const ADJECTIVE: Record<string, string> = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch' };
const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };

const lower = (t: string) => t[0]!.toLowerCase() + t.slice(1);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** A goal done, in the past tense (careerGoals ids). */
const DONE: Record<string, string> = {
  guns: 'A full battery',
  crew: 'A full crew signed on',
  trade: '2,000 gold made trading',
  prize: 'First prize taken',
  marque: 'A letter of marque won',
  match: 'A pirate your own size beaten',
  fit: 'Your ship fitted out',
  famous: 'A famous pirate beaten',
  rank: 'Risen in rank',
  fitted: 'Your ship fitted out fully',
  frigate: 'A frigate commanded',
  topten: 'Entered the Top Ten',
  hoard: 'A hoard dug up',
};

/**
 * The rewards layer (docs/design/first-voyage.md section 4): it watches what the systems do and keeps every deed of
 * hers as an honour, for the deed card that says it out loud and the log's Deeds page. Firsts (a sale, a prize), a
 * big trade, each leg of a governor's mission, bounties paid, a letter of marque, a rank, a hoard, a contract, and
 * each career goal newly done, a new fate reached (what she would retire to), and each famous pirate she grows richer
 * than once in the Top Ten; the first few goals done pay a little gold into her purse (rewards.json).
 */
export function createHonoursSystem(content: ContentPack, settlements: PlacedSettlement[]): System {
  const town = (id?: unknown) => settlements.find((s) => s.id === id)?.name ?? String(id ?? '');
  const nationOf = (id?: unknown) => settlements.find((s) => s.id === id)?.nation;
  const good = (id: unknown) => content.goods.find((g) => g.id === id)?.name ?? String(id);
  const r = content.rewards;

  return {
    name: 'honours',
    tick: (state) => ({ state, events: [] }),
    observe(state: WorldState, events: readonly GameEvent[]) {
      const captain = state.captain;
      const player = state.ships.player;
      if (!captain || !player) return state;
      const mine = events.filter((e) => e.entityIds[0] === player.id);
      // The goals done when she was first seen (a new career, or a save from before honours) say nothing.
      if (!mine.length && captain.goalsDone) return state;
      let honours = captain.honours ?? [];
      const had = (id: string) => honours.some((h) => h.id === id);
      const add = (h: Honour) => {
        if (!had(h.id)) honours = [...honours, h];
      };
      for (const e of mine) {
        const p = e.payload;
        const at = e.entityIds[1];
        const base = { tick: e.tick, ...(at ? { place: at } : {}) };
        switch (e.type) {
          case 'Sold': {
            const chest = Number(p.chest ?? 0);
            const profit = Math.round(Number(p.gold) - chest - Number(p.paid ?? 0));
            if (!had('first:sale'))
              add({ id: 'first:sale', kind: 'first', title: 'First cargo sold', gold: Number(p.gold), into: chest > Number(p.gold) / 2 ? 'chest' : 'purse', lines: [`${p.quantity} ${good(p.good).toLowerCase()} at ${town(at)}`], ...base });
            else if (profit >= r.bigTrade) add({ id: `trade:${e.tick}:${p.good}`, kind: 'trade', title: `${good(p.good)} sold in ${town(at)}`, gold: profit, into: 'profit', ...base });
            break;
          }
          case 'BattleOver': {
            const mission = p.mission as { id: string; from: string; reward: number } | null;
            if (mission)
              add({ id: `mission:${mission.id}`, kind: 'mission', title: `The pirate ${p.ship} beaten`, gold: mission.reward, into: 'owed', lines: [`The governor of ${mission.from} will pay`], tick: e.tick });
            const taken = p.outcome === 'struck' || p.outcome === 'boarded';
            if (taken && !had('first:prize')) {
              const men = Number(p.volunteers);
              add({
                id: 'first:prize',
                kind: 'first',
                title: 'First prize taken',
                ...(Number(p.purse) ? { gold: Number(p.purse), into: 'chest' as const } : {}),
                lines: [`The ${p.ship} struck${men ? `; ${men} of her men joined you` : ''}`],
                goal: 'prize',
                tick: e.tick,
              });
            }
            break;
          }
          case 'LetterDelivered':
            add({ id: `letter:${p.id}`, kind: 'mission', title: `Letter delivered, ${town(at)}`, gold: Number(p.advance), into: 'purse', lines: [`${p.owed} more when the reply is home`], ...base });
            break;
          case 'BountiesPaid': {
            const ids = (p.missions as string[] | undefined) ?? [];
            const nation = nationOf(at);
            const merit = Number(p.merit ?? 0);
            const meritLine = merit && nation && COUNTRY[nation] ? [`+${merit} merit with ${COUNTRY[nation]}`] : [];
            const bounty = Number(p.bounty ?? 0);
            if (ids.length) {
              // Named for the mission it ends: a courier's reply brought home, or a hunt paid.
              const title = ids.length > 1 ? `${ids.length} commissions done` : had(`letter:${ids[0]}`) ? 'The letter carried' : 'The hunt paid';
              add({
                id: `paid:${ids.join(',')}`,
                kind: 'mission',
                title,
                gold: Number(p.missionGold),
                into: 'purse',
                lines: [...meritLine, ...(bounty ? [`${bounty} in bounties, into the chest`] : [])],
                ...(nation && meritLine.length ? { nation } : {}),
                ...base,
              });
            } else add({ id: `bounty:${e.tick}`, kind: 'bounty', title: 'Bounties paid', gold: bounty, into: 'chest', lines: meritLine, ...(nation && meritLine.length ? { nation } : {}), ...base });
            break;
          }
          case 'MarqueBought':
            // The First Voyage's letter has its ceremony (the promotion moment), as a rank does.
            add({ id: `marque:${p.nation}`, kind: p.voyage ? 'rank' : 'marque', title: `${p.nation === 'england' ? 'An' : 'A'} ${ADJECTIVE[String(p.nation)]} letter of marque`, lines: ['Her prizes are lawful now'], goal: 'marque', ...base });
            break;
          case 'Promoted':
            add({ id: `rank:${p.nation}:${p.rank}`, kind: 'rank', title: `Made ${p.rank}`, lines: [`In the service of ${COUNTRY[String(p.nation)] ?? p.nation}`], ...base });
            break;
          case 'EstateBought':
            add({
              id: `estate:${e.tick}`,
              kind: 'fame',
              title: `An estate in ${COUNTRY[String(p.nation)] ?? p.nation}`,
              lines: [`${p.acres} acres, paying ${Math.round(Number(p.acres) * content.politics.ranks.rentPerAcre)} gold a month`],
              ...base,
            });
            break;
          case 'HoardFound':
            add({ id: `hoard:${p.pirateId}`, kind: 'hoard', title: `${p.name}'s hoard dug up`, gold: Number(p.gold), into: 'chest', tick: e.tick });
            break;
          case 'VoyageDone': {
            // The career's end in view: what she would retire to today, and the next fate up.
            const f = fateNow(content, state);
            add({
              id: 'first:voyage',
              kind: 'first',
              title: 'The First Voyage sailed',
              lines: ["Ned Tully: “You'll not need me at your elbow now, Captain. The sea's yours.”", `Retired today: ${lower(f.fate)}${f.next ? ` · next, ${lower(f.next.title)} at ${f.next.score}` : ''}`],
              ...base,
            });
            break;
          }
          case 'Salvaged':
            add({ id: 'first:salvage', kind: 'first', title: 'First salvage', lines: [`${p.units} ${good(p.good).toLowerCase()} and ${p.men} castaways, off ${p.name}`], tick: e.tick });
            break;
          case 'ContractFilled':
            add({ id: `contract:${e.tick}:${p.good}`, kind: 'contract', title: `The ${good(p.good).toLowerCase()} contract filled`, gold: Number(p.reward), into: 'purse', lines: [`${p.units} delivered to ${town(at)}`], ...base });
            break;
        }
      }
      // Goals newly done. The first few pay; one a first already says (her first prize) adds its pay to that card.
      const goals = careerGoals(content, state, settlements);
      // Once done, a goal stays said: a battery sold off and mounted again is not a deed twice.
      const before = captain.goalsDone;
      // Her name's rungs, kept with the goals so each is said once: each fate reached (what she would retire to), and
      // each famous pirate she is richer than once in the Top Ten (the poorest of them is the list's own goal).
      const f = fateNow(content, state);
      const ten = topTen(content, state);
      const you = ten.findIndex((r) => r.player);
      const poorest = ten.filter((r) => !r.player).at(-1);
      const fates = content.politics.career.fates.filter((x) => x.score > 0 && f.total >= x.score);
      const passed = goals.some((g) => g.id === 'topten' && g.done) ? ten.slice(you + 1).filter((r) => r.id && r.id !== poorest?.id) : [];
      const named = [...fates.map((x) => `fate:${x.score}`), ...passed.map((r) => `topten:${r.id}`)];
      const done = [...new Set([...(before ?? []), ...goals.filter((g) => g.done).map((g) => g.id), ...named])].sort();
      let gold = captain.gold;
      if (before) {
        const tick = mine[mine.length - 1]?.tick ?? state.tick;
        // Goals said before this (those done when she was first seen were never said, and never paid).
        let said = honours.filter((h) => h.goal && before.includes(h.goal)).length;
        for (const g of goals) {
          if (!g.done || before.includes(g.id)) continue;
          const pay = said++ < r.goals.paid ? r.goals.gold : 0;
          gold += pay;
          const paid = pay ? [`+${pay} gold: a goal done`] : [];
          const first = honours.findIndex((h) => h.goal === g.id && h.tick === tick);
          if (first >= 0) honours = honours.map((h, i) => (i === first ? { ...h, lines: [...(h.lines ?? []), ...paid] } : h));
          else add({ id: `goal:${g.id}`, kind: 'goal', title: DONE[g.id] ?? g.title, ...(pay ? { gold: pay, into: 'purse' as const } : {}), ...(g.unit ? { lines: [`${g.of.toLocaleString('en-GB')} ${g.unit}`] } : {}), goal: g.id, tick });
        }
      }
      if (before) {
        const tick = mine[mine.length - 1]?.tick ?? state.tick;
        for (const x of fates)
          if (!before.includes(`fate:${x.score}`))
            add({ id: `fate:${x.score}`, kind: 'fame', title: x.title, lines: ['If you retired today', ...(f.next && x.title === f.fate ? [`Next: ${lower(f.next.title)}, at a score of ${f.next.score}`] : [])], tick });
        for (const r of passed) if (!before.includes(`topten:${r.id}`)) add({ id: `topten:${r.id}`, kind: 'fame', title: `Richer than ${r.name}`, lines: [`${ordinal(you + 1)} in the Top Ten`], tick });
      }
      const same = honours === (captain.honours ?? []) && before?.join() === done.join();
      if (same) return state;
      return { ...state, captain: { ...captain, gold, honours: honours.slice(-HONOURS_SIZE), goalsDone: done } };
    },
  };
}
