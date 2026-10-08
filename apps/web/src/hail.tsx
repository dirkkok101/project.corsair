import type { Ship, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { newsText } from '@corsair/systems-economy';
import { shipKind } from './ui-art';

export const NATION_ADJECTIVE: Record<string, string> = {
  spain: 'Spanish',
  england: 'English',
  france: 'French',
  netherlands: 'Dutch',
  pirate: 'pirate',
};

/** "Dutch fluyt": who a ship is, as the lookout would call it. */
export function shipTitle(ship: Ship): string {
  const cls = ship.classId.replace(/^ship\./, '').replace(/_/g, ' ');
  return `${NATION_ADJECTIVE[ship.ai?.nation ?? ''] ?? ''} ${cls}`.trim();
}

export interface HailProps {
  state: WorldState;
  content: ContentPack;
  settlements: PlacedSettlement[];
  ship: Ship;
  /** News ids the hail brought that the captain hadn't heard. */
  news: string[];
  close: () => void;
  /** Open fire: starts a sea battle. */
  attack: () => void;
  /** The nation whose letter of marque makes this attack lawful, if any. */
  lawful?: string;
}

/** Speaking a ship at sea (PRD section 4): who she is, a hint of what she carries, and her news. */
export function Hail({ state, content, settlements, ship, news, close, attack, lawful }: HailProps) {
  const ai = ship.ai!;
  const name = (id: string) => settlements.find((s) => s.id === id)?.name ?? id;
  const goods = Object.keys(ship.cargo).map((g) => content.goods.find((x) => x.id === g)?.name.toLowerCase() ?? g);
  const errand =
    ai.role === 'merchant'
      ? `${goods.length ? `Laden with ${goods.join(' and ')}` : 'Sailing light, in ballast'}, bound for ${name(ai.to)}.`
      : ai.role === 'patrol'
        ? `A man-of-war on patrol, bound for ${name(ai.to)}. Her gunports are closed.`
        : `A ${shipKind(ship.classId)} with a hard-looking crew. She keeps a wary distance and answers short.`;
  const prizes = ai.prizes ?? [];
  const mine = prizes.filter((p) => p.takenFrom === 'player');
  const kind = (classId: string) => classId.replace(/^ship\./, '').replace(/_/g, ' ');
  const towing = prizes.length
    ? `She has ${prizes.length === 1 ? 'a prize' : `${prizes.length} prizes`} in tow${
        mine.length ? `: ${mine.map((p) => `your ${kind(p.classId)} ${p.name}`).join(' and ')}${mine.length < prizes.length ? ' among them' : ''}` : ''
      }. Take her and ${prizes.length === 1 ? 'she is' : 'they are'} free.`
    : '';
  const items = news.map((id) => state.news?.find((n) => n.id === id)).filter((n) => n !== undefined);
  return (
    <div class="hail">
      <div class="hail-panel">
        <div class="hail-head">
          <span class="port-name">{ai.name}</span>
          <span class="port-sub">{shipTitle(ship)}</span>
        </div>
        <p>{errand}</p>
        {towing ? <p class={mine.length ? 'hail-yours' : undefined}>{towing}</p> : null}
        <div class="hail-news">
          {items.length ? (
            items.map((n) => (
              <div key={n.id}>
                <span class="trend want">news</span> {newsText(content, n, name(n.settlementId))}
              </div>
            ))
          ) : (
            <div class="port-sub">No news you haven't heard.</div>
          )}
        </div>
        <div class="hail-actions">
          <button class="attack" onClick={attack} title={ai.nation === 'pirate' ? 'A pirate: fair game' : `Costs standing with the ${NATION_ADJECTIVE[ai.nation]}`}>
            Attack
            {ai.nation === 'pirate'
              ? ''
              : lawful
                ? ` · lawful under your ${NATION_ADJECTIVE[lawful]} letter`
                : ` · angers the ${NATION_ADJECTIVE[ai.nation]}`}
          </button>
          <button class="leave" onClick={close}>
            Part ways · H
          </button>
        </div>
      </div>
    </div>
  );
}
