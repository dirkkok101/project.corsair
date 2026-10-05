import type { WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { cargoUsed, quote, referenceStock } from '@corsair/systems-economy';
import { useEffect, useState } from 'preact/hooks';

export interface PortProps {
  state: WorldState;
  content: ContentPack;
  town: PlacedSettlement;
  shipId: string;
  send: (command: import('@corsair/core').Command) => void;
  /** Where each building stands on screen, in CSS pixels within the stage. */
  hotspots: Partial<Record<Service, { left: number; top: number; width: number; height: number }>>;
}

export type Service = 'merchant' | 'tavern' | 'governor' | 'shipwright';
const SERVICES: { id: Service; name: string }[] = [
  { id: 'merchant', name: 'Merchant' },
  { id: 'tavern', name: 'Tavern' },
  { id: 'governor', name: 'Governor' },
  { id: 'shipwright', name: 'Shipwright' },
];
const NATION: Record<PlacedSettlement['nation'], string> = {
  spain: 'Spanish',
  england: 'English',
  france: 'French',
  netherlands: 'Dutch',
  pirate: 'Pirate',
};
const ALL = 1_000_000; // "as many as possible": the sim stops at gold, hold or stock

/** The port screen: the harbour scene with its buildings to click, and the merchant's market over it. */
export function Port({ state, content, town, shipId, send, hotspots }: PortProps) {
  // The market opens on arrival; closing it leaves the harbour to look at.
  const [open, setOpen] = useState<Service | undefined>('merchant');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const ship = state.ships[shipId]!;
  const market = state.markets?.[town.id] ?? {};
  const gold = state.captain?.gold ?? 0;
  const capacity = content.ships[ship.classId]!.cargo;
  const used = cargoUsed(ship);
  const trade = (type: 'Buy' | 'Sell', good: string, quantity: number) => send({ type, shipId, good, quantity });

  const spots = SERVICES.filter((s) => hotspots[s.id]).map((s) => {
    const r = hotspots[s.id]!;
    const ready = s.id === 'merchant';
    return (
      <button
        key={s.id}
        class={`port-spot${ready ? '' : ' soon'}`}
        style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
        title={ready ? s.name : `${s.name}: coming soon`}
        onClick={() => ready && setOpen(s.id)}
      >
        <span>{ready ? s.name : `${s.name} · soon`}</span>
      </button>
    );
  });

  if (!open) {
    return (
      <div class="port port-scene">
        {spots}
        <div class="port-bar">
          <span class="port-name">{town.name}</span>
          <span>{gold.toLocaleString()} gold</span>
          <button class="leave" onClick={() => setOpen('merchant')}>
            Merchant
          </button>
          <button class="leave" onClick={() => send({ type: 'Undock', shipId })}>
            Set sail · E
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="port">
      <div class="port-panel">
        <header class="port-head">
          <div>
            <div class="port-name">{town.name}</div>
            <div class="port-sub">
              {NATION[town.nation]} {town.type === 'haven' ? 'pirate haven' : town.type === 'capital' ? 'capital' : town.size}
            </div>
          </div>
          <div class="port-purse">
            <div>{gold.toLocaleString()} gold</div>
            <div>
              Hold {used} / {capacity}
            </div>
          </div>
        </header>

        <nav class="port-tabs">
          {SERVICES.map((s) => (
            <span key={s.id} class={s.id === 'merchant' ? 'active' : 'soon'} title={s.id === 'merchant' ? '' : 'Coming soon'}>
              {s.name}
            </span>
          ))}
          <button class="port-close" onClick={() => setOpen(undefined)} title="See the harbour (Esc)">
            Harbour · Esc
          </button>
        </nav>

        <table class="market">
          <thead>
            <tr>
              <th>Goods</th>
              <th>Buy</th>
              <th>Sell</th>
              <th>Hold</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {content.goods.map((g) => {
              const stock = market[g.id] ?? 0;
              const q = quote(content, town, g.id, stock);
              const held = ship.cargo[g.id] ?? 0;
              // How this port's price sits against the good's base: cheap here, or dear.
              const level = q.buy / g.basePrice;
              const trend = level < 0.9 ? 'cheap' : level > 1.25 ? 'dear' : '';
              const scarce = stock < referenceStock(content, town, g.id) * 0.25;
              return (
                <tr key={g.id}>
                  <td>
                    {g.name} {trend ? <span class={`trend ${trend}`}>{trend}</span> : null}
                    {scarce ? <span class="trend scarce">scarce</span> : null}
                  </td>
                  <td class="num">{q.buy}</td>
                  <td class="num">{q.sell}</td>
                  <td class="num">{held || ''}</td>
                  <td class="actions">
                    <button onClick={() => trade('Buy', g.id, 1)} disabled={stock < 1 || gold < q.buy || used >= capacity}>
                      Buy 1
                    </button>
                    <button onClick={() => trade('Buy', g.id, 10)} disabled={stock < 1 || gold < q.buy || used >= capacity}>
                      10
                    </button>
                    <button onClick={() => trade('Buy', g.id, ALL)} disabled={stock < 1 || gold < q.buy || used >= capacity}>
                      Max
                    </button>
                    <button onClick={() => trade('Sell', g.id, 1)} disabled={held < 1}>
                      Sell 1
                    </button>
                    <button onClick={() => trade('Sell', g.id, ALL)} disabled={held < 1}>
                      All
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <footer class="port-foot">
          <span>Prices are per unit; each unit you trade moves the price.</span>
          <button class="leave" onClick={() => send({ type: 'Undock', shipId })}>
            Set sail · E
          </button>
        </footer>
      </div>
    </div>
  );
}
