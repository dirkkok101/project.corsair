import type { Captain, Honour, Nation } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { rankOf } from '@corsair/systems-economy';
import { ART } from '../ui-art';

// The deed card (docs/design/first-voyage.md section 2, Design canvas board 13): every achievement said out loud.
// A seal with the deed's mark, what kind of deed, what she did in the past tense, the one figure counted up and where
// it went, up to two lines with the bar they moved, what it added to her retirement score, and the one thing to aim
// for next. Small at sea (it slides away),
// standard in port or after a fight (it stays until dismissed); a rank keeps its own ceremony, the promotion moment.

const KIND: Record<Honour['kind'], string> = {
  first: 'A first',
  goal: 'Goal done',
  mission: 'Mission',
  bounty: 'Bounties',
  trade: 'Trade',
  marque: 'Letter of marque',
  rank: 'Rank',
  hoard: 'Treasure',
  contract: 'Contract',
  fame: 'Your name',
  find: 'A find',
};
const SEAL: Record<Honour['kind'], string> = {
  first: 'ui.icon.chest',
  goal: 'ui.icon.cannon_loaded',
  mission: 'ui.icon.course',
  bounty: 'ui.icon.chest',
  trade: 'ui.icon.gold',
  marque: 'ui.icon.anchor',
  rank: 'ui.icon.anchor',
  hoard: 'ui.icon.chest',
  contract: 'ui.icon.good.sugar',
  fame: 'ui.icon.anchor',
  find: 'ui.icon.chest',
};
const INTO: Record<NonNullable<Honour['into']>, string> = {
  purse: 'gold into your purse',
  chest: 'gold into the plunder chest',
  owed: 'gold owed you',
  profit: 'profit',
};

/** How long a small card shows at sea, and how long its figure takes to count up. */
export const DEED_SMALL_MS = 6000;
const COUNT_MS = 700;

/** The deed's figure in a few characters, for the Deeds page ("+340 chest", "+512 profit"). */
export function deedFigure(h: Honour): string {
  if (h.gold === undefined) return h.lines?.[0] ?? '';
  const n = `+${h.gold.toLocaleString('en-GB')}`;
  return h.into === 'chest' ? `${n} chest` : h.into === 'profit' ? `${n} profit` : h.into === 'owed' ? `${n} owed` : n;
}

/** The bar a deed moved: merit toward her next rank with the nation it was done for. */
export function meritBar(content: ContentPack, captain: Captain | undefined, nation: Nation | undefined): { share: number; next: string } | undefined {
  if (!nation || !captain) return undefined;
  const ladder = content.politics.ranks.ladder;
  const rank = rankOf(content, captain, nation);
  const rung = ladder[rank + 1];
  if (rank < 0 || !rung) return undefined;
  const merit = captain.merit?.[nation] ?? 0;
  const from = ladder[rank]!.merit;
  return { share: Math.max(0, Math.min(1, (merit - from) / (rung.merit - from))), next: `${rung.merit - merit} more merit to ${rung.name}` };
}

export function DeedCard({
  honour,
  weight,
  age,
  next,
  bar,
  score,
  close,
}: {
  honour: Honour;
  weight: 'small' | 'standard';
  /** Milliseconds since it was first shown, for the count-up. */
  age: number;
  /** The one thing to aim for now. */
  next?: string;
  bar?: number;
  /** What it added to her retirement score. */
  score?: number;
  close: () => void;
}) {
  const scored = score ? <span class="deed-score">+{score} to your score</span> : null;
  const shown = honour.gold === undefined ? undefined : Math.round(honour.gold * Math.min(1, age / COUNT_MS));
  const seal = ART[SEAL[honour.kind]] ? <img src={ART[SEAL[honour.kind]]} alt="" draggable={false} /> : null;
  if (weight === 'small')
    return (
      <div class="deed deed-small k-paper" role="status">
        <span class="deed-seal">{seal}</span>
        <div class="deed-body">
          <span class="deed-kind">{KIND[honour.kind]}</span>
          <span class="deed-title">{honour.title}</span>
          {shown !== undefined ? (
            <span class={`deed-note${honour.into === 'profit' ? ' gain' : ''}`}>
              +{shown.toLocaleString('en-GB')} {INTO[honour.into ?? 'purse']}
            </span>
          ) : next ? (
            <span class="deed-note">Next: {next}</span>
          ) : null}
          {scored}
        </div>
      </div>
    );
  return (
    <div class="deed deed-standard k-paper" role="dialog" aria-label={honour.title}>
      <div class="deed-head">
        <span class="deed-seal">{seal}</span>
        <div class="deed-body">
          <span class="deed-kind">A deed · {KIND[honour.kind].toLowerCase()}</span>
          <span class="deed-title">{honour.title}</span>
        </div>
      </div>
      {shown !== undefined ? (
        <div class="deed-figure">
          <span class="deed-gold">+{shown.toLocaleString('en-GB')}</span>
          <span class="deed-into">{INTO[honour.into ?? 'purse']}</span>
        </div>
      ) : null}
      {(honour.lines ?? []).slice(0, 2).map((l) => (
        <div key={l} class="deed-line">
          {l}
        </div>
      ))}
      {scored ? <div class="deed-line">{scored}</div> : null}
      {bar !== undefined ? (
        <div class="deed-bar">
          <div style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      ) : null}
      <div class="deed-foot">
        <span class="deed-next">{next ? <>Next: <b>{next}</b></> : null}</span>
        <button class="k-btn small primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
