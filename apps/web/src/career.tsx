import type { WorldState } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { careerScore, landOf, rankOf } from '@corsair/systems-economy';
import { NATIONS } from '@corsair/systems-politics';

export const COUNTRY: Record<string, string> = { england: 'England', france: 'France', netherlands: 'the Netherlands', spain: 'Spain' };

/** The career as it would score now: the three fames, wealth, land, ranks, the difficulty's multiple, the fate. */
export function CareerCard({ content, state, final }: { content: ContentPack; state: WorldState; final?: boolean }) {
  const s = careerScore(content, state);
  const c = content.politics.career;
  const ladder = content.politics.ranks.ladder;
  const row = (label: string, points: number, why: string) => (
    <tr>
      <td>{label}</td>
      <td class="career-points">{points}</td>
      <td class="port-sub">{why}</td>
    </tr>
  );
  return (
    <div class="career">
      <table class="career-score">
        <tbody>
          {row('Trade fame', s.fames.trade, `a point for every ${c.fame.trade.goldPer.toLocaleString()} gold made trading`)}
          {row('War fame', s.fames.war, `a point a prize and a pirate beaten, ${c.fame.war.famous} a famous pirate`)}
          {row('Adventure fame', s.fames.adventure, `${c.fame.adventure.hoard} a hoard dug up, ${c.fame.adventure.mapPiece} a piece of a map`)}
          {row('Wealth', s.wealth, `${s.gold.toLocaleString()} gold (yours, and your share of the chest): a point every ${c.score.goldPer.toLocaleString()}`)}
          {row('Land', s.land, `${s.acres} acres: a point every ${c.score.acresPer}`)}
          {row('Rank', s.rank, s.ranks.length ? s.ranks.map((r) => `${r.name} of ${COUNTRY[r.nation]} (${r.points})`).join(', ') : 'no rank with any nation: a letter of marque is the first')}
        </tbody>
      </table>
      <div class="career-total">
        Score {s.total}
        {s.multiple !== 1 ? <span class="port-sub"> (times {s.multiple} for the difficulty)</span> : null}
        {final ? null : <div class="port-sub">If you retired now: {s.fate}.</div>}
      </div>
      <div class="port-sub career-ranks">
        {NATIONS.map((n) => {
          const r = rankOf(content, state.captain, n);
          const acres = landOf(content, state.captain, n);
          return (
            <span key={n}>
              {COUNTRY[n]}: {r < 0 ? 'no letter' : ladder[r]!.name}
              {acres ? `, ${acres} acres` : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Retiring, confirmed: the score as it stands, and the choice. */
export function RetireConfirm({ content, state, retire, cancel }: { content: ContentPack; state: WorldState; retire: () => void; cancel: () => void }) {
  return (
    <div class="port-panel career-panel">
      <div class="port-name">Retire?</div>
      <p class="port-sub">Your career ends here and is scored. There is no going back to sea.</p>
      <CareerCard content={content} state={state} />
      <div class="career-actions">
        <button onClick={retire}>Retire now</button>
        <button class="leave" onClick={cancel}>
          Not yet
        </button>
      </div>
    </div>
  );
}

/** The end of the career: what became of him, and his score. */
export function Ending({ content, state, again }: { content: ContentPack; state: WorldState; again: () => void }) {
  const retired = state.captain!.retired!;
  return (
    <div class="ending">
      <div class="port-panel career-panel">
        <div class="port-name">{retired.fate}</div>
        <p class="port-sub">You retired with a score of {retired.score}.</p>
        <CareerCard content={content} state={state} final />
        <div class="career-actions">
          <button onClick={again}>Start a new career</button>
        </div>
      </div>
    </div>
  );
}
