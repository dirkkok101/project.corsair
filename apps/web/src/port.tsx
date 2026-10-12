import { inPort } from '@corsair/core';
import type { Contract, WorldState } from '@corsair/core';
import { shipStats, upgradePrice } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import {
  strangerOffer,
  bountiesOwed,
  cargoUsed,
  crewOf,
  crewMood,
  hasGovernor,
  marquePrice,
  newsAt,
  newsText,
  portTrade,
  priceStory,
  quote,
  referenceStock,
  daysUnpaid,
  fleetBerths,
  fleetHold,
  fleetMinCrew,
  fleetOf,
  foodDays,
  moraleOf,
  moraleWord,
  plunderShares,
  repairCost,
  sellDepth,
  shipsForSale,
  shipStandingNeeded,
  shipRankNeeded,
  rankOf,
  hasPerk,
  perkPrice,
  tradeEdge,
  famesOf,
  landOf,
  rungBrings,
  contractsAt,
  famine,
  plagued,
  wagesOwed,
  sellsGuns,
  sellsUpgrade,
  townOf,
  tradeLean,
  tradePreview,
} from '@corsair/systems-economy';
import { enemiesOf, legalTarget } from '@corsair/systems-politics';
import { topTen } from '@corsair/systems-traffic';
import { RetireConfirm } from './career';
import { Bust, Key, Speech, Stat } from './ui/kit';
import { ChartInset } from './ui/chart-inset';
import { shipTitle } from './hail';
import { Art, GoodIcon, shipIcon, shipKind } from './ui-art';
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
  /** The buildings to click, and the docks (at the anchorage), in CSS pixels within the stage. */
  hotspots: Partial<Record<Service | 'docks', { left: number; top: number; width: number; height: number }>>;
  /** Told which service is open (undefined for the harbour view), so its interior can be shown. */
  onOpen: (service: Service | undefined) => void;
  /** Said once on arrival: men who deserted as she made port. */
  notice?: string;
  /** Today's date: the clock stands still in port. */
  date: string;
  /** The sea, for the tavern's chart of where news is from. */
  map: TileMap;
  /** Plot a course to a place (tile coordinates), sailed when she sets sail. */
  plot?: (x: number, y: number) => void;
  /** Opens the captain's log (L), in port too. */
  openLog?: () => void;
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
/** Services that work so far; the rest are drawn but marked "soon". */
const READY: Service[] = ['merchant', 'tavern', 'shipwright', 'governor'];
const ALL = 1_000_000; // "as many as possible": the sim stops at gold, hold or stock

/** A port's people and trend, in a few words ("12,600 people, growing"). */
function townLine(content: ContentPack, state: WorldState, town: PlacedSettlement) {
  const t = townOf(content, state, town);
  return `${(Math.round(t.people / 100) * 100).toLocaleString()} people${t.trend > 0 ? ', growing' : t.trend < 0 ? ', shrinking' : ''}${t.blockaded ? ', blockaded' : ''}${famine(content, state, town.id) ? ', famine' : ''}${plagued(state, town.id) ? ', plague' : ''}`;
}

/** A contract in a line: what the governor pays, for what, and how long it has. */
function contractLine(content: ContentPack, state: WorldState, c: Contract, townName: string) {
  const good = (content.goods.find((g) => g.id === c.good)?.name ?? c.good).toLowerCase();
  const days = Math.max(0, Math.ceil((c.endTick - state.tick) / content.calendar.ticksPerDay));
  return `The governor of ${townName} pays ${c.reward.toLocaleString()} gold for ${c.units} ${good} landed there${
    c.delivered ? ` (${c.delivered} landed so far)` : ''
  }, on top of the sale: ${days} ${days === 1 ? 'day' : 'days'} left.`;
}

/**
 * The merchant (PRD section 6; storyboard 2.2). His bust says the one thing worth knowing here; the ledger gives
 * each good one row: a verdict word and one price, a hint (what you paid, or where it sells best), and one or two
 * buttons. Clicking a good opens why it costs what it does; pointing at a button says what the trade comes to.
 * Two one-click actions do the usual thing: sell what sells at a profit, fill the hold with the best buy.
 */
function Merchant({
  content,
  state,
  town,
  ship,
  bestSale,
  trade,
}: {
  content: ContentPack;
  state: WorldState;
  town: PlacedSettlement;
  ship: import('@corsair/core').Ship;
  bestSale: (good: string) => { name: string; sell: number; age: number; depth?: number } | undefined;
  trade: (type: 'Buy' | 'Sell', good: string, quantity: number) => void;
}) {
  const [preview, setPreview] = useState<string>();
  const [open, setOpen] = useState<string>();
  const market = state.markets?.[town.id] ?? {};
  // A colonel of this nation trades here on better terms.
  const edge = tradeEdge(content, state.captain, town.nation);
  const purse = townOf(content, state, town).cash;
  const gold = state.captain?.gold ?? 0;
  const capacity = fleetHold(content, state, ship);
  const used = cargoUsed(ship);
  const room = capacity - used;
  const deals = (state.contracts ?? []).filter((c) => c.settlementId === town.id && c.endTick > state.tick);
  const rows = content.goods.map((g) => {
    const stock = market[g.id] ?? 0;
    const q = quote(content, town, g.id, stock, edge);
    const held = ship.cargo[g.id] ?? 0;
    const side = tradeLean(content, town, g.id);
    const tag = side === 'exports' ? 'made here' : side === 'wants' ? 'needed here' : '';
    const story = priceStory(content, state, town, g.id);
    const name = g.name.toLowerCase();
    const cost = held > 0 && ship.paid?.[g.id] !== undefined ? ship.paid[g.id]! / held : undefined;
    const plunder = ship.plunder?.[g.id] ?? 0;
    const best = bestSale(g.id);
    const depth = sellDepth(content, town, g.id, stock);
    // The verdict: one word for what this price means to you.
    const verdict =
      g.id === 'food'
        ? { word: `${Math.floor(foodDays(content, ship))} days aboard`, tone: '' }
        : stock < 1
          ? { word: 'none for sale', tone: 'bad' }
          : held && (story.level === 'dear' || (cost !== undefined && q.sell > cost) || plunder)
            ? { word: 'sells well here', tone: 'good' }
            : story.level === 'cheap'
              ? { word: 'cheap here', tone: 'good' }
              : story.level === 'dear'
                ? { word: 'dear here', tone: 'bad' }
                : { word: 'fair', tone: '' };
    // The hint: what you paid and what selling makes, else where it sells best.
    const hint = held
      ? g.id === 'food'
        ? `${held} aboard`
        : plunder
          ? `${held} in your hold, ${plunder} of it plunder: its gold goes to the crew's chest`
          : cost !== undefined
            ? `${held} in your hold, you paid ${Math.round(cost)} each: ${q.sell >= cost ? `+${Math.round(q.sell - cost)}` : `−${Math.round(cost - q.sell)}`} a unit now`
            : `${held} in your hold`
      : best && best.sell > q.buy
        ? `Sells best at ${best.name}, ${best.sell} (seen ${best.age === 0 ? 'today' : `${best.age} ${best.age === 1 ? 'day' : 'days'} ago`})`
        : '';
    const why = [
      `Stock here ${story.stock}; usually about ${story.usualStock}.`,
      story.level === 'dear'
        ? `Short of ${name}, so it is dear: usually ${story.usual.buy} · ${story.usual.sell}.`
        : story.level === 'cheap'
          ? `Plenty of ${name}, so it is cheap: usually ${story.usual.buy} · ${story.usual.sell}.`
          : `About its usual price here.`,
      ...(story.news ? [story.news] : []),
      side === 'exports' ? `${town.name} makes ${name}: it is cheap to buy here.` : side === 'wants' ? `${town.name} needs ${name}: it sells well here.` : '',
      story.makes > 0 ? `It makes about ${Math.round(story.makes)} a day.` : '',
      story.eats > 0 ? `It eats about ${Math.round(story.eats)} a day: ${story.days! >= 1 ? `${Math.floor(story.days!)} days in store` : 'none in store'}.` : '',
      `He takes about ${depth >= 999 ? 'any amount' : depth} before its price falls by a quarter; each unit you buy raises it, each you sell lowers it.`,
      edge ? `Your rank here: you buy ${Math.round(edge * 100)}% cheaper and sell ${Math.round(edge * 100)}% dearer.` : '',
    ].filter(Boolean);
    const say = (s: 'Buy' | 'Sell', qty: number) => {
      const t = tradePreview(content, town, g.id, stock, s, qty, { gold, room, held, cash: purse }, edge);
      if (!t.units) {
        if (s === 'Buy') return room < 1 ? 'Your hold is full.' : stock < 1 ? `The merchant has no ${name} left.` : `Not enough gold for one ${name}.`;
        return held < 1 ? `You have no ${name} to sell.` : `The merchant is out of gold (${purse} left): his purse fills again day by day, or sell elsewhere.`;
      }
      if (s === 'Buy') {
        return `Buy ${t.units} ${name} for ${t.total.toLocaleString()} gold (${Math.round(t.total / t.units)} each); the price here rises to ${t.after}.${
          best && best.sell > t.total / t.units ? ` At ${best.name} they'd fetch about ${best.sell} each.` : ''
        }`;
      }
      // Plunder cost nothing, so only a hold of bought goods has a gain or loss to speak of.
      const fromPlunder = Math.min(plunder, t.units);
      const gain = cost !== undefined && !plunder ? Math.round(t.total - cost * t.units) : undefined;
      return `Sell ${t.units} ${name} for ${t.total.toLocaleString()} gold; the price here falls to ${t.after}.${t.units < Math.min(qty, held) ? ` His purse covers only ${t.units}.` : ''}${
        gain !== undefined ? ` ${gain >= 0 ? `${gain} more than` : `${-gain} less than`} you paid.` : ''
      }${
        gain !== undefined && gain < 0
          ? ` A merchant pays less than he charges, so goods bought here sell at a loss here: sell where they are needed${best && best.sell > (cost ?? 0) ? `, like ${best.name} (${best.sell})` : ''}.`
          : ''
      }${fromPlunder ? ` ${fromPlunder} are plunder: their gold goes to the crew's chest.` : ''}`;
    };
    const margin = best ? best.sell - q.buy : 0;
    return { g, stock, q, held, tag, story, cost, plunder, best, depth, verdict, hint, why, say, margin, canBuy: stock >= 1 && gold >= q.buy && room > 0, canSell: held >= 1 && purse >= q.sell };
  });
  const hover = (say: (s: 'Buy' | 'Sell', qty: number) => string, s: 'Buy' | 'Sell', qty: number) => ({ onMouseEnter: () => setPreview(say(s, qty)), onMouseLeave: () => setPreview(undefined) });
  // What sells here at a profit (or is plunder), and the best buy for a port you know.
  const profitable = rows.filter((r) => r.g.id !== 'food' && r.canSell && (r.plunder || (r.cost !== undefined && r.q.sell > r.cost) || r.verdict.word === 'sells well here'));
  const bestBuy = rows.filter((r) => r.g.id !== 'food' && r.canBuy && r.margin > 0).sort((a, b) => b.margin - a.margin)[0];
  // His one line: the dearest thing he'd buy from you, and what he has too much of.
  const dear = rows.filter((r) => r.g.id !== 'food' && r.story.level === 'dear').sort((a, b) => b.q.sell - a.q.sell)[0];
  const glut = rows.filter((r) => r.g.id !== 'food' && r.story.level === 'cheap').sort((a, b) => a.q.buy - b.q.buy)[0];
  const line =
    dear && glut
      ? `"${dear.g.name}'s dear here, captain, and I've more ${glut.g.name.toLowerCase()} than I can sell."`
      : dear
        ? `"${dear.g.name}'s dear here, captain: bring me ${dear.g.name.toLowerCase()} and I'll pay for it."`
        : glut
          ? `"I've more ${glut.g.name.toLowerCase()} than I can sell, captain: it's yours cheap."`
          : `"Prices are fair today, captain. What'll it be?"`;
  const opened = rows.find((r) => r.g.id === open);
  return (
    <div class="merchant">
      <div class="k-wood merchant-side">
        <Speech bust="bust.merchant" who="The merchant" line={line} />
        <div class="merchant-figures">
          <div class="merchant-figure">
            <span>Your hold</span>
            <b>
              {used} / {capacity}
            </b>
          </div>
          <div class="k-bar">
            <span style={{ width: `${Math.round((used / Math.max(1, capacity)) * 100)}%` }} />
          </div>
          <div class="merchant-figure merchant-purse" title="He pays for your goods only as far as his purse goes; it fills again as the town trades">
            <span>His purse</span>
            <b>{purse.toLocaleString()} gold</b>
          </div>
          <div class="merchant-figure">
            <span>Your gold</span>
            <b>{gold.toLocaleString()} gold</b>
          </div>
        </div>
        <div class="merchant-actions">
          {profitable.length ? (
            <button
              class="k-btn primary"
              onMouseEnter={() => setPreview(profitable.map((r) => r.say('Sell', ALL)).join(' '))}
              onMouseLeave={() => setPreview(undefined)}
              onClick={() => profitable.forEach((r) => trade('Sell', r.g.id, ALL))}
            >
              Sell what sells well: {profitable.map((r) => r.g.name.toLowerCase()).join(', ')}
            </button>
          ) : null}
          {bestBuy ? (
            <button class="k-btn" {...hover(bestBuy.say, 'Buy', ALL)} onClick={() => trade('Buy', bestBuy.g.id, ALL)}>
              Fill the hold with {bestBuy.g.name.toLowerCase()} for {bestBuy.best!.name}
            </button>
          ) : null}
        </div>
        <div class="merchant-preview">{preview ?? 'Point at a button to see what the trade comes to; click a good to see why it costs what it does.'}</div>
      </div>
      <div class="k-paper merchant-ledger">
        <div class="ledger-head">
          <span class="k-who ink">{town.name} market</span>
          <span class="k-sub ink">Click a good to see why it costs what it does</span>
        </div>
        {deals.map((c) => (
          <p class="contract" key={c.id}>
            <b>Contract:</b> {contractLine(content, state, c, town.name ?? town.id)} Sell it here to fill it.
          </p>
        ))}
        <table class="market">
          <tbody>
            {rows.map((r) => (
              <tr key={r.g.id} class={`${r.held ? 'held' : ''}${open === r.g.id ? ' open' : ''}`} onClick={() => setOpen(open === r.g.id ? undefined : r.g.id)}>
                <td class="ledger-icon">
                  <GoodIcon id={r.g.id} />
                </td>
                <td class="ledger-good">
                  <div>
                    <b>{r.g.name}</b> <span class={`verdict ${r.verdict.tone}`}>{r.verdict.word}</span>
                    {r.tag ? <span class={`trend ${r.tag === 'made here' ? 'export' : 'want'}`}>{r.tag}</span> : null}
                  </div>
                  {r.hint ? <div class={`ledger-hint${r.held ? '' : ' best'}`}>{r.hint}</div> : null}
                </td>
                <td class="num ledger-price" title="He charges · he pays">
                  {r.held ? `${r.q.buy} · ${r.q.sell}` : r.stock < 1 ? '—' : r.q.buy}
                </td>
                <td class="actions" onClick={(e) => e.stopPropagation()}>
                  {r.held && r.g.id !== 'food' ? (
                    <button class="k-btn small paper" {...hover(r.say, 'Sell', ALL)} onClick={() => trade('Sell', r.g.id, ALL)} disabled={!r.canSell}>
                      Sell all
                    </button>
                  ) : null}
                  <button class="k-btn small paper" {...hover(r.say, 'Buy', 10)} onClick={() => trade('Buy', r.g.id, 10)} disabled={!r.canBuy}>
                    Buy 10
                  </button>
                  {r.g.id !== 'food' ? (
                    <button class="k-btn small paper" {...hover(r.say, 'Buy', ALL)} onClick={() => trade('Buy', r.g.id, ALL)} disabled={!r.canBuy}>
                      Buy max
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {opened ? (
          <div class="ledger-why">
            <b>
              {opened.g.name}: why {opened.q.buy}?
            </b>{' '}
            {opened.why.join(' ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Standing with a nation as a word (the number on hover). */
/** Tavern signs, one hung in each town's tavern. */
const TAVERN_SIGNS = [
  'The Sign of the Mermaid',
  'The Rusty Anchor',
  'The Jolly Tar',
  'The Blue Parrot',
  'The Drowned Sailor',
  'The Three Crowns',
  'The Bosun\'s Whistle',
  'The Salt Herring',
];

/** The sign over a town's tavern: always the same one in the same town. */
function tavernSign(townId: string): string {
  let h = 0;
  for (const c of townId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAVERN_SIGNS[h % TAVERN_SIGNS.length]!;
}

function standingWord(n: number): string {
  return n >= 50 ? 'honoured' : n >= 20 ? 'friendly' : n > -20 ? 'neutral' : n > -50 ? 'unwelcome' : 'hunted';
}

/**
 * The one line said on arrival (storyboard 2.1): a notice first (men deserted, a promotion), then the best price
 * here for something in the hold, then news the captain hasn't heard, then what the town makes cheap.
 */
function arrivalNews(content: ContentPack, state: WorldState, town: PlacedSettlement, settlements: PlacedSettlement[], ship: import('@corsair/core').Ship, notice?: string): string | undefined {
  if (notice) return notice;
  const market = state.markets?.[town.id] ?? {};
  const name = (id: string) => content.goods.find((g) => g.id === id)?.name.toLowerCase() ?? id;
  const held = Object.entries(ship.cargo).filter(([g, n]) => n > 0 && g !== 'food');
  const dear = held
    .map(([g]) => ({ g, story: priceStory(content, state, town, g), q: quote(content, town, g, market[g] ?? 0) }))
    .filter((x) => x.story.level === 'dear')
    .sort((a, b) => b.q.sell - a.q.sell)[0];
  if (dear) return `Your ${name(dear.g)} sells well here: ${dear.q.sell} each.`;
  const fresh = newsAt(content, state, settlements, town.id).find((n) => !(state.captain?.heard ?? []).includes(n.id));
  if (fresh) return `News in the tavern: ${newsText(content, fresh, settlements.find((x) => x.id === fresh.settlementId)?.name ?? town.name)}`;
  const made = portTrade(content, town).exports[0];
  return made ? `${town.name} makes ${name(made)}: it is cheap here at ${quote(content, town, made, market[made] ?? 0).buy}.` : undefined;
}

/** The port screen: the harbour scene with its buildings to click, and the merchant's market over it. */
export function Port({ state, content, town, settlements, shipId, send, hotspots, onOpen, notice, date, map, plot, openLog }: PortProps) {
  // The harbour first (the painting is the menu, storyboard 2.1); a building opens its service, Esc comes back.
  const [open, setOpen] = useState<Service | undefined>(undefined);
  // Retiring asks first, with the score as it stands.
  const [retiring, setRetiring] = useState(false);
  // The docks: the ships in harbour, and retiring.
  const [docks, setDocks] = useState(false);
  useEffect(() => onOpen(open), [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(undefined);
      setDocks(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const ship = state.ships[shipId]!;
  const market = state.markets?.[town.id] ?? {};
  const gold = state.captain?.gold ?? 0;
  const capacity = fleetHold(content, state, ship);
  const used = cargoUsed(ship);
  const trade = (type: 'Buy' | 'Sell', good: string, quantity: number) => send({ type, shipId, good, quantity });
  const known = state.captain?.knownPrices ?? {};
  const today = Math.floor(state.tick / content.calendar.ticksPerDay);
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
  // What waits at each building, as a badge: news unheard, bounties owed, mending to do.
  const owed = hasGovernor(town) ? bountiesOwed(content, state, town.nation).pay.length : 0;
  const mending = repairCost(content, ship, fleetOf(state)) > 0 ? 1 : 0;
  const badge: Partial<Record<Service, number>> = { tavern: unheard, governor: owed, shipwright: mending };
  const label = (s: { id: Service; name: string }) => (badge[s.id] ? `${s.name} (${badge[s.id]})` : s.name);

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
        title={s.name}
        onClick={() => ready && setOpen(s.id)}
      >
        <span>
          {s.name}
          {badge[s.id] ? <b class="spot-badge">{badge[s.id]}</b> : null}
        </span>
      </button>
    );
  });

  if (retiring)
    return (
      <div class="port">
        <RetireConfirm content={content} state={state} retire={() => send({ type: 'Retire', shipId })} cancel={() => setRetiring(false)} />
      </div>
    );

  if (!open) {
    const standing = state.captain?.standing?.[town.nation] ?? 0;
    const crew = crewOf(content, ship);
    const berths = fleetBerths(content, state, ship);
    const food = Math.floor(foodDays(content, ship));
    const morale = moraleOf(content, state);
    const news = arrivalNews(content, state, town, settlements, ship, notice);
    const dockSpot = hotspots.docks;
    return (
      <div class="port port-scene">
        {spots}
        {dockSpot ? (
          <button class="port-spot port-docks" style={{ left: `${dockSpot.left}px`, top: `${dockSpot.top}px`, width: `${dockSpot.width}px`, height: `${dockSpot.height}px` }} onClick={() => setDocks(true)}>
            <span>Docks</span>
          </button>
        ) : null}
        <div class="harbour-head">
          <h1 class="harbour-name port-name">{town.name}</h1>
          <div class="harbour-tags">
            <span class="k-tag">{town.type === 'haven' ? 'Pirate haven' : `${NATION[town.nation]} ${town.type === 'capital' ? 'capital' : town.size}`}</span>
            <span class="k-tag">{townOf(content, state, town).people.toLocaleString()} people</span>
            {town.nation !== 'pirate' ? (
              <span class="k-tag gold" title={`Standing with the ${NATION[town.nation]}: ${standing}`}>
                Standing: {standingWord(standing)}
              </span>
            ) : null}
          </div>
        </div>
        {news ? <div class="hud-toast harbour-news">{news}</div> : null}
        {docks ? (
          <div class="k-wood harbour-docks">
            <div class="k-who">The docks</div>
            <Harbour content={content} state={state} town={town.id} />
            <div class="harbour-docks-actions">
              <button class="k-btn small" onClick={() => setRetiring(true)} title="End the career here and see its score">
                Retire…
              </button>
              <button class="k-btn small" onClick={() => setDocks(false)}>
                Close · Esc
              </button>
            </div>
          </div>
        ) : null}
        <div class="harbour-foot">
          <div class="hud-strip">
            <Stat icon="ui.icon.gold" value={gold.toLocaleString()} title="Gold in your purse" />
            <Stat icon="ui.icon.crew" value={`${crew} men`} title={`Crew ${crew} of ${berths} berths`} low={crew < berths / 3} />
            <Stat icon="ui.icon.food" value={`${food} ${food === 1 ? 'day' : 'days'}`} title="Food aboard, in days for this crew" low={food <= 3} />
            <Stat icon="ui.icon.morale" value={moraleWord(content, morale)} title="The crew's morale" low={morale < 40} />
          </div>
          <span class="harbour-date">{date}</span>
          {openLog ? (
            <button class="k-btn" onClick={openLog}>
              Log <Key k="L" />
            </button>
          ) : null}
          <button class="k-btn primary" onClick={() => send({ type: 'Undock', shipId })}>
            Set sail <Key k="E" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="port">
      <div class="port-panel">
        {/* Over the painting, as in the storyboard: the tavern's sign, and the way out. The town is the harbour's. */}
        <div class="interior-top">
          {open === 'tavern' ? <h1 class="interior-title">{tavernSign(town.id)}</h1> : <span />}
          <button class="k-btn small" onClick={() => setOpen(undefined)} title="Back to the harbour">
            Leave <Key k="Esc" />
          </button>
        </div>
        {notice ? <div class="hud-toast interior-notice">{notice}</div> : null}

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
            map={map}
            plot={plot}
          />
        ) : (
          <Merchant content={content} state={state} town={town} ship={ship} bestSale={bestSale} trade={trade} />
        )}

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
  map: TileMap;
  plot?: (x: number, y: number) => void;
}

/** Hands for the ship: men sign on at the tavern for a bounty each, up to her berths. */
function Recruit({ content, state, shipId, send, nation }: Pick<TavernProps, 'content' | 'state' | 'shipId' | 'send'> & { nation: PlacedSettlement['nation'] }) {
  const ship = state.ships[shipId]!;
  const cls = content.ships[ship.classId]!;
  const crew = crewOf(content, ship);
  // A captain of this nation finds men easier: they sign on for less.
  const cut = perkPrice(content, state.captain, nation, 'recruit');
  const price = content.combat.port.recruitGold * cut;
  const berths = fleetBerths(content, state, ship);
  const room = berths - crew;
  return (
    <div class="recruit">
      <span>
        Crew {crew} / {berths}
        {crew < cls.minCrew ? <span class="trend scarce">short-handed</span> : null}
      </span>
      <button class="k-btn small" disabled={room <= 0} onClick={() => send({ type: 'Recruit', shipId, count: 10 })}>
        Sign on 10 · {Math.round(10 * price)} gold
      </button>
      <button class="k-btn small primary" disabled={room <= 0} onClick={() => send({ type: 'Recruit', shipId, count: room })}>
        Fill the berths · {Math.round(room * price)} gold
      </button>
      {cut < 1 ? <span class="port-sub">Your rank here: men sign on for {Math.round((1 - cut) * 100)}% less.</span> : null}
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
  // Morale heads day by day toward the crew's mood: say which way it is going.
  const drift = crewMood(content, state, ship) - morale;
  return (
    <div class="recruit crew-pay">
      <span>
        <Art id="ui.icon.morale" class="inline-icon" /> {moraleWord(content, morale)}
        {Math.abs(drift) > 2 ? `, ${drift > 0 ? 'rising' : 'falling'}` : ''} ·{' '}
        <Art id="ui.icon.chest" class="inline-icon" /> chest {Math.round(share.chest)} · unpaid {days} days
      </span>
      <button class="k-btn small" disabled={share.chest <= 0} onClick={() => send({ type: 'DividePlunder', shipId })}>
        Divide the plunder{share.chest > 0 ? ` · you take ${share.captain}, each man ${Math.round(share.perHead)}` : ''}
      </button>
      <button class="k-btn small" disabled={owed <= 0 || (state.captain?.gold ?? 0) < owed} onClick={() => send({ type: 'PayWages', shipId })}>
        Pay wages · {owed} gold
      </button>
    </div>
  );
}

/**
 * The yard's new ships (PRD section 7), each with what she carries, mounts, needs and makes, and her price; buying
 * one adds her to the fleet. A ship the captain can't take yet says why. The great ships are never for sale.
 */
function ShipsForSale({ content, state, town, shipId, send }: { content: ContentPack; state: WorldState; town: PlacedSettlement; shipId: string; send: PortProps['send'] }) {
  const forSale = shipsForSale(content, town);
  if (!forSale.length) return <div class="k-sub ships-for-sale-none">No shipyard in a hamlet: new ships are built in towns and cities.</div>;
  const ship = state.ships[shipId]!;
  const fleet = fleetOf(state);
  const crew = crewOf(content, ship);
  const gold = state.captain?.gold ?? 0;
  const max = content.combat.fleet.maxShips;
  const mine = content.ships[ship.classId]!;
  return (
    <>
      <div class="k-sub ships-for-sale-head">
        Each joins your fleet at once: make her your flagship to fight in her. The great ships are built in Europe, and the half-galleys are Spain's: take one.
      </div>
      <div class="ship-cards ships-for-sale">
        {forSale.map((id) => {
          const cls = content.ships[id]!;
          const need = fleetMinCrew(content, [...fleet, { classId: id }], ship);
          const standing = shipStandingNeeded(content, town, id);
          const yours = state.captain?.standing?.[town.nation] ?? 0;
          const rankNeed = shipRankNeeded(content, id);
          const rankShort = rankOf(content, state.captain, town.nation) < rankNeed;
          const rankName = content.politics.ranks.ladder[rankNeed]?.name;
          const why = rankShort
            ? `The yard builds her only for a ${rankName} of ${COUNTRY[town.nation] ?? town.nation}: collect bounties at its governors to rise.`
            : yours < standing
              ? `The yard builds her only for a captain in good standing here: ${standing} needed, yours is ${Math.round(yours)}.`
              : fleet.length + 2 > max
                ? `Your fleet is full (${max} ships): sell one first.`
                : crew < need
                  ? `Too few men to sail her too: the fleet would need ${need}, you have ${crew}. Sign on more at the tavern.`
                  : gold < cls.price
                    ? `Not enough gold: she costs ${cls.price.toLocaleString()}.`
                    : undefined;
          const guns = Math.floor(cls.guns * content.combat.shipyard.gunsShare);
          return (
            <div key={id} class={`ship-card k-paper${why ? ' locked' : ''}`}>
              <Art id={shipIcon(content, id)} class="ship-card-art" />
              <div class="ship-card-name">{shipKind(id)}</div>
              <div class="ship-card-stats">
                <Stat icon="ui.icon.full_sail" value={String(cls.speed)} title={`Speed ${cls.speed}`} />
                <Stat icon="ui.icon.cannon_loaded" value={String(cls.guns)} title={`Mounts ${cls.guns} guns; comes with ${guns}`} />
                <Stat icon="ui.icon.anchor" value={String(cls.cargo)} title={`Holds ${cls.cargo} tons`} />
                <Stat icon="ui.icon.crew" value={String(cls.maxCrew)} title={`Sails with ${cls.minCrew} men, berths ${cls.maxCrew}`} />
              </div>
              <div class="ship-card-compare">{id === ship.classId ? 'Like yours' : `Against your ${shipKind(ship.classId)}: ${compared(cls, mine)}`}</div>
              {cls.swivels || cls.oars ? (
                <div class="ship-card-extras">
                  {cls.swivels ? <span class="k-tag">{cls.swivels} swivels</span> : null}
                  {cls.oars ? <span class="k-tag">rows in a calm</span> : null}
                </div>
              ) : null}
              {why ? <div class="ship-card-why">{why}</div> : null}
              <button class="k-btn small primary" disabled={Boolean(why)} title={why} onClick={() => send({ type: 'BuyShip', shipId, classId: id })}>
                Buy · {cls.price.toLocaleString()} gold
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** How a class compares with yours, in a few words: "faster, 4 fewer guns, twice the hold". */
function compared(a: ContentPack['ships'][string], b: ContentPack['ships'][string]): string {
  const parts: string[] = [];
  if (a.speed !== b.speed) parts.push(a.speed > b.speed ? 'faster' : 'slower');
  const guns = a.guns - b.guns;
  if (guns) parts.push(`${Math.abs(guns)} ${guns > 0 ? 'more' : 'fewer'} guns`);
  const hold = a.cargo / b.cargo;
  if (hold >= 1.8) parts.push(`${hold >= 2.8 ? 'three times' : 'twice'} the hold`);
  else if (hold >= 1.2) parts.push('a bigger hold');
  else if (hold <= 0.8) parts.push('a smaller hold');
  const hull = a.hull / b.hull;
  if (hull >= 1.2) parts.push('stouter');
  else if (hull <= 0.8) parts.push('lighter-built');
  return parts.join(', ') || 'much like her';
}

/** Ships of the player's retaken from pirates and laid up here: take her back into the fleet, salvage paid. */
export function LaidUp({ content, state, shipId, send }: { content: ContentPack; state: WorldState; shipId: string; send: PortProps['send'] }) {
  const ship = state.ships[shipId]!;
  const here = (state.captain?.laidUp ?? []).filter((l) => l.settlementId === ship.docked);
  if (!here.length) return null;
  const fleet = fleetOf(state);
  const crew = crewOf(content, ship);
  const gold = state.captain?.gold ?? 0;
  return (
    <table class="fleet-list laid-up">
      <tbody>
        {here.map((l) => {
          const kind = shipKind(l.classId);
          const why =
            fleet.length + 2 > content.combat.fleet.maxShips
              ? `Your fleet is full (${content.combat.fleet.maxShips} ships): sell one first.`
              : crew < fleetMinCrew(content, [...fleet, l], ship)
                ? `Too few men to sail her too: the fleet would need ${fleetMinCrew(content, [...fleet, l], ship)}, you have ${crew}.`
                : gold < l.fee
                  ? `Not enough gold for the salvage (${l.fee}).`
                  : undefined;
          return (
            <tr key={l.id}>
              <td>
                <Art id={shipIcon(content, l.classId)} class="fleet-ship" /> Your {kind} {l.name} lies here, retaken from pirates
              </td>
              <td class="port-sub">
                hull {Math.round(l.hull)} · sails {Math.round(l.sailCondition)}%
              </td>
              <td class="actions">
                <button class="k-btn small" disabled={Boolean(why)} title={why} onClick={() => send({ type: 'ReclaimShip', shipId, laidUpId: l.id })}>
                  Take her back{l.fee ? ` · ${l.fee.toLocaleString()} gold salvage` : ''}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The shipwright: hull and sails made good, as far as the purse reaches. */
const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands', pirate: 'the pirates' };

/** How each governor speaks of the power he serves. */
const CROWN: Record<string, string> = { spain: 'His Catholic Majesty', england: 'His Majesty', france: 'His Most Christian Majesty', netherlands: 'The States General' };

/** The deeds a governor pays for, as he'd say them: "two Spanish ships and a pirate". */
function deedsSaid(pay: { nation: string; captive?: string }[]) {
  const counts = new Map<string, number>();
  for (const d of pay) if (!d.captive) counts.set(d.nation, (counts.get(d.nation) ?? 0) + 1);
  return [...counts].map(([n, k]) => `${k === 1 ? 'a' : k} ${n === 'pirate' ? 'pirate' : NATION[n as PlacedSettlement['nation']]} ${k === 1 ? 'ship' : 'ships'}`).join(' and ');
}

/**
 * The governor (storyboard 2.8, PRD section 12): his bust says what has happened since your last call (the bounties
 * you've earned, a war or a peace); then the bounties to collect, your rank as a ribbon toward the next, and one
 * offer at a time with what taking it means.
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
  // His last call here, read before this one is recorded, so the summary covers the time between.
  const [last] = useState(() => state.captain?.calledOn?.[town.id]);
  useEffect(() => send({ type: 'CallOnGovernor', shipId }), []);
  const [declined, decline] = useState(false);
  if (!hasGovernor(town)) {
    return <p class="port-sub">There is no governor here: only towns and cities have one.</p>;
  }
  const nation = town.nation;
  const enemies = enemiesOf(content, state, nation).filter((n) => n !== 'pirate');
  const piracy = Math.round(state.politics?.piracy[nation] ?? 0);
  const held = (state.captain?.marques ?? []).includes(nation);
  const price = marquePrice(content, state, nation);
  const owed = bountiesOwed(content, state, nation);
  const standing = state.captain?.standing?.[nation] ?? 0;
  const list = (ns: readonly string[]) => ns.map((n) => COUNTRY[n]).join(' and ');
  // Wars and peace made by his nation since the last call.
  const since = (state.news ?? []).filter((n) => (n.kind === 'war' || n.kind === 'peace') && (n.nation === nation || n.other === nation) && n.tick > (last ?? state.tick));
  const captives = owed.pay.flatMap((d) => (d.captive ? [content.pirates.captains.find((c) => c.id === d.captive)?.name ?? d.captive] : []));
  const ships = deedsSaid(owed.pay);
  const days = last === undefined ? 0 : Math.floor((state.tick - last) / content.calendar.ticksPerDay);
  const line = owed.pay.length
    ? `"${captives.length ? `${captives.join(' and ')} in irons! ` : ''}${ships ? `You've seen to ${ships} for us. ` : ''}${CROWN[nation]} is pleased."`
    : since.length
      ? `"Since you were last here: ${newsText(content, since[since.length - 1]!, town.name)}"`
      : last === undefined
        ? `"So you're the captain they talk of. ${COUNTRY[nation]} has need of men like you."`
        : days < 1
          ? `"Back so soon, captain?"`
          : `"Nothing has changed since you were last here, ${days} ${days === 1 ? 'day' : 'days'} ago."`;
  const offer = !held && enemies.length && price !== undefined && !declined;
  return (
    <div class="governor k-wood">
      <Speech bust={`bust.governor.${nation}`} who={`The governor of ${town.name}`} line={line}>
        <div class="tavern-tags">
          {enemies.length ? <span class="k-tag war">at war with {list(enemies)}</span> : <span class="k-tag peace">at peace</span>}
          <span class="k-tag" title={`Standing ${standing}, from -100 to 100`}>
            {COUNTRY[nation]}: {standingWord(standing)} ({standing})
          </span>
        </div>
        <div class="k-sub">
          {piracy >= content.politics.piracy.plague
            ? `Pirates are plaguing our trade: every pirate you take is worth more here.`
            : piracy > 0
              ? 'Pirates trouble our shipping.'
              : 'Our trade is quiet; few pirates trouble it.'}
        </div>
      </Speech>
      <div class="governor-row governor-bounty">
        {owed.pay.length ? (
          <>
            <span>Bounties owed</span>
            <b>{owed.total.toLocaleString()} gold</b>
            <button class="k-btn small primary" onClick={() => send({ type: 'CollectBounties', shipId })}>
              {bountyLabel(content, owed.pay)}
            </button>
          </>
        ) : (
          <span class="k-sub">
            No bounty owed here.{' '}
            {(state.captain?.deeds ?? []).length ? `${state.captain!.deeds!.length} of your deeds wait for a governor at war with those nations.` : ''}
          </span>
        )}
      </div>
      <Rank content={content} state={state} nation={nation} />
      {held ? (
        <div class="governor-row k-sub">
          You hold {/^[AEIOU]/.test(NATION[nation]) ? 'an' : 'a'} {NATION[nation]} letter of marque. It covers:{' '}
          {enemies.length ? list(enemies) : 'no one while we are at peace'}.
        </div>
      ) : !enemies.length ? (
        <div class="governor-row k-sub">We are at peace: there are no letters of marque to be had.</div>
      ) : price === undefined ? (
        <div class="governor-row k-sub">The governor will not grant a letter to an enemy of {COUNTRY[nation]}.</div>
      ) : offer ? (
        <div class="k-paper governor-offer">
          <div class="k-say">
            "{list(enemies)} {enemies.length === 1 ? 'is' : 'are'} our enemy. A letter of marque, {price ? `${price.toLocaleString()} gold` : 'freely given'}?"
          </div>
          <div class="governor-offer-means">
            Their ships become lawful prizes: each one you take raises your standing with {COUNTRY[nation]} and earns a bounty here.{' '}
            {list(enemies)} will think the worse of you for it.
          </div>
          <div class="tavern-replies">
            <button class="k-btn small primary" onClick={() => send({ type: 'BuyMarque', shipId })}>
              Take the letter · {price ? `${price.toLocaleString()} gold` : 'free'}
            </button>
            <button class="k-btn small paper" onClick={() => decline(true)}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <div class="governor-row k-sub">
          <button class="k-btn small" onClick={() => decline(false)}>
            Ask about a letter of marque
          </button>
        </div>
      )}
    </div>
  );
}

/** His rank with the governor's nation, as a ribbon toward the next rung: what that asks and brings, and his land. */
function Rank({ content, state, nation }: { content: ContentPack; state: WorldState; nation: PlacedSettlement['nation'] }) {
  const ladder = content.politics.ranks.ladder;
  const r = rankOf(content, state.captain, nation);
  const merit = state.captain?.merit?.[nation] ?? 0;
  const next = ladder[r + 1];
  const acres = landOf(content, state.captain, nation);
  if (r < 0)
    return (
      <div class="governor-row governor-rank k-sub">
        A letter of marque is your first rank with {COUNTRY[nation]}; then every bounty collected here raises you ({ladder
          .slice(1, 4)
          .map((l) => l.name)
          .join(', ')}
        , and on to a title and land).
      </div>
    );
  const from = ladder[r]!.merit;
  const share = next ? Math.max(0, Math.min(1, (merit - from) / (next.merit - from))) : 1;
  return (
    <div class="governor-row governor-rank">
      <div class="rank-ribbon">
        <b>{ladder[r]!.name}</b>
        <div class="k-bar">
          <span style={{ width: `${share * 100}%` }} />
        </div>
        <span>{next ? next.name : 'the top'}</span>
      </div>
      <span class="k-sub">
        {next
          ? `${next.merit - merit} more merit (a point a bounty, more for a famous pirate) to ${next.name}: ${rungBrings(content, r + 1).join(', ') || 'a higher rank'}.`
          : `Merit ${merit}: the highest rank there is. Each bounty adds to your land.`}
        {acres ? ` Your ${acres} acres pay ${Math.round(acres * content.politics.ranks.rentPerAcre)} gold a month in rent.` : ''}
      </span>
    </div>
  );
}

/** What the governor pays for: the ships, and any famous pirate handed over in irons, by name. */
function bountyLabel(content: ContentPack, pay: { captive?: string }[]) {
  const ships = pay.filter((d) => !d.captive).length;
  const names = pay.flatMap((d) => (d.captive ? [content.pirates.captains.find((c) => c.id === d.captive)?.name ?? d.captive] : []));
  const parts = [...(names.length ? [`hand over ${names.join(' and ')}`] : []), ...(ships ? [`collect bounties for ${ships} ${ships === 1 ? 'ship' : 'ships'}`] : [])];
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase());
}

/** The shipwright's three choices: mending the fleet, buying ships, fitting a ship out. */
type Yard = 'repair' | 'buy' | 'upgrade';

/**
 * The shipwright (storyboard 2.9): his bust says the one thing that matters now (she's hurt, her bottom is foul, her
 * gun deck has room) with its button; then three choices, Mend, Ships and Fit out, the ships and fits as cards.
 */
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
  const fleet = fleetOf(state);
  // A major of this nation has his repairs here cheaper.
  const cut = perkPrice(content, state.captain, town.nation, 'repair');
  const cost = repairCost(content, ship, fleet, cut);
  const stats = shipStats(content, ship);
  const gold = state.captain?.gold ?? 0;
  const hamlet = town.size === 'hamlet';
  const careen = Math.ceil(stats.hullMax * content.economy.fouling.careenGoldPerHull);
  const fouling = stats.cleanBottom ? 0 : (ship.fouling ?? 0);
  const room = stats.maxGuns - stats.guns;
  const gunGold = content.combat.port.gunGold;
  // Straight to the mending when anything needs it, else to the ships for sale.
  const [yard, setYard] = useState<Yard>(cost > 0 ? 'repair' : 'buy');
  const hullShare = Math.round(((ship.hull ?? stats.hullMax) / stats.hullMax) * 100);
  const [line, act] =
    cost > 0
      ? [
          fleet.length ? `"Your ships have taken a beating. I'll make them sound for ${cost.toLocaleString()}."` : `"She's taken a beating: hull ${hullShare}%. Mend her for ${cost.toLocaleString()}?"`,
          <button class="k-btn small primary" disabled={gold <= 0} onClick={() => send({ type: 'Repair', shipId })}>
            Repair · {cost.toLocaleString()} gold
          </button>,
        ]
      : fouling >= 0.05 && !hamlet
        ? [
            `"Her bottom's foul with weed and worm: ${Math.round(fouling * 100)}% off her speed. Careen her for ${careen.toLocaleString()}?"`,
            <button class="k-btn small primary" disabled={gold < careen} onClick={() => send({ type: 'Careen', shipId })}>
              Careen her · {careen.toLocaleString()} gold
            </button>,
          ]
        : room > 0 && sellsGuns(town)
          ? [
              `"She's sound. There's room on her deck for ${room} more ${room === 1 ? 'gun' : 'guns'}, ${gunGold} gold apiece."`,
              yard === 'upgrade' ? null : (
                <button class="k-btn small primary" onClick={() => setYard('upgrade')}>
                  See the guns
                </button>
              ),
            ]
          : [`"She's sound and clean, captain. Looking for a new ship, or something to make her better?"`, null];
  const choices: [Yard, string][] = [
    ['repair', 'Mend'],
    ['buy', 'Ships'],
    ['upgrade', 'Fit out'],
  ];
  return (
    <div class="shipwright k-wood">
      <Speech bust="bust.shipwright" who="The shipwright" line={line}>
        <div class="tavern-replies">{act}</div>
      </Speech>
      <div class="shipwright-tabs">
        {choices.map(([id, label]) => (
          <button key={id} class={`k-btn small${yard === id ? ' active' : ''}`} onClick={() => setYard(id)}>
            {label}
          </button>
        ))}
      </div>
      {yard === 'repair' ? (
        <RepairYard content={content} state={state} shipId={shipId} send={send} cost={cost} cut={cut} hamlet={hamlet} />
      ) : yard === 'buy' ? (
        <>
          <LaidUp content={content} state={state} shipId={shipId} send={send} />
          <ShipsForSale content={content} state={state} town={town} shipId={shipId} send={send} />
        </>
      ) : (
        <UpgradeYard content={content} state={state} town={town} shipId={shipId} send={send} />
      )}
    </div>
  );
}

/** Mending: every ship's condition and her own repair, and the whole fleet at once. */
function RepairYard({
  content,
  state,
  shipId,
  send,
  cost,
  cut,
  hamlet,
}: {
  content: ContentPack;
  state: WorldState;
  shipId: string;
  send: PortProps['send'];
  cost: number;
  cut: number;
  hamlet: boolean;
}) {
  const fleet = fleetOf(state);
  return (
    <>
      <div class="shipwright-row">
        {cost > 0 ? (
          <button class="k-btn small primary" onClick={() => send({ type: 'Repair', shipId })}>
            Repair {fleet.length ? 'the whole fleet' : 'her'} · {cost.toLocaleString()} gold
          </button>
        ) : (
          <span class="port-sub">{fleet.length ? 'Every ship is sound.' : 'She is sound.'}</span>
        )}
        <span class="port-sub">
          Hull then sails, the flagship first, as far as the purse reaches.{cut < 1 ? ` Your rank here: ${Math.round((1 - cut) * 100)}% off.` : ''}
        </span>
      </div>
      <Careen content={content} state={state} shipId={shipId} send={send} hamlet={hamlet} />
      <div class="k-sub">Each ship's state, mending one ship alone, and making a ship your flagship or selling her: the log's Fleet page (L).</div>
    </>
  );
}

/** Her bottom: how foul it is, what that costs her in speed, and careening it clean (a copper bottom never fouls). */
function Careen({ content, state, shipId, send, hamlet }: { content: ContentPack; state: WorldState; shipId: string; send: PortProps['send']; hamlet: boolean }) {
  const ship = state.ships[shipId]!;
  const fouling = ship.fouling ?? 0;
  if (shipStats(content, ship).cleanBottom) return <div class="shipwright-row port-sub">Copper-sheathed: her bottom stays clean.</div>;
  const gold = Math.ceil(shipStats(content, ship).hullMax * content.economy.fouling.careenGoldPerHull);
  const foul = fouling >= 0.01;
  const purse = state.captain?.gold ?? 0;
  return (
    <div class="shipwright-row">
      {foul && !hamlet ? (
        <button class="k-btn small" disabled={purse < gold} onClick={() => send({ type: 'Careen', shipId })}>
          Careen her · {gold.toLocaleString()} gold
        </button>
      ) : null}
      <span class="port-sub">
        {!foul
          ? 'Her bottom is clean.'
          : hamlet
            ? `Her bottom is foul: ${Math.round(fouling * 100)}% off her speed. No yard here can careen her: a town's or city's can, or heave her down on a beach yourself (K at sea, ${content.economy.fouling.beachDays} days, free).`
            : purse < gold
              ? `Her bottom is foul: ${Math.round(fouling * 100)}% off her speed. Careening costs ${gold.toLocaleString()} gold; you have ${purse.toLocaleString()}. Or heave her down on a beach (K at sea, free).`
              : `Her bottom is foul with weed and worm: ${Math.round(fouling * 100)}% off her speed. Careened, she sails clean again.`}
      </span>
    </div>
  );
}

/** Fitting out the flagship: her guns, and the yard's improvements. */
function UpgradeYard({ content, state, town, shipId, send }: { content: ContentPack; state: WorldState; town: PlacedSettlement; shipId: string; send: PortProps['send'] }) {
  const ship = state.ships[shipId]!;
  const stats = shipStats(content, ship);
  const gold = state.captain?.gold ?? 0;
  const p = content.combat.port;
  const room = stats.maxGuns - stats.guns;
  const installed = new Set(ship.upgrades ?? []);
  // An admiral's fits come cheaper at his nation's yards, and a major's towns fit the city-only ones.
  const cut = perkPrice(content, state.captain, town.nation, 'upgrade');
  const best = hasPerk(content, state.captain, town.nation, 'bestFits');
  return (
    <>
      <div class="shipwright-row">
        <span>
          Guns {stats.guns} / {stats.maxGuns}
        </span>
        {sellsGuns(town) ? (
          <>
            <button class="k-btn small" disabled={room <= 0 || gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: 1 })}>
              Buy 1 · {p.gunGold} gold
            </button>
            <button class="k-btn small primary" disabled={room <= 0 || gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: room })}>
              Fill the gun deck · {Math.min(room, Math.floor(gold / Math.max(1, p.gunGold))) * p.gunGold} gold
            </button>
            <button class="k-btn small" disabled={stats.guns <= 0} onClick={() => send({ type: 'SellGuns', shipId, count: 1 })}>
              Sell 1 · {p.gunSellGold} gold
            </button>
          </>
        ) : (
          <span class="port-sub">No cannon for sale in a hamlet.</span>
        )}
      </div>
      <div class="fit-cards upgrades">
        {Object.values(content.upgrades).map((u) => {
          // Priced by the work on her class: her guns, her hull or her berths.
          const base = upgradePrice(content, ship.classId, u.id);
          const cost = { ...base, price: Math.round(base.price * cut) };
          // The effect says the upside, then the downside: "+20% hull · -0.5 speed".
          const [up, down] = u.effect.split(' · ');
          return (
            <div key={u.id} class={`fit-card k-paper${installed.has(u.id) ? ' installed' : ''}`}>
              <Art id={`ui.icon.fit.${u.id}`} class="fit-card-icon" />
              <div class="fit-card-body">
                <b>{u.name}</b>
                <div class="fit-up">{up}</div>
                {down ? <div class="fit-down">{down}</div> : null}
                <div class="fit-price">
                  {Math.round(cost.each)} gold a {cost.per === 'hull' ? 'hull point' : cost.per} × her {cost.units}
                  {cut < 1 ? ` · your rank here: ${Math.round((1 - cut) * 100)}% off` : ''}
                </div>
              </div>
              {installed.has(u.id) ? (
                <span class="k-tag peace">installed</span>
              ) : sellsUpgrade(content, town, u.id, best) ? (
                <button class="k-btn small primary" disabled={gold < cost.price} onClick={() => send({ type: 'BuyUpgrade', shipId, upgradeId: u.id })}>
                  Buy · {cost.price.toLocaleString()} gold
                </button>
              ) : (
                <span class="fit-price">not sold here</span>
              )}
            </div>
          );
        })}
      </div>
    </>
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

/**
 * The Top Ten (Pirates! 2004): the famous pirates and the captain, richest first, as the tavern tells it. Each
 * pirate's wealth is what beating her is worth (half of it); a beaten one says when he is due back.
 */
export function TopTen({ content, state, settlements }: { content: ContentPack; state: WorldState; settlements: PlacedSettlement[] }) {
  const ranks = topTen(content, state);
  const place = ranks.findIndex((r) => r.player) + 1;
  const tpd = content.calendar.ticksPerDay;
  const haven = (id?: string) => settlements.find((s) => s.id === id)?.name ?? id;
  const f = famesOf(content, state);
  const pieces = state.captain?.mapPieces ?? {};
  const jailed = new Set((state.captain?.deeds ?? []).flatMap((d) => (d.captive ? [d.captive] : [])));
  // The ten, and the captain at her place below them while she is not one of them.
  const rows = place > 10 ? [...ranks.slice(0, 10), ranks[place - 1]!] : ranks.slice(0, 10);
  const status = (r: (typeof ranks)[number]) => {
    if (r.player) return 'your purse and the chest';
    const months = r.returnAt ? Math.max(1, Math.ceil((r.returnAt - state.tick) / tpd / 30)) : 0;
    const beaten = state.famous?.[r.id!]?.defeats ?? 0;
    const doing = jailed.has(r.id!)
      ? 'your prisoner, for a governor'
      : state.famous?.[r.id!]?.revenge
        ? 'hunting you, for his hoard'
        : r.returnAt
          ? `beaten; back in about ${months} month${months === 1 ? '' : 's'}`
          : `sails from ${haven(r.haven)}`;
    const held = pieces[r.id!] ? ` · you hold ${pieces[r.id!]} of ${content.pirates.rules.mapPieces} pieces of his map` : '';
    return `${doing}${beaten && !r.returnAt ? ` · beaten by you ${beaten === 1 ? 'once' : `${beaten} times`}` : ''}${held}`;
  };
  return (
    <div class="top-ten">
      <div class="book-sub">By their wealth: yours counts your purse and the plunder chest.</div>
      <ol>
        {rows.map((r) => {
          const flag = content.pirates.captains.find((c) => c.id === r.id)?.flag;
          return (
            <li key={r.id ?? 'you'} class={r.player ? 'you' : undefined}>
              <span class="top-rank">{ranks.indexOf(r) + 1}</span>
              <span class="top-flag" style={flag ? { background: flag.field, color: flag.colour } : undefined} aria-hidden="true" />
              <span class="top-name">{r.name}</span>
              <span class="age">{status(r)}</span>
              <span class="top-wealth">{r.wealth.toLocaleString()} gold</span>
            </li>
          );
        })}
      </ol>
      <div class="top-foot">
        <span>
          <b>Your fame</b>: trade {f.trade} · war {f.war} · adventure {f.adventure}
        </span>
        <span class="age">
          {place > 10
            ? `Beat one of them, or grow richer than ${ranks[9]!.name}, to make the list.`
            : place === 1
              ? 'The richest on the Main.'
              : `Beat one above you, or grow richer than ${ranks[place - 2]!.name}, to climb.`}
        </span>
      </div>
    </div>
  );
}

/**
 * The shady stranger (treasure.json): some weeks a sailor in the corner sells a piece of a famous pirate's map,
 * for a share of what the hoard holds. He says whose, what it is worth, and how much of that map the captain holds.
 */
function Stranger({ content, state, here, settlements, shipId, send }: Pick<TavernProps, 'content' | 'state' | 'settlements' | 'shipId' | 'send'> & { here: PlacedSettlement }) {
  const offer = strangerOffer(content, state, here, settlements);
  if (!offer) return null;
  const c = content.pirates.captains.find((x) => x.id === offer.pirateId)!;
  const f = state.famous?.[c.id];
  const worth = f?.hoard?.value ?? Math.round((f?.wealth ?? c.wealth) * content.treasure.hoardShare);
  const held = state.captain?.mapPieces?.[c.id] ?? 0;
  const gold = state.captain?.gold ?? 0;
  return (
    <div class="stranger">
      <Speech bust="bust.stranger" who="The stranger" line={`"A piece of ${c.name}'s map, captain. They say the hoard holds ${worth.toLocaleString()} gold."`}>
        <div class="k-sub">
          You hold {held} of {content.pirates.rules.mapPieces} pieces of it. The first shows the coast it lies on; each one more narrows the search.
        </div>
        <div class="tavern-replies">
          <button class="k-btn small primary" disabled={gold < offer.price} title={gold < offer.price ? `You have ${gold} gold.` : undefined} onClick={() => send({ type: 'BuyMapPiece', shipId, pirateId: c.id })}>
            Buy the piece · {offer.price.toLocaleString()} gold
          </button>
        </div>
      </Speech>
    </div>
  );
}

/** One thing a person in the tavern has to tell: news, or a governor's contract, about a place. */
interface Telling {
  id: string;
  line: string;
  place: string;
  /** "today", "3 days ago"; a contract has none. */
  age?: string;
  fresh: boolean;
  contract?: boolean;
}

/**
 * A teller's speech card: one thing at a time, in their voice, with where it happened on a small chart and a course
 * there; "Anything else?" moves on to the next.
 */
function Teller({
  bust,
  who,
  quiet,
  tellings,
  here,
  settlements,
  map,
  plot,
  heard,
}: {
  bust: string;
  who: string;
  quiet: string;
  tellings: Telling[];
  here: PlacedSettlement;
  settlements: PlacedSettlement[];
  map: TileMap;
  plot?: (x: number, y: number) => void;
  /** This telling has been told (it counts off the person's badge). */
  heard: (id: string) => void;
}) {
  const [k, setK] = useState(0);
  const [chart, setChart] = useState(false);
  const [plotted, setPlotted] = useState<string>();
  const t = tellings[Math.min(k, tellings.length - 1)];
  useEffect(() => {
    if (t) heard(t.id);
  }, [t?.id]);
  if (!t) return <Speech bust={bust} who={who} line={quiet} />;
  const place = settlements.find((s) => s.id === t.place);
  const away = place && place.id !== here.id ? place : undefined;
  return (
    <div class={`tavern-telling${t.contract ? ' contract' : ''}`}>
      <Speech bust={bust} who={who} line={`"${t.line}"`}>
        <div class="tavern-tags">
          {t.fresh ? <span class="k-tag new">new</span> : null}
          {t.contract ? <span class="k-tag contract">contract</span> : null}
          {t.age ? <span class="k-sub">{t.age}</span> : null}
          {tellings.length > 1 ? (
            <span class="k-sub">
              {Math.min(k, tellings.length - 1) + 1} of {tellings.length}
            </span>
          ) : null}
        </div>
        <div class="tavern-replies">
          {away ? (
            <button class={`k-btn small${chart ? ' active' : ''}`} onClick={() => setChart(!chart)}>
              See it on the chart
            </button>
          ) : null}
          {away && plot ? (
            <button
              class="k-btn small"
              onClick={() => {
                plot(away.x, away.y);
                setPlotted(away.name);
              }}
            >
              Plot a course to {away.name}
            </button>
          ) : null}
          {tellings.length > 1 ? (
            <button class="k-btn small" onClick={() => setK((k + 1) % tellings.length)}>
              {k + 1 < tellings.length ? 'Anything else?' : 'From the start'}
            </button>
          ) : null}
        </div>
        {plotted ? <div class="k-sub tavern-plotted">Course set for {plotted}: she sails it when you set sail.</div> : null}
      </Speech>
      {away && chart ? <ChartInset map={map} here={here} there={away} /> : null}
    </div>
  );
}

/** The sailors by the fire: men to sign on, and the crew's pay. */
function Sailors({ content, state, here, shipId, send }: Pick<TavernProps, 'content' | 'state' | 'shipId' | 'send'> & { here: PlacedSettlement }) {
  const ship = state.ships[shipId]!;
  const crew = crewOf(content, ship);
  const room = fleetBerths(content, state, ship) - crew;
  const price = Math.round(content.combat.port.recruitGold * perkPrice(content, state.captain, here.nation, 'recruit'));
  const line = room > 0 ? `"${room} of us would sign on, captain, ${price} gold a man."` : `"Your berths are full, captain. Come back when you've room."`;
  return (
    <Speech bust="bust.sailors" who="The sailors" line={line}>
      <Recruit content={content} state={state} shipId={shipId} send={send} nation={here.nation} />
      <CrewPay content={content} state={state} shipId={shipId} send={send} />
    </Speech>
  );
}

type Person = 'barmaid' | 'oldsalt' | 'stranger' | 'sailors';

/** News of ships and pirates is the barmaid's; prices, wars and plague are the old salt's. */
const barmaidTells = (n: import('@corsair/core').NewsItem) => Boolean(n.ship || n.captain || n.vessel);

/**
 * The tavern (storyboard 2.7): people, not lists. The barmaid, the old salt, the stranger (some weeks) and the
 * sailors stand in the room; one opens their speech card. Listening marks the news heard.
 */
function Tavern({ content, state, settlements, town, rumours, hear, shipId, send, map, plot }: TavernProps) {
  // What was new when the captain walked in stays marked for this visit; a person's badge counts what of it they
  // haven't yet told.
  const [fresh] = useState(() => new Set(rumours.filter((n) => !(state.captain?.heard ?? []).includes(n.id)).map((n) => n.id)));
  const [told_, setTold] = useState<ReadonlySet<string>>(() => new Set());
  const heardHere = (id: string) => setTold((s) => (s.has(id) ? s : new Set(s).add(id)));
  // Once per visit: the port screen renders every frame, so this must not run from render.
  useEffect(hear, []);
  const here = settlements.find((s) => s.id === town)!;
  const today = Math.floor(state.tick / content.calendar.ticksPerDay);
  const told = (n: import('@corsair/core').NewsItem): Telling => {
    const age = today - Math.floor(n.tick / content.calendar.ticksPerDay);
    return {
      id: n.id,
      line: newsText(content, n, settlements.find((s) => s.id === n.settlementId)?.name ?? n.settlementId),
      place: n.settlementId,
      age: age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`,
      fresh: fresh.has(n.id),
    };
  };
  const gossip = rumours.filter(barmaidTells).map(told);
  // The governors' contracts whose news has reached this port come first: they are offers, the rest is talk.
  const talk = [
    ...contractsAt(content, state, settlements, town).map((c) => ({
      id: c.id,
      line: contractLine(content, state, c, settlements.find((s) => s.id === c.settlementId)?.name ?? c.settlementId),
      place: c.settlementId,
      fresh: false,
      contract: true,
    })),
    ...rumours.filter((n) => !barmaidTells(n)).map(told),
  ];
  const stranger = Boolean(strangerOffer(content, state, here, settlements));
  const people: { id: Person; name: string; bust: string; badge: number }[] = [
    { id: 'barmaid', name: 'Barmaid', bust: 'bust.barmaid', badge: gossip.filter((t) => t.fresh && !told_.has(t.id)).length },
    { id: 'oldsalt', name: 'Old salt', bust: 'bust.oldsalt', badge: talk.filter((t) => t.fresh && !told_.has(t.id)).length },
    ...(stranger ? [{ id: 'stranger' as const, name: 'Stranger', bust: 'bust.stranger', badge: 0 }] : []),
    { id: 'sailors', name: 'Sailors', bust: 'bust.sailors', badge: 0 },
  ];
  // Whoever has something new speaks first.
  const [chosen, choose] = useState<Person>(() => people.find((p) => p.badge)?.id ?? 'barmaid');
  const who = people.some((p) => p.id === chosen) ? chosen : 'barmaid';
  return (
    <div class="tavern-room">
      <div class="tavern-people">
        {people.map((p) => (
          <button key={p.id} class={`tavern-person${p.id === who ? ' active' : ''}`} onClick={() => choose(p.id)}>
            <Bust id={p.bust} label={p.name} />
            <span class="tavern-person-name">
              {p.name}
              {p.badge ? <span class="spot-badge">{p.badge}</span> : null}
            </span>
          </button>
        ))}
      </div>
      <div class="k-wood tavern-card">
        {who === 'barmaid' ? (
          <Teller
            key="barmaid"
            bust="bust.barmaid"
            who="The barmaid"
            quiet={`"Quiet tonight, captain. Nobody's seen a prize or a pirate worth the price of a drink."`}
            tellings={gossip}
            here={here}
            settlements={settlements}
            map={map}
            plot={plot}
            heard={heardHere}
          />
        ) : who === 'oldsalt' ? (
          <Teller
            key="oldsalt"
            bust="bust.oldsalt"
            who="The old salt"
            quiet={`"Nothing from the other ports, captain. Ask me again in a week."`}
            tellings={talk}
            here={here}
            settlements={settlements}
            map={map}
            plot={plot}
            heard={heardHere}
          />
        ) : who === 'stranger' ? (
          <Stranger content={content} state={state} here={here} settlements={settlements} shipId={shipId} send={send} />
        ) : (
          <Sailors content={content} state={state} here={here} shipId={shipId} send={send} />
        )}
      </div>
    </div>
  );
}
