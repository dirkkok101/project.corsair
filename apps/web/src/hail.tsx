import type { Ship, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { newsText } from '@corsair/systems-economy';

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
}

/** Speaking a ship at sea (PRD section 4): who she is, a hint of what she carries, and her news. */
export function Hail({ state, content, settlements, ship, news, close }: HailProps) {
  const ai = ship.ai!;
  const name = (id: string) => settlements.find((s) => s.id === id)?.name ?? id;
  const goods = Object.keys(ship.cargo).map((g) => content.goods.find((x) => x.id === g)?.name.toLowerCase() ?? g);
  const errand =
    ai.role === 'merchant'
      ? `${goods.length ? `Laden with ${goods.join(' and ')}` : 'Sailing light, in ballast'}, bound for ${name(ai.to)}.`
      : ai.role === 'patrol'
        ? `A man-of-war on patrol, bound for ${name(ai.to)}. Her gunports are closed.`
        : 'A lean, fast sloop with a hard-looking crew. She keeps a wary distance and answers short.';
  const items = news.map((id) => state.news?.find((n) => n.id === id)).filter((n) => n !== undefined);
  return (
    <div class="hail">
      <div class="hail-panel">
        <div class="hail-head">
          <span class="port-name">{ai.name}</span>
          <span class="port-sub">{shipTitle(ship)}</span>
        </div>
        <p>{errand}</p>
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
          <button disabled title="Coming with the sea battle">
            Attack
          </button>
          <button class="leave" onClick={close}>
            Part ways · H
          </button>
        </div>
      </div>
    </div>
  );
}
