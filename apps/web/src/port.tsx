import { inPort } from '@corsair/core';
import type { Contract, WorldState } from '@corsair/core';
import { shipStats, upgradePrice } from '@corsair/data';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import {
  strangerOffer,
  bountiesOwed,
  missionsOwed,
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
  shipRepairCost,
  shipValue,
  handsAt,
  rationPerDay,
  townOf,
  tradeLean,
  tradePreview,
} from '@corsair/systems-economy';
import { enemiesOf, legalTarget } from '@corsair/systems-politics';
import { havenKnown, missionOffer, topTen } from '@corsair/systems-traffic';
import type { MissionOffer } from '@corsair/systems-traffic';
import { RetireConfirm } from './career';
import { Bust, Key, Rise, risen, Speech, Stat } from './ui/kit';
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
  /** Said on arrival, beneath the news: prizes brought in (gold), men who deserted, plague, a refused order (warn). */
  notice?: PortNotice;
  /** Today's date: the clock stands still in port. */
  date: string;
  /** The sea, for the tavern's chart of where news is from. */
  map: TileMap;
  /** Plot a course to a place (tile coordinates), sailed when she sets sail. */
  plot?: (x: number, y: number) => void;
  /** Opens the captain's log (L), in port too. */
  openLog?: () => void;
  /** A building to go in to, asked from outside (a letter's "To the governor"); a new object each time. */
  request?: { service: Service };
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
/** The nation whose warships lie off a town in blockade now, if any. */
function blockadedBy(state: WorldState, town: PlacedSettlement): PlacedSettlement['nation'] | undefined {
  if (!state.towns?.[town.id]?.blockaded) return undefined;
  return Object.values(state.ships).find((s) => s.ai?.blockadeOf === town.id && (s.ai.waitUntil ?? 0) > state.tick)?.ai?.nation;
}

/** Services that work so far; the rest are drawn but marked "soon". */
const READY: Service[] = ['merchant', 'tavern', 'shipwright', 'governor'];
const ALL = 1_000_000; // "as many as possible": the sim stops at gold, hold or stock
/** A full hold's buying first keeps this many days' food aboard, so a cargo never leaves the crew to starve. */
const STORE_DAYS = 10;

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
  // Buying all she can of a cargo first tops up the food to STORE_DAYS: gold spent to the last coin on cargo
  // left the crew starving at sea.
  const shortFood = Math.max(0, Math.ceil((STORE_DAYS - foodDays(content, ship)) * rationPerDay(content, ship)));
  const buyAll = (good: string) => {
    if (good !== 'food' && shortFood > 0) trade('Buy', 'food', shortFood);
    trade('Buy', good, ALL);
  };
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
          : held && (plunder || (cost !== undefined ? q.sell > cost : story.level === 'dear'))
            ? { word: 'sells well here', tone: 'good' }
            : story.level === 'cheap'
              ? { word: 'cheap here', tone: 'good' }
              : story.level === 'dear'
                ? { word: 'dear here', tone: 'bad' }
                : { word: 'fair', tone: '' };
    // The hint: what you paid and what selling makes, else where it sells best.
    const known = held
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
    // What the port makes or needs leads the hint: one line says which way to trade it.
    const hint = [tag, known].filter(Boolean).join(' · ');
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
    const say = (s: 'Buy' | 'Sell', qty: number, cash = purse) => {
      const t = tradePreview(content, town, g.id, stock, s, qty, { gold, room, held, cash }, edge);
      if (!t.units) {
        if (s === 'Buy') return room < 1 ? 'Your hold is full.' : stock < 1 ? `The merchant has no ${name} left.` : `Not enough gold for one ${name}.`;
        return held < 1 ? `You have no ${name} to sell.` : `The merchant is out of gold (${cash} left): his purse fills again day by day, or sell elsewhere.`;
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
    // The full hold's margin: each unit bought raises his price, so it is the average paid that must sell for more.
    const fill = tradePreview(content, town, g.id, stock, 'Buy', ALL, { gold, room, held, cash: purse }, edge);
    const margin = best ? best.sell - (fill.units ? fill.total / fill.units : q.buy) : 0;
    return { g, stock, q, held, tag, story, cost, plunder, best, depth, verdict, hint, why, say, margin, canBuy: stock >= 1 && gold >= q.buy && room > 0, canSell: held >= 1 && purse >= q.sell };
  });
  const hover = (say: (s: 'Buy' | 'Sell', qty: number) => string, s: 'Buy' | 'Sell', qty: number) => ({ onMouseEnter: () => setPreview(say(s, qty)), onMouseLeave: () => setPreview(undefined) });
  // What sells here at a profit (or is plunder), and the best buy for a port you know.
  // The best gain a unit first: his purse may run out, and it should go on what pays most.
  const gainOf = (r: (typeof rows)[number]) => r.q.sell - (r.plunder || r.cost === undefined ? 0 : r.cost);
  const profitable = rows
    .filter((r) => r.g.id !== 'food' && r.canSell && (r.plunder || (r.cost !== undefined && r.q.sell > r.cost) || r.verdict.word === 'sells well here'))
    .sort((a, b) => gainOf(b) - gainOf(a));
  // The one-click sale good by good, his purse emptying as it goes: what it says, and what he can't pay for.
  let cash = purse;
  const sale = profitable.map((r) => {
    const t = tradePreview(content, town, r.g.id, r.stock, 'Sell', ALL, { gold, room, held: r.held, cash }, edge);
    const said = r.say('Sell', ALL, cash);
    cash -= t.total;
    return { r, units: t.units, said };
  });
  const unpaid = sale.filter((s) => s.units < s.r.held);
  const bestBuy = rows.filter((r) => r.g.id !== 'food' && r.canBuy && r.margin > 0).sort((a, b) => b.margin - a.margin)[0];
  // His one line: the dearest thing he'd buy from you, and what he has too much of.
  const dear = rows.filter((r) => r.g.id !== 'food' && r.story.level === 'dear').sort((a, b) => b.q.sell - a.q.sell)[0];
  const glut = rows.filter((r) => r.g.id !== 'food' && r.verdict.word === 'cheap here').sort((a, b) => a.q.buy - b.q.buy)[0];
  const isDear = dear ? `${dear.g.name} ${dear.g.name.endsWith('s') ? 'are' : 'is'} dear here` : '';
  const blockader = blockadedBy(state, town);
  const line = blockader
    ? `"${NATION[blockader]} warships lie off the harbour, captain: little gets in, and what's here is dear."`
    : dear && glut
      ? `"${isDear}, captain, and I've more ${glut.g.name.toLowerCase()} than I can sell."`
      : dear
        ? `"${isDear}, captain: bring me ${dear.g.name.toLowerCase()} and I'll pay for it."`
        : glut
          ? `"I've more ${glut.g.name.toLowerCase()} than I can sell, captain: it's yours cheap."`
          : `"Prices are fair today, captain. What'll it be?"`;
  const opened = rows.find((r) => r.g.id === open);
  // No deal to offer yet (an empty hold, no other port's prices known): what this port makes and needs is the start.
  const made = rows.filter((r) => r.tag === 'made here').map((r) => r.g.name.toLowerCase());
  const needed = rows.filter((r) => r.tag === 'needed here').map((r) => r.g.name.toLowerCase());
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));
  const start = [
    made.length ? `${and(made).replace(/^./, (c) => c.toUpperCase())} ${made.length === 1 ? 'is' : 'are'} made here: cheap to buy, to carry where ${made.length === 1 ? "it's" : "they're"} needed.` : '',
    needed.length ? `${town.name} needs ${and(needed)}: bring ${needed.length === 1 ? 'it' : 'them'} here to sell.` : '',
  ]
    .filter(Boolean)
    .join(' ');
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
            <b class="merchant-gold">
              {gold.toLocaleString()} gold
              <Rise />
            </b>
          </div>
        </div>
        <div class="merchant-actions">
          {profitable.length ? (
            <button
              class="k-btn primary"
              onMouseEnter={() => setPreview(sale.map((s) => s.said).join(' '))}
              onMouseLeave={() => setPreview(undefined)}
              onClick={() => profitable.forEach((r) => trade('Sell', r.g.id, ALL))}
            >
              Sell what sells well: {profitable.map((r) => r.g.name.toLowerCase()).join(', ')}
            </button>
          ) : null}
          {unpaid.length ? (
            <div class="k-sub merchant-short">
              His purse ({purse.toLocaleString()} gold) won't pay for {unpaid.map((s) => `${s.r.held - s.units} of your ${s.r.held} ${s.r.g.name.toLowerCase()}`).join(' or ')}: it fills again day by day, or a bigger port pays for the rest.
            </div>
          ) : null}
          {bestBuy ? (
            <button class="k-btn" {...hover(bestBuy.say, 'Buy', ALL)} onClick={() => buyAll(bestBuy.g.id)}>
              Fill the hold with {bestBuy.g.name.toLowerCase()} for {bestBuy.best!.name}
            </button>
          ) : null}
        </div>
        {shortFood > 0 ? <div class="k-sub merchant-food">Buy max and the full-hold buy keep back gold for {STORE_DAYS} days' food first.</div> : null}
        <div class="merchant-preview">
          {preview ?? (!profitable.length && !bestBuy && start ? start : 'Point at a button to see what the trade comes to; click a good to see why it costs what it does.')}
        </div>
      </div>
      <div class="k-paper merchant-ledger">
        <div class="ledger-head">
          <span class="k-who ink">{town.name} market</span>
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
                  </div>
                  {r.hint ? <div class={`ledger-hint${r.held ? '' : ' best'}`}>{r.hint}</div> : null}
                </td>
                <td class="num ledger-price" title="He charges · he pays">
                  {r.held ? (
                    <span class="ledger-pair">
                      buy <b>{r.q.buy}</b> · sell <b>{r.q.sell}</b>
                    </span>
                  ) : r.stock < 1 ? (
                    '—'
                  ) : (
                    r.q.buy
                  )}
                </td>
                <td class="actions" onClick={(e) => e.stopPropagation()}>
                  {/* Every trade on the row, in the same columns on every row; food is never bought up or sold off whole. */}
                  <div class="ledger-trades">
                    <button class="k-btn small paper" {...hover(r.say, 'Buy', 10)} onClick={() => trade('Buy', r.g.id, 10)} disabled={!r.canBuy}>
                      Buy 10
                    </button>
                    {r.g.id !== 'food' ? (
                      <button class="k-btn small paper" {...hover(r.say, 'Buy', ALL)} onClick={() => buyAll(r.g.id)} disabled={!r.canBuy}>
                        Buy max
                      </button>
                    ) : (
                      <span />
                    )}
                    <button class="k-btn small paper" {...hover(r.say, 'Sell', 10)} onClick={() => trade('Sell', r.g.id, 10)} disabled={!r.held || !r.canSell}>
                      Sell 10
                    </button>
                    {r.g.id !== 'food' ? (
                      <button class="k-btn small paper" {...hover(r.say, 'Sell', ALL)} onClick={() => trade('Sell', r.g.id, ALL)} disabled={!r.held || !r.canSell}>
                        Sell all
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Always there, so opening a good doesn't move the rows: why it costs what it does. */}
        <div class="ledger-why">
          {opened ? (
            <>
              <b>
                {opened.g.name}: why {opened.q.buy}?
              </b>{' '}
              {opened.why.join(' ')}
            </>
          ) : (
            <span class="k-sub ink">Click a good to see why it costs what it does.</span>
          )}
        </div>
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

/** A prize's papers in words: where she sells best, and why. Nothing for a ship bought at a yard. */
export function papersLine(f: { prize?: { lawful?: string } }): string | undefined {
  if (!f.prize) return undefined;
  return f.prize.lawful ? `lawful prize: ${NATION[f.prize.lawful as PlacedSettlement['nation']]} ports pay full` : 'no papers: a pirate haven pays best';
}

/** A line said in port beside the news, with its icon and how it reads (gold good news, warn bad). */
export interface PortNotice {
  text: string;
  icon: string;
  tone: 'gold' | 'warn';
}

/**
 * The news said on arrival (storyboard 2.1), with its kind and icon: the best price here for something in the hold,
 * else news the captain hasn't heard, else what the town makes cheap.
 */
function arrivalNews(
  content: ContentPack,
  state: WorldState,
  town: PlacedSettlement,
  settlements: PlacedSettlement[],
  ship: import('@corsair/core').Ship,
): { kind: string; icon: string; text: string } | undefined {
  const market = state.markets?.[town.id] ?? {};
  const name = (id: string) => content.goods.find((g) => g.id === id)?.name.toLowerCase() ?? id;
  // Little or no food aboard comes first: she shouldn't sail without it.
  const days = Math.floor(foodDays(content, ship));
  if (days < 3) {
    return { kind: 'Stores', icon: 'ui.icon.food', text: days < 1 ? 'No food aboard: buy food at the merchant before you sail.' : `Food for ${days === 1 ? 'one day' : `${days} days`}: buy more at the merchant before you sail.` };
  }
  const held = Object.entries(ship.cargo).filter(([g, n]) => n > 0 && g !== 'food');
  const dear = held
    .map(([g, n]) => ({ g, story: priceStory(content, state, town, g), q: quote(content, town, g, market[g] ?? 0), cost: ship.paid?.[g] !== undefined ? ship.paid[g]! / n : undefined }))
    // Dear here, and dearer than she paid (the merchant's 'sells well here').
    .filter((x) => x.story.level === 'dear' && (x.cost === undefined || x.q.sell > x.cost))
    .sort((a, b) => b.q.sell - a.q.sell)[0];
  if (dear) return { kind: 'Prices', icon: `ui.icon.good.${dear.g}`, text: `Your ${name(dear.g)} ${name(dear.g).endsWith('s') ? 'sell' : 'sells'} well here: ${dear.q.sell} each.` };
  const fresh = newsAt(content, state, settlements, town.id).find((n) => !(state.captain?.heard ?? []).includes(n.id));
  if (fresh) return { kind: 'News', icon: 'ui.icon.morale', text: `${newsText(content, fresh, settlements.find((x) => x.id === fresh.settlementId)?.name ?? town.name)} The tavern has more.` };
  const made = portTrade(content, town).exports[0];
  return made ? { kind: 'Trade', icon: `ui.icon.good.${made}`, text: `${town.name} makes ${name(made)}: it is cheap here at ${quote(content, town, made, market[made] ?? 0).buy}.` } : undefined;
}

/** The port screen: the harbour scene with its buildings to click, and the merchant's market over it. */
export function Port({ state, content, town, settlements, shipId, send, hotspots, onOpen, notice, date, map, plot, openLog, request }: PortProps) {
  // The harbour first (the painting is the menu, storyboard 2.1); a building opens its service, Esc comes back.
  const [open, setOpen] = useState<Service | undefined>(undefined);
  // Retiring asks first, with the score as it stands.
  const [retiring, setRetiring] = useState(false);
  // The docks: the ships in harbour, and retiring.
  const [docks, setDocks] = useState(false);
  useEffect(() => onOpen(open), [open]);
  useEffect(() => {
    if (request) setOpen(request.service);
  }, [request]);
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
  // The governor's: bounties, missions done for him, and letters carried to him.
  const letters = (state.captain?.missions ?? []).filter((m) => m.kind === 'courier' && m.done === undefined && (m.delivered === undefined ? m.to : m.from) === town.id).length;
  const owed = hasGovernor(town) ? bountiesOwed(content, state, town.nation).pay.length + missionsOwed(state, town.id).pay.length + letters : 0;
  // The shipwright's badge counts the ships of the fleet (and any laid up here) he can mend, fit or sell;
  // with the flagship alone, mending to do.
  const yardShips = fleetOf(state).length + (state.captain?.laidUp ?? []).filter((l) => l.settlementId === town.id).length;
  const mending = repairCost(content, ship, fleetOf(state)) > 0 ? 1 : 0;
  const badge: Partial<Record<Service, number>> = { tavern: unheard, governor: owed, shipwright: yardShips || mending };
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
      <div class="port port-retire">
        <RetireConfirm content={content} state={state} retire={() => send({ type: 'Retire', shipId })} cancel={() => setRetiring(false)} />
      </div>
    );

  if (!open) {
    const standing = state.captain?.standing?.[town.nation] ?? 0;
    const crew = crewOf(content, ship);
    const berths = fleetBerths(content, state, ship);
    const food = Math.floor(foodDays(content, ship));
    const morale = moraleOf(content, state);
    const news = arrivalNews(content, state, town, settlements, ship);
    // The ships lying here, by the date: how many, and whose.
    const moored = Object.values(state.ships).filter((s) => inPort(s) && s.ai!.from === town.id);
    const flags = [...new Set(moored.map((s) => s.ai!.nation))];
    const whose = flags.length === 1 ? (flags[0] === 'pirate' ? 'pirates' : NATION[flags[0]!]) : undefined;
    const n = moored.length;
    const lying = !n
      ? 'no other ships in harbour'
      : n === 1
        ? `a ship in harbour${whose ? `, ${whose}` : ''}`
        : `${n} ships in harbour${whose ? `, ${n === 2 ? 'both' : 'all'} ${whose}` : ''}`;
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
        {news || notice ? (
          <div class="harbour-news">
            {news ? (
              <div class="hud-toast">
                <Art id={news.icon} class="hud-toast-icon" />
                <span>
                  <b>{news.kind}:</b> {news.text}
                </span>
              </div>
            ) : null}
            {notice ? (
              <div class={`hud-toast ${notice.tone}`}>
                <Art id={notice.icon} class="hud-toast-icon" />
                <span>{notice.text}</span>
              </div>
            ) : null}
          </div>
        ) : null}
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
            <Stat icon="ui.icon.gold" value={gold.toLocaleString()} title="Gold in your purse" rise={risen()} />
            <Stat icon="ui.icon.crew" value={`${crew} men`} title={`Crew ${crew} of ${berths} berths`} low={crew < berths / 3} />
            <Stat icon="ui.icon.food" value={`${food} ${food === 1 ? 'day' : 'days'}`} title="Food aboard, in days for this crew" low={food <= 3} />
            <Stat icon="ui.icon.morale" value={moraleWord(content, morale)} title="The crew's morale" low={morale < 40} />
          </div>
          <span class="harbour-date">
            {date} · {lying}
          </span>
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
          <div class="interior-right">
            <Holdings content={content} state={state} shipId={shipId} service={open} />
            <button class="k-btn small" onClick={() => setOpen(undefined)} title="Back to the harbour">
              Leave <Key k="Esc" />
            </button>
          </div>
        </div>
        {notice ? <div class={`hud-toast interior-notice ${notice.tone}`}>{notice.text}</div> : null}

        {open === 'governor' ? (
          <Governor content={content} state={state} town={town} settlements={settlements} shipId={shipId} send={send} />
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

/**
 * What the captain has to spend and to fill, beside the way out of every building where gold buys something: the
 * purse always, then what that building deals in (the shipwright's guns and fleet, the tavern's men, food and chest,
 * the governor's chest). The merchant's ledger shows its own (the hold, his purse, yours).
 */
function Holdings({ content, state, shipId, service }: { content: ContentPack; state: WorldState; shipId: string; service: Service }) {
  if (service === 'merchant') return null;
  const ship = state.ships[shipId]!;
  const gold = state.captain?.gold ?? 0;
  const crew = crewOf(content, ship);
  const berths = fleetBerths(content, state, ship);
  const chest = Math.round(state.captain?.chest ?? 0);
  const { guns, maxGuns } = shipStats(content, ship);
  const food = Math.floor(foodDays(content, ship));
  const morale = moraleOf(content, state);
  const purse = <Stat icon="ui.icon.gold" value={`${gold.toLocaleString()} gold`} title="Gold in your purse" rise={risen()} />;
  const hurt = ship.wounded ?? 0;
  const men = (
    <Stat icon="ui.icon.crew" value={`${crew} of ${berths} men${hurt ? ` · ${hurt} hurt` : ''}`} title={`Crew ${crew}, berths ${berths}${hurt ? `; ${hurt} wounded, mending at sea` : ''}`} low={crew < berths / 3} />
  );
  const plunder = <Stat icon="ui.icon.chest" value={`${chest.toLocaleString()} in the chest`} title="The plunder chest: the crew's, divided at the tavern" />;
  return (
    <div class="interior-holdings">
      {purse}
      {service === 'shipwright' ? (
        <>
          <Stat icon="ui.icon.cannon_loaded" value={`${guns} of ${maxGuns} guns`} title="Guns on the flagship, of her gun deck" />
          {men}
          <Stat icon="ui.icon.anchor" value={`${fleetOf(state).length + 1} of ${content.combat.fleet.maxShips} ships`} title="Ships in your fleet, of the most one captain can keep" />
        </>
      ) : service === 'tavern' ? (
        <>
          {plunder}
          {men}
          <Stat icon="ui.icon.food" value={`${food} ${food === 1 ? 'day' : 'days'}`} title="Food aboard, in days for this crew" low={food <= 3} />
          <Stat icon="ui.icon.morale" value={moraleWord(content, morale)} title="The crew's morale" low={morale < 40} />
        </>
      ) : (
        plunder
      )}
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
function Recruit({ content, state, shipId, send, port }: Pick<TavernProps, 'content' | 'state' | 'shipId' | 'send'> & { port: PlacedSettlement }) {
  const nation = port.nation;
  const ship = state.ships[shipId]!;
  const cls = content.ships[ship.classId]!;
  const crew = crewOf(content, ship);
  // A captain of this nation finds men easier: they sign on for less.
  const cut = perkPrice(content, state.captain, nation, 'recruit');
  const price = content.combat.port.recruitGold * cut;
  const berths = fleetBerths(content, state, ship);
  // Only so many men look for a berth here; more come over the week.
  const hands = handsAt(content, state, port);
  const room = Math.min(berths - crew, hands);
  // A purse that won't pay for the men she needs: they sign on for a share of the plunder, up to half her berths.
  const upTo = Math.floor(berths * content.crew.shares.upTo);
  const onShares = Math.min(upTo - crew, hands);
  const broke = (state.captain?.gold ?? 0) < price * Math.max(1, upTo - crew);
  // Gold for one man at least: else the bounty buttons can do nothing.
  const canPay = (state.captain?.gold ?? 0) >= price;
  const wounded = ship.wounded ?? 0;
  // Her guns want men: a broadside's crew to fire at all, and fullManning times that for her fastest reloads.
  const guns = shipStats(content, ship).guns;
  const broadside = Math.ceil((guns * content.combat.guns.crewPerGun) / 2);
  const fastest = broadside * content.crew.manning.fullManning;
  const manned =
    crew < cls.minCrew
      ? { word: `too few to sail her (${cls.minCrew})`, tone: 'war' }
      : crew < broadside
        ? { word: `too few to work her guns (${broadside})`, tone: 'war' }
        : crew < fastest
          ? { word: `${fastest} for her fastest reloads`, tone: '' }
          : { word: 'her guns fully manned', tone: 'gold' };
  return (
    <div class="k-wood tavern-sub recruit">
      <div class="tavern-sub-head">
        <span>
          Crew <b>{crew}</b> of {berths} berths{wounded ? ` · ${wounded} wounded, mending at sea` : ''}
        </span>
        <span class={`k-tag ${manned.tone}`}>{manned.word}</span>
      </div>
      <div class="k-bar">
        <span style={{ width: `${Math.round((crew / Math.max(1, berths)) * 100)}%` }} />
      </div>
      <div class="tavern-replies">
        <button class="k-btn small" disabled={room <= 0 || !canPay} onClick={() => send({ type: 'Recruit', shipId, count: Math.min(10, room) })}>
          Sign on {Math.min(10, Math.max(room, 0))} · {Math.round(Math.min(10, Math.max(room, 0)) * price)} gold
        </button>
        <button class={`k-btn small${broke && onShares > 0 ? '' : ' primary'}`} disabled={room <= 0 || !canPay} onClick={() => send({ type: 'Recruit', shipId, count: room })}>
          {room < berths - crew ? `Sign on all ${Math.max(room, 0)}` : 'Fill the berths'} · {Math.round(Math.max(room, 0) * price)} gold
        </button>
        {broke && onShares > 0 ? (
          <button class="k-btn small primary" onClick={() => send({ type: 'Recruit', shipId, count: onShares, shares: true })}>
            Sign on {onShares} for shares · no gold
          </button>
        ) : null}
      </div>
      {broke && onShares > 0 ? (
        <div class="k-sub">
          Your purse can't pay them, but men will sign on for a share of the plunder, up to {upTo}. They'll expect a prize soon: morale −{Math.round(onShares * content.crew.shares.moraleEach)}.
        </div>
      ) : null}
      <div class="k-sub">
        {hands > 0 ? `${hands} ${hands === 1 ? 'man looks' : 'men look'} for a berth here` : 'No one here looks for a berth: more come in over the week, or try another port'}
        {hands > 0 && hands < berths - crew ? `: not enough to fill her, try another port for the rest` : ''}.
      </div>
      {cut < 1 ? <div class="k-sub">Your rank here: men sign on for {Math.round((1 - cut) * 100)}% less.</div> : null}
      <div class="k-sub">
        {berths - crew > 0
          ? `Each 10 more men: food lasts ${Math.floor(foodDays(content, { ...ship, crew: crew + 10 }))} days instead of ${Math.floor(foodDays(content, ship))}, and wages rise ${10 * content.crew.wagesPerManDay} gold a day.`
          : 'Every berth is taken: a bigger ship, or hammocks at the shipwright, berths more.'}
      </div>
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
  const gold = state.captain?.gold ?? 0;
  const m = content.crew.morale;
  return (
    <div class="k-wood tavern-sub crew-pay">
      <div class="tavern-sub-title">Paying the crew</div>
      <div class="crew-chest">
        <Art id="ui.icon.chest" class="crew-chest-icon" />
        <div>
          <div>
            <b class="crew-chest-gold">{Math.round(share.chest).toLocaleString()}</b> gold in the plunder chest
          </div>
          <div class="k-sub">
            The crew sails for it. {days} {days === 1 ? 'day' : 'days'} since they were last paid.
          </div>
        </div>
      </div>
      <div class="crew-morale">
        <Art id="ui.icon.morale" class="inline-icon" /> Morale:{' '}
        <b>
          {moraleWord(content, morale)}
          {Math.abs(drift) > 2 ? `, ${drift > 0 ? 'rising' : 'falling'}` : ''}
        </b>
        <span class="k-sub">At "{moraleWord(content, m.deserting - 1)}" men slip away in port</span>
      </div>
      <div class="crew-choice">
        <button class="k-btn small primary" disabled={share.chest <= 0} onClick={() => send({ type: 'DividePlunder', shipId })}>
          <span>Divide the plunder</span>
          {share.chest > 0 ? <span class="crew-choice-what">you {share.captain} · each man {Math.round(share.perHead)}</span> : null}
        </button>
        <span class="k-sub">
          {share.chest > 0 ? 'The chest is emptied; the bigger each share, the happier they are.' : 'Nothing in the chest yet: prizes and plunder fill it.'}
        </span>
      </div>
      <div class="crew-choice">
        <button class="k-btn small" disabled={owed <= 0 || gold < owed} onClick={() => send({ type: 'PayWages', shipId })}>
          <span>Pay wages instead</span>
          {owed > 0 ? <span class="crew-choice-what">{owed} gold from your purse</span> : null}
        </button>
        <span class="k-sub">
          {owed <= 0
            ? 'Paid up: nothing owed yet.'
            : gold < owed
              ? `You have ${gold.toLocaleString()} gold.`
              : `${content.crew.wagesPerManDay} gold a man a day since they were last paid; the chest stays theirs.`}
        </span>
      </div>
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
      <div class="ships-for-sale-head">
        <span class="k-sub">
          Each joins your fleet at once: make her your flagship to fight in her. The great ships are built in Europe, and the half-galleys are Spain's: take one.
        </span>
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
              <div class="ship-card-head">
                <span class="ship-card-name">{shipKind(id)}</span>
                {ROLE[cls.family] ? <span class="k-tag">{ROLE[cls.family]}</span> : null}
              </div>
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

/** What a class of ship is for, by her family, in a word for her card. */
const ROLE: Record<string, string> = { sloop: 'raider', brig: 'all-rounder', frigate: 'warship', merchant: 'trader', galleon: 'great trader', galley: 'galley', boat: 'boat' };

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
 * you've earned, a war or a peace); then the bounties to collect, your rank on the whole ladder, and one
 * offer at a time with what taking it means.
 */
function Governor({
  content,
  state,
  town,
  settlements,
  shipId,
  send,
}: {
  content: ContentPack;
  state: WorldState;
  town: PlacedSettlement;
  settlements: PlacedSettlement[];
  shipId: string;
  send: PortProps['send'];
}) {
  // His last call here, read before this one is recorded, so the summary covers the time between.
  const [last] = useState(() => state.captain?.calledOn?.[town.id]);
  useEffect(() => send({ type: 'CallOnGovernor', shipId }), []);
  const [declined, decline] = useState(false);
  const [passed, pass] = useState(false);
  if (!hasGovernor(town)) {
    return <p class="port-sub">There is no governor here: only towns and cities have one.</p>;
  }
  const nation = town.nation;
  const enemies = enemiesOf(content, state, nation).filter((n) => n !== 'pirate');
  const piracy = Math.round(state.politics?.piracy[nation] ?? 0);
  const held = (state.captain?.marques ?? []).includes(nation);
  const price = marquePrice(content, state, nation);
  const owed = bountiesOwed(content, state, nation);
  // His missions done, paid with the bounties; and the one he offers this week.
  const done = missionsOwed(state, town.id);
  const job = missionOffer(content, state, town, settlements);
  const full = (state.captain?.missions ?? []).filter((m) => m.done === undefined).length >= content.politics.missions.open;
  const standing = state.captain?.standing?.[nation] ?? 0;
  const list = (ns: readonly string[]) => ns.map((n) => COUNTRY[n]).join(' and ');
  // Wars and peace made by his nation since the last call.
  const since = (state.news ?? []).filter((n) => (n.kind === 'war' || n.kind === 'peace') && (n.nation === nation || n.other === nation) && n.tick > (last ?? state.tick));
  const captives = owed.pay.flatMap((d) => (d.captive ? [content.pirates.captains.find((c) => c.id === d.captive)?.name ?? d.captive] : []));
  const ships = deedsSaid(owed.pay);
  const days = last === undefined ? 0 : Math.floor((state.tick - last) / content.calendar.ticksPerDay);
  const beaten = done.pay.filter((m) => m.kind === 'hunt').map((m) => `the ${m.name}`);
  const replies = done.pay.filter((m) => m.kind === 'courier').map((m) => settlements.find((x) => x.id === m.to)?.name ?? m.to);
  const thanks = `${beaten.length ? `So ${beaten.join(' and ')} will trouble us no more! ` : ''}${replies.length ? `The reply from ${replies.join(' and ')}, at last. ` : ''}`;
  // A letter carried to him, handed over this call: he writes his reply.
  const letter = (state.captain?.missions ?? []).find((m) => m.kind === 'courier' && m.to === town.id && m.done === undefined && m.delivered === state.tick);
  const sender = letter && settlements.find((x) => x.id === letter.from)?.name;
  const line = letter
    ? `"A letter from the governor of ${sender}? Wait while I write my reply, captain: see that he has it.${letter.paid ? ` And ${letter.paid.toLocaleString()} gold for your trouble.` : ''}"`
    : owed.pay.length || done.pay.length
    ? `"${thanks}${captives.length ? `${captives.join(' and ')} in irons! ` : ''}${ships ? `You've seen to ${ships} for us. ` : ''}${CROWN[nation]} is pleased."`
    : since.length
      ? `"Since you were last here: ${newsText(content, since[since.length - 1]!, town.name)}"`
      : last === undefined
        ? `"So you're the captain they talk of. ${COUNTRY[nation]} has need of men like you."`
        : days < 1
          ? `"Back so soon, captain?"`
          : `"Nothing has changed since you were last here, ${days} ${days === 1 ? 'day' : 'days'} ago."`;
  const offer = !held && enemies.length && price !== undefined && !declined;
  // His nation's ports under blockade now, this one first: breaking one is worth his while.
  const blockades = [town, ...settlements.filter((s) => s.nation === nation && s.id !== town.id)]
    .map((s) => ({ s, by: blockadedBy(state, s) }))
    .filter((b): b is { s: PlacedSettlement; by: PlacedSettlement['nation'] } => Boolean(b.by));
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
      <div class="k-paper governor-card governor-bounty">
        <Art id="ui.icon.chest" class="governor-bounty-icon" />
        {owed.pay.length || done.pay.length ? (
          <>
            <div class="governor-bounty-text">
              <b>
                {owed.pay.length ? `Bounties owed: ${[...captives, ...(ships ? [ships] : [])].join(' and ')}` : ''}
                {owed.pay.length && done.pay.length ? '; ' : ''}
                {done.pay.length ? `Your reward for ${[...beaten, ...replies.map((r) => `the letter to ${r}`)].join(' and ')}` : ''}
              </b>
              <span class="k-sub">
                {owed.total ? `${owed.total.toLocaleString()} gold in bounties, into the plunder chest. ` : ''}
                {done.total ? `${done.total.toLocaleString()} gold for the work done, into your purse.` : ''}
                {done.merit ? ` ${done.merit} merit with ${COUNTRY[nation]} toward your next rank.` : ''}
              </span>
            </div>
            <button class="k-btn ink" onClick={() => send({ type: 'CollectBounties', shipId })}>
              {owed.pay.length ? bountyLabel(content, owed.pay) : 'Collect your reward'} · {(owed.total + done.total).toLocaleString()} gold
            </button>
          </>
        ) : (
          <div class="governor-bounty-text">
            <b>No bounty owed here.</b>
            <span class="k-sub">
              {(state.captain?.deeds ?? []).length
                ? `${state.captain!.deeds!.length} of your deeds wait for a governor at war with those nations.`
                : `Every ship of ${list(enemies) || 'his enemies'} you take${held ? '' : ' under his letter'} earns a bounty here.`}
            </span>
          </div>
        )}
      </div>
      {blockades.length ? (
        <div class="k-paper governor-card governor-blockade">
          <Art id="ui.icon.anchor" class="governor-bounty-icon" />
          <div class="governor-bounty-text">
            <b>
              Break the blockade: {blockades.map((b) => `${NATION[b.by]} warships off ${b.s.id === town.id ? 'our harbour' : b.s.name}`).join(', ')}
            </b>
            <span class="k-sub">
              Sink or take one while she lies there: {content.politics.bounty.blockade.toLocaleString()} gold more than a warship's bounty, and it counts{' '}
              {content.politics.bounty.blockadeMerit} times over toward your rank. They will challenge you too, going in and out.
            </span>
          </div>
        </div>
      ) : null}
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
            “{list(enemies)} {enemies.length === 1 ? 'is' : 'are'} our enemy. A letter of marque, {price ? `${price.toLocaleString()} gold` : 'freely given'}?”
          </div>
          <div class="governor-offer-means">
            Their ships become lawful prizes: each one you take raises your standing with {COUNTRY[nation]} and earns a bounty here.{' '}
            {list(enemies)} will think the worse of you for it.
            {job ? ' He has other work for you too: say Not now to hear it.' : ''}
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
      {/* One offer at a time: his mission waits while he offers his letter. */}
      {job && !offer ? (
        passed ? (
          <div class="governor-row k-sub">
            <button class="k-btn small" onClick={() => pass(false)}>
              Ask about work for {COUNTRY[nation]}
            </button>
          </div>
        ) : (
          <MissionCard content={content} job={job} settlements={settlements} nation={nation} full={full} accept={() => send({ type: 'AcceptMission', shipId })} pass={() => pass(true)} />
        )
      ) : null}
    </div>
  );
}

/** The governor's mission this week: what he asks in his words, what it pays and how long it stands, and Accept or Not now. */
function MissionCard({
  content,
  job,
  settlements,
  nation,
  full,
  accept,
  pass,
}: {
  content: ContentPack;
  job: MissionOffer;
  settlements: PlacedSettlement[];
  nation: PlacedSettlement['nation'];
  full: boolean;
  accept: () => void;
  pass: () => void;
}) {
  const to = settlements.find((s) => s.id === job.to)?.name ?? job.to;
  const m = content.politics.missions;
  const pays = `${job.reward.toLocaleString()} gold into your purse and ${job.merit} merit with ${COUNTRY[nation]}`;
  return (
    <div class="k-paper governor-offer">
      <div class="k-say">
        {job.kind === 'hunt'
          ? `“The pirate ${shipKind(job.classId!)} ${job.name} has been taking our ships off ${to}. Find her, and sink or take her.”`
          : `“Carry this letter to the governor of ${to}, captain, and bring me back his reply.”`}
      </div>
      <div class="governor-offer-means">
        {job.kind === 'hunt'
          ? `She is a match for your ship, well manned. Beat her and come back to me: ${pays}, with the bounty for a pirate besides.`
          : `A voyage there and back: ${pays}, a quarter of it from the governor of ${to} when you hand him the letter, the rest when his reply is in my hand.`}{' '}
        The work stands {m.lapseWeeks} weeks, and there is no shame in leaving it.
      </div>
      <div class="tavern-replies">
        <button class="k-btn small primary" disabled={full} title={full ? `You have ${m.open} missions in hand: finish one first` : undefined} onClick={accept}>
          {full ? `${m.open} missions in hand already` : 'Accept'}
        </button>
        <button class="k-btn small paper" onClick={pass}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** His rank with the governor's nation, every rung on one line and his own marked: what the next asks and brings, and his land. */
function Rank({ content, state, nation }: { content: ContentPack; state: WorldState; nation: PlacedSettlement['nation'] }) {
  const ladder = content.politics.ranks.ladder;
  const r = rankOf(content, state.captain, nation);
  const merit = state.captain?.merit?.[nation] ?? 0;
  const next = ladder[r + 1];
  const acres = landOf(content, state.captain, nation);
  return (
    <div class="k-paper governor-card governor-rank">
      <div class="moment-kicker">Your rank with {COUNTRY[nation]}</div>
      <ol class="rank-ladder">
        {ladder.map((l, i) => (
          <li key={l.id} class={`${i <= r ? 'won' : ''}${i === r ? ' now' : ''}`}>
            <span class="rank-dot" />
            <span class="rank-name">{l.name}</span>
          </li>
        ))}
      </ol>
      <div class="rank-said">
        {r < 0 ? (
          <>
            A letter of marque is your first rank with {COUNTRY[nation]}; then every bounty collected here raises you, on to a title and land.
          </>
        ) : next ? (
          <>
            <b>{ladder[r]!.name}.</b> Merit {merit}: {next.merit - merit} more (a point a bounty, more for a famous pirate) to <b>{next.name}</b>, which brings{' '}
            {rungBrings(content, r + 1).join(', ') || 'a higher rank'}.
          </>
        ) : (
          <>
            <b>{ladder[r]!.name}.</b> Merit {merit}: the highest rank there is. Each bounty adds to your land.
          </>
        )}
        {acres ? ` Your ${acres} acres pay ${Math.round(acres * content.politics.ranks.rentPerAcre)} gold a month in rent.` : ''}
      </div>
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
type Yard = 'ships' | 'buy' | 'upgrade';

/**
 * The shipwright (storyboard 2.9): three choices across the top, Mend her, Ships for sale and Fit her out. Mend
 * opens first: his bust says the one thing that matters now (she's hurt, her bottom is foul, her gun deck has room),
 * and the mending and careening beneath it; the ships and fits are cards.
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
  // He greets you at the mending: his word on her, and the work it needs beneath it.
  const [yard, setYard] = useState<Yard>('ships');
  // The ship the fits go on: the flagship, or one of the fleet.
  const [fitting, setFitting] = useState(shipId);
  const fitOut = (id: string) => (setFitting(id), setYard('upgrade'));
  const hullShare = Math.round(((ship.hull ?? stats.hullMax) / stats.hullMax) * 100);
  const worst = Math.min(hullShare, Math.round(ship.sailCondition ?? 100));
  // How hard he speaks of it goes by how hurt she is: a few shot holes are not a beating.
  const hurt = worst < 50 ? "She's taken a beating" : worst < 85 ? "She's been knocked about" : 'A few shot holes to patch';
  const [line, act] =
    cost > 0
      ? [fleet.length ? `"Your ships need mending. I'll make them sound for ${cost.toLocaleString()}."` : `"${hurt}. I'll make her sound for ${cost.toLocaleString()}."`, null]
      : fouling >= 0.05 && !hamlet
        ? [`"Her bottom's foul with weed and worm: ${Math.round(fouling * 100)}% off her speed. Careen her for ${careen.toLocaleString()}?"`, null]
        : room > 0 && sellsGuns(town)
          ? [
              `"She's sound. There's room on her deck for ${room} more ${room === 1 ? 'gun' : 'guns'}, ${gunGold} gold apiece."`,
              yard === 'upgrade' ? null : (
                <button class="k-btn small primary" onClick={() => fitOut(shipId)}>
                  See the guns
                </button>
              ),
            ]
          : [`"She's sound and clean, captain. Looking for a new ship, or something to make her better?"`, null];
  const choices: [Yard, string][] = [
    ['ships', 'Your ships'],
    ['buy', 'Ships for sale'],
    ['upgrade', 'Fit out'],
  ];
  return (
    <div class="shipwright k-wood">
      <div class="shipwright-tabs">
        {choices.map(([id, label]) => (
          <button key={id} class={`k-btn${yard === id ? ' primary active' : ''}`} onClick={() => setYard(id)}>
            {label}
          </button>
        ))}
      </div>
      {yard === 'ships' ? (
        <>
          <Speech bust="bust.shipwright" who="The shipwright" line={line}>
            {act ? <div class="tavern-replies">{act}</div> : null}
          </Speech>
          <RepairYard content={content} state={state} shipId={shipId} send={send} cost={cost} cut={cut} hamlet={hamlet} />
          <YourShips content={content} state={state} town={town} shipId={shipId} send={send} cut={cut} fitOut={fitOut} />
          <LaidUp content={content} state={state} shipId={shipId} send={send} />
        </>
      ) : yard === 'buy' ? (
        <ShipsForSale content={content} state={state} town={town} shipId={shipId} send={send} />
      ) : (
        <>
          {fleet.length ? (
            <div class="yard-fitting">
              <span class="k-sub">Fitting out:</span>
              {[{ id: shipId, name: ship.name ?? 'your flagship' }, ...fleet].map((s) => (
                <button key={s.id} class={`k-btn small${(fleet.some((f) => f.id === fitting) ? fitting : shipId) === s.id ? ' primary active' : ''}`} onClick={() => setFitting(s.id)}>
                  {s.name}
                </button>
              ))}
            </div>
          ) : null}
          <UpgradeYard content={content} state={state} town={town} shipId={shipId} send={send} only={fleet.some((f) => f.id === fitting) ? fitting : undefined} />
        </>
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
  const ship = state.ships[shipId]!;
  const stats = shipStats(content, ship);
  const gold = state.captain?.gold ?? 0;
  return (
    <div class="yard-rows">
      <div class="yard-row">
        <Art id="ui.icon.hull" class="inline-icon" />
        <div class="yard-row-what">
          <b>{fleet.length ? 'Mend the fleet' : 'Mend her'}</b> · hull {Math.round(ship.hull ?? stats.hullMax)} of {stats.hullMax}, sails {Math.round(ship.sailCondition ?? 100)}%
          {fleet.length ? ` · and ${fleet.length} more ${fleet.length === 1 ? 'ship' : 'ships'}` : ''}
          <div class="k-sub">
            {cost > gold ? `Hull then sails, the flagship first, as far as your ${gold.toLocaleString()} gold reaches.` : ''}
            {cut < 1 ? ` Your rank here: ${Math.round((1 - cut) * 100)}% off.` : ''}
          </div>
        </div>
        {cost > 0 ? (
          <button class="k-btn primary" disabled={gold <= 0} onClick={() => send({ type: 'Repair', shipId })}>
            Mend · {cost.toLocaleString()} gold
          </button>
        ) : (
          <span class="k-tag peace">sound</span>
        )}
      </div>
      <Careen content={content} state={state} shipId={shipId} send={send} hamlet={hamlet} />
    </div>
  );
}

/**
 * Your ships (storyboard 3.1): a card a ship, the flagship first, each with her state and her own orders: mend her,
 * fit her out, make her the flagship, sell her.
 */
function YourShips({
  content,
  state,
  town,
  shipId,
  send,
  cut,
  fitOut,
}: {
  content: ContentPack;
  state: WorldState;
  town: PlacedSettlement;
  shipId: string;
  send: PortProps['send'];
  cut: number;
  fitOut: (id: string) => void;
}) {
  const ship = state.ships[shipId]!;
  const fleet = fleetOf(state);
  const gold = state.captain?.gold ?? 0;
  const hold = fleetHold(content, state, ship);
  const berths = fleetBerths(content, state, ship);
  const cargo = cargoUsed(ship);
  const crew = crewOf(content, ship);
  const fits = (u?: string[]) => (u ?? []).map((id) => content.upgrades[id]?.name.toLowerCase()).filter(Boolean);
  const condition = (f: { classId: string; hull?: number; sailCondition?: number; upgrades?: string[]; guns?: number }) => {
    const stats = shipStats(content, f);
    return [`hull ${Math.round(f.hull ?? stats.hullMax)} of ${stats.hullMax}`, `sails ${Math.round(f.sailCondition ?? 100)}%`, `${stats.guns} guns`, ...fits(f.upgrades)].join(' · ');
  };
  const mend = (id: string, f: Parameters<typeof shipRepairCost>[1]) => {
    const cost = shipRepairCost(content, f, cut);
    return cost > 0 ? (
      <button class="k-btn small" disabled={gold <= 0} title={gold < cost ? `You have ${gold} gold: as far as the purse reaches.` : undefined} onClick={() => send({ type: 'Repair', shipId, only: id })}>
        Mend · {cost.toLocaleString()}
      </button>
    ) : null;
  };
  return (
    <div class="yard-ships">
      <div class="yard-ship flagship">
        <Art id={shipIcon(content, ship.classId)} class="yard-ship-art" />
        <div class="yard-ship-what">
          <b>{ship.name ?? 'Your flagship'}</b> <span class="k-sub">{shipKind(ship.classId)} · flagship</span>
          <div class="k-sub">{condition(ship)}</div>
        </div>
        <div class="yard-ship-orders">
          {fleet.length ? mend(ship.id, ship) : null}
          <button class="k-btn small" onClick={() => fitOut(ship.id)}>
            Fit out
          </button>
        </div>
      </div>
      {fleet.map((f) => {
        const cls = content.ships[f.classId]!;
        const why =
          hold - cls.cargo < cargo
            ? `Her hold is needed: the rest of the fleet can't carry the ${cargo} tons aboard.`
            : berths - shipStats(content, f).maxCrew < crew
              ? `Her berths are needed: the rest of the fleet can't berth your ${crew} men.`
              : undefined;
        return (
          <div key={f.id} class="yard-ship">
            <Art id={shipIcon(content, f.classId)} class="yard-ship-art" />
            <div class="yard-ship-what">
              <b>{f.name}</b> <span class="k-sub">{shipKind(f.classId)}</span>
              <div class="k-sub">{condition(f)}</div>
              {papersLine(f) ? <div class={`k-sub yard-papers${f.prize?.lawful ? ' lawful' : ''}`}>{papersLine(f)}</div> : null}
            </div>
            <div class="yard-ship-orders">
              {mend(f.id, f)}
              <button class="k-btn small" onClick={() => fitOut(f.id)}>
                Fit out
              </button>
              <button class="k-btn small" onClick={() => send({ type: 'MakeFlagship', shipId, fleetId: f.id })}>
                Make flagship
              </button>
              <button class="k-btn small" disabled={Boolean(why)} title={why} onClick={() => send({ type: 'SellShip', shipId, fleetId: f.id })}>
                Sell · {shipValue(content, f, town).toLocaleString()}
              </button>
            </div>
          </div>
        );
      })}
      {!fleet.length ? <div class="k-sub">Your fleet is your flagship alone. Keep a prize, or buy a ship, to grow it.</div> : null}
    </div>
  );
}

/** Her bottom: how foul it is, what that costs her in speed, and careening it clean (a copper bottom never fouls). */
function Careen({ content, state, shipId, send, hamlet }: { content: ContentPack; state: WorldState; shipId: string; send: PortProps['send']; hamlet: boolean }) {
  const ship = state.ships[shipId]!;
  const fouling = ship.fouling ?? 0;
  const copper = shipStats(content, ship).cleanBottom;
  const gold = Math.ceil(shipStats(content, ship).hullMax * content.economy.fouling.careenGoldPerHull);
  const foul = !copper && fouling >= 0.01;
  const purse = state.captain?.gold ?? 0;
  return (
    <>
      <div class="yard-row">
        <Art id="ui.icon.full_sail" class="inline-icon" />
        <div class="yard-row-what">
          <b>Careen her</b> ·{' '}
          {copper
            ? 'copper-sheathed: her bottom stays clean'
            : !foul
              ? 'her bottom is clean'
              : `weed and worm cost her ${Math.round(fouling * 100)}% of her speed`}
          {foul && hamlet ? <div class="k-sub">No yard in a hamlet can careen her: a town's or city's can.</div> : null}
          {foul && !hamlet && purse < gold ? <div class="k-sub">You have {purse.toLocaleString()} gold.</div> : null}
        </div>
        {foul && !hamlet ? (
          <button class="k-btn" disabled={purse < gold} onClick={() => send({ type: 'Careen', shipId })}>
            Careen · {gold.toLocaleString()} gold
          </button>
        ) : (
          <span class="k-tag peace">clean</span>
        )}
      </div>
      {copper ? null : (
        <div class="k-sub">
          Or heave her down on a beach yourself: <Key k="K" /> at sea near a shore, {content.economy.fouling.beachDays} days, free.
        </div>
      )}
    </>
  );
}

/** Fitting out the flagship: her guns, and the yard's improvements. */
function UpgradeYard({ content, state, town, shipId, send, only }: { content: ContentPack; state: WorldState; town: PlacedSettlement; shipId: string; send: PortProps['send']; only?: string }) {
  // The ship being fitted: the flagship, or `only`, one of the fleet.
  const ship = (only && fleetOf(state).find((f) => f.id === only)) || state.ships[shipId]!;
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
      <div class="yard-row yard-guns">
        <Art id="ui.icon.cannon_loaded" class="yard-guns-icon" />
        <div class="yard-row-what">
          <b>
            Guns {stats.guns} of {stats.maxGuns}
          </b>{' '}
          <span class="k-sub">
            · {room > 0 ? `a full battery fires ${Math.floor(stats.maxGuns / 2)} a side: ${room} more to fill her deck` : 'a full battery'}
          </span>
          {sellsGuns(town) && room > 1 && gold >= p.gunGold && gold < room * p.gunGold ? (
            <div class="k-sub">Your purse buys {Math.floor(gold / p.gunGold)} of them now.</div>
          ) : null}
        </div>
        {sellsGuns(town) ? (
          <>
            <button class="k-btn small" disabled={room <= 0 || gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: 1, only })}>
              Buy 1 · {p.gunGold} gold
            </button>
            {room > 1 ? (
              <button class="k-btn small primary" disabled={gold < p.gunGold} onClick={() => send({ type: 'BuyGuns', shipId, count: room, only })}>
                Fill the gun deck · {(room * p.gunGold).toLocaleString()} gold
              </button>
            ) : null}
            <button class="k-btn small ghost" disabled={stats.guns <= 0} onClick={() => send({ type: 'SellGuns', shipId, count: 1, only })}>
              Sell 1 · {p.gunSellGold} gold
            </button>
          </>
        ) : (
          <span class="port-sub">No cannon for sale in a hamlet.</span>
        )}
      </div>
      {cut < 1 ? <div class="k-sub">Your rank here: every fit {Math.round((1 - cut) * 100)}% off.</div> : null}
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
              </div>
              {installed.has(u.id) ? (
                <span class="k-tag gold">installed</span>
              ) : only && u.modifiers.spoilsDays ? (
                <span class="fit-why">Only the flagship fights: it goes on her.</span>
              ) : sellsUpgrade(content, town, u.id, best) ? (
                <>
                  <button class="k-btn small primary" disabled={gold < cost.price} onClick={() => send({ type: 'BuyUpgrade', shipId, upgradeId: u.id, only })}>
                    Buy · {cost.price.toLocaleString()} gold
                  </button>
                  {gold < cost.price ? <span class="fit-why">You have {gold.toLocaleString()} gold.</span> : null}
                </>
              ) : (
                <span class="fit-why">{(u.sizes ?? []).includes('town') ? "Fitted only at a town's or city's yard." : "Fitted only at a city's yard."}</span>
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
  // A cove she hasn't found isn't named.
  const haven = (id?: string) => {
    const s = settlements.find((x) => x.id === id);
    return s && !havenKnown(content, state, s) ? 'a cove you have not found' : (s?.name ?? id);
  };
  const f = famesOf(content, state);
  const pieces = state.captain?.mapPieces ?? {};
  const jailed = new Set((state.captain?.deeds ?? []).flatMap((d) => (d.captive ? [d.captive] : [])));
  // The ten, and the captain at her place below them while she is not one of them.
  const rows = place > 10 ? [...ranks.slice(0, 10), ranks[place - 1]!] : ranks.slice(0, 10);
  // The port nearest a ship (where one lying in port lies).
  const nearest = (x: number, y: number) => [...settlements].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]?.name;
  const me = Object.values(state.ships).find((s) => !s.ai);
  /** At sea, or in port and where: whether she can be gone after now. */
  const whereabouts = (r: (typeof ranks)[number]) => {
    const ship = Object.values(state.ships).find((s) => s.ai?.famous === r.id);
    if (!ship) return `sails from ${haven(r.haven)}`;
    return inPort(ship) ? `in port at ${nearest(ship.x, ship.y)}` : `at sea from ${haven(r.haven)}`;
  };
  const status = (r: (typeof ranks)[number]) => {
    if (r.player) return me?.docked ? `in port at ${settlements.find((s) => s.id === me.docked)?.name ?? me.docked}` : 'at sea';
    const months = r.returnAt ? Math.max(1, Math.ceil((r.returnAt - state.tick) / tpd / 30)) : 0;
    const beaten = state.famous?.[r.id!]?.defeats ?? 0;
    const doing = jailed.has(r.id!)
      ? 'your prisoner, for a governor'
      : state.famous?.[r.id!]?.revenge
        ? state.famous?.[r.id!]?.sworn && !state.famous?.[r.id!]?.hoard?.found
          ? 'hunting you, for your fame'
          : 'hunting you, for his hoard'
        : r.returnAt
          ? `beaten; back in about ${months} month${months === 1 ? '' : 's'}`
          : whereabouts(r);
    const held = pieces[r.id!] ? ` · you hold ${pieces[r.id!]} of ${content.pirates.rules.mapPieces} pieces of his map` : '';
    return `${doing}${beaten && !r.returnAt ? ` · beaten by you ${beaten === 1 ? 'once' : `${beaten} times`}` : ''}${held}`;
  };
  return (
    <div class="top-ten">
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
          {/* First, so it stays put however many other replies a telling has. */}
          {tellings.length > 1 ? (
            <button class="k-btn small tavern-next" onClick={() => setK((k + 1) % tellings.length)}>
              {k + 1 < tellings.length ? 'Anything else?' : 'From the start'}
            </button>
          ) : null}
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
      <div class="tavern-subs">
        <Recruit content={content} state={state} shipId={shipId} send={send} port={here} />
        <CrewPay content={content} state={state} shipId={shipId} send={send} />
      </div>
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
