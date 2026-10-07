import { inPort } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { shipStats } from '@corsair/data';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import {
  bountiesOwed,
  cargoUsed,
  crewOf,
  hasGovernor,
  marquePrice,
  newsAt,
  newsText,
  portTrade,
  quote,
  referenceStock,
  daysUnpaid,
  foodDays,
  moraleOf,
  moraleWord,
  plunderShares,
  repairCost,
  sellDepth,
  wagesOwed,
  sellsGuns,
  sellsUpgrade,
  tradeLean,
} from '@corsair/systems-economy';
import { enemiesOf, legalTarget, NATIONS } from '@corsair/systems-politics';
import { shipTitle } from './hail';
import { Art, GoodIcon } from './ui-art';
import { useEffect, useState } from 'preact/hooks';

export interface PortProps {
  state: WorldState;
  content: ContentPack;
  town: PlacedSettlement;
  /** Every port, to name the ones whose prices the captain remembers. */
  settlements: PlacedSettlement[];
  shipId: string;
  send: (command: import('@corsair/core').Command) => void;
  /** Where each building stands on screen, in CSS pixels within the stage. */
  hotspots: Partial<Record<Service, { left: number; top: number; width: number; height: number }>>;
  /** Told which service is open (undefined for the harbour view), so its interior can be shown. */
  onOpen: (service: Service | undefined) => void;
  /** Said once on arrival: men who deserted as she made port. */
  notice?: string;
  /** Today's date: the clock stands still in port. */
  date: string;
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
/** A market that takes fewer units than this before its price falls a quarter is flagged as small. */
const SHALLOW = 15;

/** "takes ~N": how much a market absorbs; small ones are flagged, as selling a full hold there crashes the price. */
function Takes({ depth }: { depth: number }) {
  return (
    <span class={depth < SHALLOW ? 'takes shallow' : 'takes'} title="Units it takes before its sell price falls by a quarter">
      {depth >= 999 ? '999+' : `~${depth}`}
    </span>
  );
}

/** Services that work so far; the rest are drawn but marked "soon". */
const READY: Service[] = ['merchant', 'tavern', 'shipwright', 'governor'];
const ALL = 1_000_000; // "as many as possible": the sim stops at gold, hold or stock

/** The port screen: the harbour scene with its buildings to click, and the merchant's market over it. */
export function Port({ state, content, town, settlements, shipId, send, hotspots, onOpen, notice, date }: PortProps) {
  // The market opens on arrival; closing it leaves the harbour to look at.
  const [open, setOpen] = useState<Service | undefined>('merchant');
  useEffect(() => onOpen(open), [open]);
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
  const known = state.captain?.knownPrices ?? {};
  const today = Math.floor(state.tick / content.calendar.ticksPerDay);
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  const lean = portTrade(content, town);
  /** The best price the captain has seen another port pay for a good, and when. */
  const bestSale = (good: string) => {
    let best: { name: string; sell: number; age: number; depth?: number } | undefined;
    for (const [id, seen] of Object.entries(known)) {
      const sell = seen.prices[good]?.sell;
      if (id === town.id || sell === undefined || (best && sell <= best.sell)) continue;
      best = {
        name: settlements.find((x) => x.id === id)?.name ?? id,
        sell,
        age: today - seen.day,
        depth: seen.prices[good]?.depth,
      };
    }
    return best;
  };

  // Rumours this port has heard that the captain hasn't, for the tavern's badge.
  const rumours = newsAt(content, state, settlements, town.id);
  const unheard = rumours.filter((n) => !(state.captain?.heard ?? []).includes(n.id)).length;
  const label = (s: { id: Service; name: string }) => (s.id === 'tavern' && unheard ? `${s.name} (${unheard})` : s.name);

  const spots = SERVICES.filter((s) => hotspots[s.id]).map((s) => {
    const r = hotspots[s.id]!;
    const ready = READY.includes(s.id);
    return (
      <button
        key={s.id}
        class={`port-spot${ready ? '' : ' soon'}`}
        style={{
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        }}
        title={ready ? s.name : `${s.name}: coming soon`}
        onClick={() => ready && setOpen(s.id)}
      >
        <span>{ready ? label(s) : `${s.name} · soon`}</span>
      </button>
    );
  });

  if (!open) {
    return (
      <div class="port port-scene">
        {spots}
        <div class="port-bar">
          <span class="port-name">{town.name}</span>
          <span class="port-sub">{date}</span>
          <button class="leave" onClick={() => setOpen('merchant')}>
            Merchant
          </button>
          <button class="leave" onClick={() => setOpen('tavern')}>
            {label({ id: 'tavern', name: 'Tavern' })}
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
            <div class="port-lean">
              {lean.exports.length ? (
                <span>
                  <span class="trend export">exports</span> {lean.exports.map(goodName).join(', ')}
                </span>
              ) : null}
              {lean.wants.length ? (
                <span>
                  <span class="trend want">wants</span> {lean.wants.map(goodName).join(', ')}
                </span>
              ) : null}
            </div>
          </div>
          <div class="port-purse">
            <div class="port-sub">{date}</div>
            {town.nation !== 'pirate' ? (
              <div class="port-sub">
                Standing with the {NATION[town.nation]}: {state.captain?.standing?.[town.nation] ?? 0}
              </div>
            ) : null}
          </div>
        </header>
        {notice ? <div class="port-notice">{notice}</div> : null}

        <nav class="port-tabs">
          {SERVICES.map((s) =>
            READY.includes(s.id) ? (
              <button key={s.id} class={`port-tab${s.id === open ? ' active' : ''}`} onClick={() => setOpen(s.id)}>
                {label(s)}
              </button>
            ) : (
              <span key={s.id} class="soon" title="Coming soon">
                {s.name}
              </span>
            ),
          )}
          <button class="port-close" onClick={() => setOpen(undefined)} title="See the harbour (Esc)">
            Harbour · Esc
          </button>
        </nav>

        {open === 'governor' ? (
          <Governor content={content} state={state} town={town} shipId={shipId} send={send} />
        ) : open === 'shipwright' ? (
          <Shipwright content={content} state={state} town={town} shipId={shipId} send={send} />
        ) : open === 'tavern' ? (
          <Tavern
            content={content}
            state={state}
            settlements={settlements}
            town={town.id}
            rumours={rumours}
            hear={() => send({ type: 'HearNews', shipId })}
            shipId={shipId}
            send={send}
          />
        ) : (
          <table class="market">
            <thead>
              <tr>
                <th>Goods</th>
                <th>Buy</th>
                <th>Sell</th>
                <th title="Units this market takes before its sell price falls by a quarter">Takes</th>
                <th>Hold</th>
                <th title="The best price you have seen another port pay">Best sale you know</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {content.goods.map((g) => {
                const stock = market[g.id] ?? 0;
                const q = quote(content, town, g.id, stock);
                const held = ship.cargo[g.id] ?? 0;
                // Trade tags say which way to deal: buy where the port makes the good, sell where it needs it.
                const side = tradeLean(content, town, g.id);
                const tag = side === 'exports' ? 'buy here' : side === 'wants' ? 'sells well' : '';
                const scarce = stock < referenceStock(content, town, g.id) * 0.25;
                const cost = held > 0 && ship.paid?.[g.id] !== undefined ? Math.round(ship.paid[g.id]! / held) : undefined;
                const best = bestSale(g.id);
                const margin = best && best.sell - q.buy;
                return (
                  <tr key={g.id}>
                    <td>
                      <GoodIcon id={g.id} /> {g.name} {tag ? <span class={`trend ${side === 'exports' ? 'export' : 'want'}`}>{tag}</span> : null}
                      {scarce ? <span class="trend scarce">scarce</span> : null}
                    </td>
                    <td class="num">{q.buy}</td>
                    <td class={`num${cost === undefined ? '' : q.sell > cost ? ' gain' : ' loss'}`}>{q.sell}</td>
                    <td class="num">
                      <Takes depth={sellDepth(content, town, g.id, stock)} />
                    </td>
                    <td class="num hold">
                      {held || ''}
                      {g.id === 'food' && held ? <span class="paid" title="How long it lasts this crew">{` · ${Math.floor(foodDays(content, ship))} days`}</span> : null}
                      {cost !== undefined ? (
                        <span class="paid" title="What you paid per unit">
                          {' '}
                          @{cost}
                        </span>
                      ) : null}
                    </td>
                    <td class="best">
                      {best ? (
                        <>
                          {best.name} {best.sell}
                          <span class="age"> · {best.age === 0 ? 'today' : `${best.age}d`}</span>
                          {best.depth !== undefined ? (
                            <>
                              {' · '}
                              <Takes depth={best.depth} />
                            </>
                          ) : null}
                          {/* Only a run that pays is flagged: buy here, sell there. */}
                          {margin! > 0 ? (
                            <span class="gain" title="Profit per unit, buying here and selling there">
                              {' '}
                              ▲+{margin}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span class="age">—</span>
                      )}
                    </td>
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
        )}

        <footer class="port-foot">
          <span>{open === 'merchant' ? 'Prices are per unit; each unit you trade moves the price.' : ''}</span>
          <button class="leave" onClick={() => send({ type: 'Undock', shipId })}>
            Set sail · E
          </button>
        </footer>
      </div>
    </div>
  );
}

interface TavernProps {
  content: ContentPack;
  state: WorldState;
  settlements: PlacedSettlement[];
  town: string;
  rumours: import('@corsair/core').NewsItem[];
  hear: () => void;
  shipId: string;
  send: PortProps['send'];
}

/** Hands for the ship: men sign on at the tavern for a bounty each, up to her berths. */
function Recruit({ content, state, shipId, send }: Pick<TavernProps, 'content' | 'state' | 'shipId' | 'send'>) {
  const ship = state.ships[shipId]!;
  const cls = content.ships[ship.classId]!;
  const crew = crewOf(content, ship);
  const price = content.combat.port.recruitGold;
  const berths = shipStats(content, ship).maxCrew;
  const room = berths - crew;
  return (
    <div class="recruit">
      <span>
        Crew {crew} / {berths}
        {crew < cls.minCrew ? <span class="trend scarce">short-handed</span> : null}
      </span>
      <button disabled={room <= 0} onClick={() => send({ type: 'Recruit', shipId, count: 10 })}>
        Sign on 10 · {10 * price} gold
      </button>
      <button disabled={room <= 0} onClick={() => send({ type: 'Recruit', shipId, count: room })}>
        Fill the berths · {room * price} gold
      </button>
      {room > 0 ? (
        <span class="port-sub">
          Each 10 more men: food lasts {Math.floor(foodDays(content, { ...ship, crew: crew + 10 }))} days instead of {Math.floor(foodDays(content, ship))}, and wages
          rise {10 * content.crew.wagesPerManDay} gold a day
        </span>
      ) : null}
    </div>
  );
}

/**
 * Paying the crew (PRD section 4, two purses): divide the plunder chest (the captain takes his share, the
 * crew the rest per head, and their morale follows the size of it), or pay wages from the captain's purse
 * for every day since they were last paid.
 */
function CrewPay({ content, state, shipId, send }: Pick<TavernProps, 'content' | 'state' | 'shipId' | 'send'>) {
  const ship = state.ships[shipId]!;
  const morale = moraleOf(content, state);
  const share = plunderShares(content, state, ship);
  const owed = wagesOwed(content, state, ship);
  const days = daysUnpaid(content, state);
  return (
    <div class="recruit crew-pay">
      <span>
        <Art id="ui.icon.morale" class="inline-icon" /> {moraleWord(content, morale)} ({Math.round(morale)}) ·{' '}
        <Art id="ui.icon.chest" class="inline-icon" /> chest {Math.round(share.chest)} · unpaid {days} days
      </span>
      <button disabled={share.chest <= 0} onClick={() => send({ type: 'DividePlunder', shipId })}>
        Divide the plunder{share.chest > 0 ? ` · you take ${share.captain}, each man ${Math.round(share.perHead)}` : ''}
      </button>
      <button disabled={owed <= 0 || (state.captain?.gold ?? 0) < owed} onClick={() => send({ type: 'PayWages', shipId })}>
        Pay wages · {owed} gold
      </button>
    </div>
  );
}

/** The shipwright: hull and sails made good, as far as the purse reaches. */
const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands', pirate: 'the pirates' };

/**
 * The governor (PRD section 12): his nation's wars and peace, how hard pirates press its trade, a letter
 * of marque against its enemies, and bounties for the captain's deeds.
 */
function Governor({
  content,
  state,
  town,
  shipId,
  send,
}: {
  content: ContentPack;
  state: WorldState;
  town: PlacedSettlement;
  shipId: string;
  send: PortProps['send'];
}) {
  if (!hasGovernor(town)) {
    return <p class="tavern-quiet">There is no governor here: only towns and cities have one.</p>;
  }
  const nation = town.nation;
  const enemies = enemiesOf(content, state, nation).filter((n) => n !== 'pirate');
  const friends = NATIONS.filter((n) => n !== nation && !enemies.includes(n));
  const piracy = Math.round(state.politics?.piracy[nation] ?? 0);
  const held = (state.captain?.marques ?? []).includes(nation);
  const price = marquePrice(content, state, nation);
  const owed = bountiesOwed(content, state, nation);
  const standing = state.captain?.standing?.[nation] ?? 0;
  const list = (ns: readonly string[]) => ns.map((n) => COUNTRY[n]).join(', ');
  return (
    <div class="governor">
      <p>
        {enemies.length ? <span class="trend scarce">at war</span> : <span class="trend export">at peace</span>}{' '}
        {enemies.length ? `${COUNTRY[nation]} is at war with ${list(enemies)}.` : `${COUNTRY[nation]} is at peace with every nation.`}
        {friends.length && enemies.length ? ` At peace with ${list(friends)}.` : ''}
      </p>
      <p class="port-sub">
        {piracy >= content.politics.piracy.plague
          ? `Pirates are plaguing our trade (pressure ${piracy}). Every pirate you take is worth more here.`
          : piracy > 0
            ? `Pirates trouble our shipping (pressure ${piracy}).`
            : 'Our trade is quiet; few pirates trouble it.'}{' '}
        Your standing with {COUNTRY[nation]}: {standing}.
      </p>
      <div class="governor-row">
        {held ? (
          <span>
            You hold {/^[AEIOU]/.test(NATION[nation]) ? 'an' : 'a'} {NATION[nation]} letter of marque. It covers:{' '}
            {enemies.length ? list(enemies) : 'no one while we are at peace'}.
          </span>
        ) : !enemies.length ? (
          <span class="port-sub">We are at peace: there are no letters of marque to be had.</span>
        ) : price === undefined ? (
          <span class="port-sub">The governor will not grant a letter to an enemy of {COUNTRY[nation]}.</span>
        ) : (
          <button onClick={() => send({ type: 'BuyMarque', shipId })}>
            Letter of marque against {list(enemies)} · {price ? `${price} gold` : 'granted freely'}
          </button>
        )}
      </div>
      <div class="governor-row">
        {owed.pay.length ? (
          <button onClick={() => send({ type: 'CollectBounties', shipId })}>
            Collect bounties for {owed.pay.length} {owed.pay.length === 1 ? 'ship' : 'ships'} · {owed.total} gold
          </button>
        ) : (
          <span class="port-sub">
            No bounty owed here.{' '}
            {(state.captain?.deeds ?? []).length ? `${state.captain!.deeds!.length} of your deeds wait for a governor at war with those nations.` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function Shipwright({
  content,
  state,
  town,
  shipId,
  send,
}: {
  content: ContentPack;
  state: WorldState;
  town: PlacedSettlement;
  shipId: string;
  send: PortProps['send'];
}) {
  const ship = state.ships[shipId]!;
  const stats = shipStats(content, ship);
  const cost = repairCost(content, ship);
  const gold = state.captain?.gold ?? 0;
  const p = content.combat.port;
  const room = stats.maxGuns - stats.guns;
  const installed = new Set(ship.upgrades ?? []);
  return (
    <div class="shipwright">
      <div class="shipwright-row">
        <span>
          Hull {Math.round(ship.hull ?? stats.hullMax)} / {stats.hullMax} · Sails {Math.round(ship.sailCondition ?? 100)}%
        </span>
        {cost > 0 ? (
          <button onClick={() => send({ type: 'Repair', shipId })}>Repair · {cost} gold</button>
        ) : (
          <span class="port-sub">She is sound.</span>
        )}
      </div>
      <div class="shipwright-row">
        <span>
          Guns {stats.guns} / {stats.maxGuns}
        </span>
        {sellsGuns(town) ? (
          <>
            <button disabled={room <= 0 || gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: 1 })}>
              Buy 1 · {p.gunGold} gold
            </button>
            <button disabled={room <= 0 || gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: room })}>
              Fill the gun deck · {Math.min(room, Math.floor(gold / Math.max(1, p.gunGold))) * p.gunGold} gold
            </button>
            <button disabled={stats.guns <= 0} onClick={() => send({ type: 'SellGuns', shipId, count: 1 })}>
              Sell 1 · {p.gunSellGold} gold
            </button>
          </>
        ) : (
          <span class="port-sub">No cannon for sale in a hamlet.</span>
        )}
      </div>
      <table class="upgrades">
        <tbody>
          {Object.values(content.upgrades).map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td class="port-sub">{u.effect}</td>
              <td>
                {installed.has(u.id) ? (
                  <span class="trend export">installed</span>
                ) : sellsUpgrade(content, town, u.id) ? (
                  <button disabled={gold < u.price} onClick={() => send({ type: 'BuyUpgrade', shipId, upgradeId: u.id })}>
                    Buy · {u.price} gold
                  </button>
                ) : (
                  <span class="port-sub">not sold here</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ships lying in this port and when each sails: where she is bound is only settled when she leaves. */
function Harbour({ content, state, town }: { content: ContentPack; state: WorldState; town: string }) {
  const tpd = content.calendar.ticksPerDay;
  const moored = Object.values(state.ships)
    .filter((s) => inPort(s) && s.ai!.from === town)
    .sort((a, b) => a.ai!.waitUntil! - b.ai!.waitUntil!);
  return (
    <div class="harbour-ships">
      <span class="port-sub">In the harbour</span>
      {moored.length ? (
        moored.map((s) => {
          const days = Math.ceil((s.ai!.waitUntil! - state.tick) / tpd);
          return (
            <div key={s.id}>
              <i>{s.ai!.name}</i>, {shipTitle(s)}
              {legalTarget(content, state, state.captain, s.ai!.nation) ? <span class="trend want">lawful prize</span> : null}
              <span class="age"> {days <= 0 ? 'sails today' : days === 1 ? 'sails tomorrow' : `sails in about ${days} days`}</span>
            </div>
          );
        })
      ) : (
        <div class="age">No other ships lie here.</div>
      )}
    </div>
  );
}

/** The tavern: talk of the docks, newest first. Listening marks it heard. */
function Tavern({ content, state, settlements, town, rumours, hear, shipId, send }: TavernProps) {
  // What was new when the captain walked in stays marked for this visit.
  const [fresh] = useState(() => new Set(rumours.filter((n) => !(state.captain?.heard ?? []).includes(n.id)).map((n) => n.id)));
  // Once per visit: the port screen renders every frame, so this must not run from render.
  useEffect(hear, []);
  const today = Math.floor(state.tick / content.calendar.ticksPerDay);
  const recruit = (
    <>
      <Recruit content={content} state={state} shipId={shipId} send={send} />
      <CrewPay content={content} state={state} shipId={shipId} send={send} />
      <Harbour content={content} state={state} town={town} />
    </>
  );
  if (!rumours.length)
    return (
      <>
        {recruit}
        <p class="tavern-quiet">The tavern is quiet. Nobody has news worth the price of a drink.</p>
      </>
    );
  return (
    <>
      {recruit}
      <ul class="tavern">
        {rumours.map((n) => {
          const town = settlements.find((s) => s.id === n.settlementId)?.name ?? n.settlementId;
          const age = today - Math.floor(n.tick / content.calendar.ticksPerDay);
          return (
            <li key={n.id}>
              {fresh.has(n.id) ? <span class="trend want">new</span> : null} {newsText(content, n, town)}
              <span class="age"> {age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
