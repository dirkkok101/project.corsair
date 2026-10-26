import type { ComponentChildren } from 'preact';
import { ART } from '../ui-art';

// The UI kit (docs/design/ui-conversion.md, slice S1): the few pieces every screen of the storyboard is built from.
// Wood holds what you press, paper what you read; people speak one line; a word and one number say what a figure means.

/** The people's busts (art/game/people, imported by tools/art/import_ui.ts), by id. */
const PEOPLE = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../../art/game/people/*.png', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/, ''),
    url,
  ]),
);

/** A panel of dark tarred wood edged in brass: the frame for controls. */
export function Wood({ class: cls, children }: { class?: string; children: ComponentChildren }) {
  return <div class={`k-wood${cls ? ` ${cls}` : ''}`}>{children}</div>;
}

/** A sheet of parchment: the frame for what you read. */
export function Paper({ class: cls, children }: { class?: string; children: ComponentChildren }) {
  return <div class={`k-paper${cls ? ` ${cls}` : ''}`}>{children}</div>;
}

/** A key cap, as the keyboard shows it. */
export function Key({ k }: { k: string }) {
  return <kbd class="k-key">{k}</kbd>;
}

/**
 * Someone speaking: their bust (a silhouette with their name until painted), who they are, and one line.
 * `children` are the replies or actions beneath.
 */
/** Straight quotes turned the right way: the voice face draws a straight one as a closing quote. */
export const curly = (s: string) => s.replace(/"([^"]*)"/g, '“$1”');

export function Speech({ bust, who, line, children }: { bust: string; who: string; line: string; children?: ComponentChildren }) {
  return (
    <div class="k-speech">
      <Bust id={bust} label={who} />
      <div class="k-speech-body">
        <div class="k-who">{who}</div>
        <div class="k-say">{curly(line)}</div>
        {children}
      </div>
    </div>
  );
}

/** A person's bust, or a labelled silhouette while their painting is missing. */
export function Bust({ id, label }: { id: string; label: string }) {
  const url = PEOPLE[id];
  return url ? (
    <img class="k-bust" src={url} alt={label} draggable={false} />
  ) : (
    <div class="k-bust k-bust-missing" role="img" aria-label={label}>
      <svg width="96" height="110" viewBox="0 0 96 110" aria-hidden="true">
        <circle cx="48" cy="38" r="24" fill="#5a4231" />
        <path d="M8 110 C10 76 30 66 48 66 C66 66 86 76 88 110 Z" fill="#5a4231" />
      </svg>
    </div>
  );
}

/** One figure in a strip: an icon and its value, with what it means on hover. */
export function Stat({ icon, value, title, low, rise }: { icon: string; value: string; title: string; low?: boolean; rise?: { amount: number; key: number } }) {
  return (
    <span class={`k-stat${low ? ' low' : ''}`} title={title}>
      {ART[icon] ? <img class="k-stat-icon" src={ART[icon]} alt="" draggable={false} /> : null}
      {value}
      {rise ? <Rise rise={rise} /> : null}
    </span>
  );
}

/** Gold just paid in, rising off the purse and fading (keyed, so each payment rises afresh); its parent is positioned. */
export function Rise({ rise = risen() }: { rise?: { amount: number; key: number } }) {
  return rise ? (
    <span key={rise.key} class="k-stat-rise">
      +{rise.amount.toLocaleString()}
    </span>
  ) : null;
}

/** The purse's last rise (main.tsx sets it as gold comes in), shown for PURSE_RISE_MS by every purse on screen. */
export const purseRise: { amount: number; at: number } = { amount: 0, at: -Infinity };
/** Gold into the plunder chest (a prize's purse, bounties, a hoard), risen off the chest the same way. */
export const chestRise: { amount: number; at: number } = { amount: 0, at: -Infinity };
const PURSE_RISE_MS = 1800;
/** The rise to show now, if one is still in the air: the purse's, or the chest's. */
export function risen(now = performance.now(), rise = purseRise): { amount: number; key: number } | undefined {
  return now - rise.at < PURSE_RISE_MS ? { amount: rise.amount, key: rise.at } : undefined;
}

/**
 * A state in words with its direction ("Content, falling"), in place of a bare bar: `bands` from the worst up,
 * each with the least value it starts at.
 */
export function bandOf(value: number, bands: [from: number, word: string][], trend?: number): string {
  const word = [...bands].reverse().find(([from]) => value >= from)?.[1] ?? bands[0]![1];
  return trend && Math.abs(trend) > 0.5 ? `${word}, ${trend > 0 ? 'rising' : 'falling'}` : word;
}
