import { dateOf, formatDate } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { difficultyOf } from '@corsair/data';
import type { ContentPack } from '@corsair/data';
import { careerScore, landOf, rankOf } from '@corsair/systems-economy';
import { NATIONS } from '@corsair/systems-politics';

export const COUNTRY: Record<string, string> = { england: 'England', france: 'France', netherlands: 'the Netherlands', spain: 'Spain' };

/** The fates' paintings (art/game/scenes), lowest fate first, as politics.json lists them. */
const FATE_ART = ['fate.beggar', 'fate.tavern', 'fate.merchant', 'fate.planter', 'fate.council', 'fate.governor', 'fate.legend'];
const PAINTINGS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../art/game/scenes/fate.*.png', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/, ''),
    url,
  ]),
);
/** What became of him, in a line, lowest fate first. */
const FATE_STORY = [
  'The sea took all you had. You end your days asking coins of the sailors you once commanded.',
  'You hang your cutlass over the bar of a waterfront tavern, and tell the young captains how it was done.',
  'Your warehouses on the quay hold the goods of half the Main; other men sail them now.',
  'A great house among the cane fields, and a veranda to watch the ships come in.',
  "You sit on the governor's council, and men who once called you a pirate call you sir.",
  'The Crown gave you an island to govern, and the captains who once chased you come to you for letters.',
  'They sing of you in every tavern from Tortuga to Cartagena.',
];

/** The career as it would score now (storyboard 7.1): each part with why, the total, the fate, and the next one. */
export function CareerCard({ content, state, final }: { content: ContentPack; state: WorldState; final?: boolean }) {
  const s = careerScore(content, state);
  const c = content.politics.career;
  const ladder = content.politics.ranks.ladder;
  const next = c.fates.find((f) => f.score > s.total);
  const row = (label: string, points: number, why: string) => (
    <tr>
      <th>{label}</th>
      <td class="career-points">{points}</td>
      <td class="career-why">{why}</td>
    </tr>
  );
  return (
    <div class="career">
      <table class="career-score">
        <tbody>
          {row('Trade fame', s.fames.trade, `a point for every ${c.fame.trade.goldPer.toLocaleString()} gold made trading`)}
          {row('War fame', s.fames.war, `a point a prize and a pirate beaten, ${c.fame.war.famous} a famous pirate`)}
          {row('Adventure fame', s.fames.adventure, `${c.fame.adventure.hoard} a hoard dug up, ${c.fame.adventure.mapPiece} a piece of a map`)}
          {row('Wealth', s.wealth, `${s.gold.toLocaleString()} gold, yours and your share of the chest: a point every ${c.score.goldPer.toLocaleString()}`)}
          {row('Land', s.land, s.acres ? `${s.acres} acres: a point every ${c.score.acresPer}` : 'no title yet: a Baron is given land')}
          {row('Rank', s.rank, s.ranks.length ? s.ranks.map((r) => `${r.name} of ${COUNTRY[r.nation]} (${r.points})`).join(', ') : 'no rank with any nation: a letter of marque is the first')}
        </tbody>
      </table>
      <div class="career-total">
        <div>
          <div class="career-score-big">
            Score <span class="career-num">{s.total}</span>
          </div>
          <div class="book-sub">
            × {s.multiple} for {difficultyOf(content, state.difficulty).name} ·{' '}
            {next ? `the next fate at ${next.score}` : 'the highest fate there is'}
          </div>
        </div>
        {final ? null : (
          <div class="career-fate">
            <span class="book-sub">If you retired now</span>
            <b>{s.fate}</b>
          </div>
        )}
      </div>
      <div class="book-sub career-ranks">
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

/** Retiring, confirmed (storyboard 7.1): the score as it stands, and the choice. */
export function RetireConfirm({ content, state, retire, cancel }: { content: ContentPack; state: WorldState; retire: () => void; cancel: () => void }) {
  return (
    <div class="k-paper career-panel">
      <div class="career-head">
        <h2 class="book-title">Retire?</h2>
        <span class="book-sub">Your career ends here and is scored. There is no going back to sea.</span>
      </div>
      <div class="book-rule" />
      <CareerCard content={content} state={state} />
      <div class="career-actions">
        <button class="k-btn primary" onClick={retire}>
          Retire now
        </button>
        <button class="k-btn paper" onClick={cancel}>
          Not yet
        </button>
      </div>
    </div>
  );
}

/** The end of the career (storyboard 7.2): the fate's painting, what became of him, and his score. */
export function Ending({ content, state, again }: { content: ContentPack; state: WorldState; again: () => void }) {
  const retired = state.captain!.retired!;
  const s = careerScore(content, state);
  const rung = Math.max(0, content.politics.career.fates.findIndex((f) => f.title === retired.fate));
  const painting = PAINTINGS[FATE_ART[rung] ?? ''];
  const date = formatDate(dateOf(content.maps.caribbean.startDate, Math.floor(retired.tick / content.calendar.ticksPerDay)));
  return (
    <div class="ending" style={painting ? { backgroundImage: `url(${painting})` } : undefined}>
      <div class="ending-text">
        <div class="moment-kicker">Retired {date}</div>
        <h2 class="moment-title">{retired.fate}</h2>
        <p class="ending-story">{FATE_STORY[rung]}</p>
        <div class="book-rule light" />
        <div class="ending-score">
          <div>
            <div class="ending-number">{retired.score}</div>
            <div class="k-sub">score</div>
          </div>
          <div class="ending-parts">
            <span>
              Fame: trade {s.fames.trade} · war {s.fames.war} · adventure {s.fames.adventure}
            </span>
            <span>
              Wealth {s.wealth} · land {s.land} · rank {s.rank}
              {s.ranks.length ? ` (${s.ranks.map((r) => `${r.name} of ${COUNTRY[r.nation]}`).join(', ')})` : ''}
            </span>
            {s.multiple !== 1 ? <span>× {s.multiple} for {difficultyOf(content, state.difficulty).name}</span> : null}
          </div>
        </div>
        <div class="moment-actions flush">
          <button class="k-btn primary" onClick={again}>
            Start a new career
          </button>
        </div>
      </div>
    </div>
  );
}
