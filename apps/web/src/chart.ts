import type { KnownPrices, Ship, Sighting } from '@corsair/core';
import { Tile } from '@corsair/data';
import type { PlacedSettlement, TileMap } from '@corsair/data';
import { ART } from './ui-art';

// The map at one pixel per tile, palette colours shaded by elevation. The minimap crops it and
// the sea chart (PRD S2) shows it whole; neither needs new art.
const TILE_RGB: Record<Tile, [number, number, number]> = {
  [Tile.Deep]: [37, 58, 94],
  [Tile.Shallow]: [79, 143, 186],
  [Tile.Beach]: [215, 181, 148],
  [Tile.Jungle]: [70, 130, 50],
  [Tile.Hills]: [117, 167, 67],
  [Tile.Mountain]: [129, 151, 150],
};
const RELIEF_PER_BAND = 14; // brightness change per elevation band of slope, lit from the north-west

const MINIMAP_TILES = { w: 240, h: 135 };
/** How long a sighted ship's marker lingers on the chart, in game days. */
const SIGHTING_DAYS = 3;

const NATION_NAME: Record<PlacedSettlement['nation'], string> = {
  spain: 'Spanish',
  england: 'English',
  france: 'French',
  netherlands: 'Dutch',
  pirate: 'pirate',
};

const NATION_COLOURS: Record<PlacedSettlement['nation'], string> = {
  spain: '#e8c170',
  england: '#cf573c',
  france: '#73bed3',
  netherlands: '#de9e41',
  pirate: '#090a14',
};

// Label placement order: capitals, then cities, towns, hamlets. The first to claim a spot keeps it.
const RANK = { capital: 0, city: 1, town: 2, hamlet: 3 } as const;
const PLACEMENTS = ['right', 'left', 'above', 'below'] as const;

/**
 * Greedy label placement: try each side of the port's dot and keep the first spot that overlaps
 * no earlier label and no other port's dot. A town or hamlet name that fits nowhere is hidden;
 * its dot still shows it on hover.
 */
function layoutLabels(pins: { s: PlacedSettlement; dot: HTMLElement; label: HTMLElement }[], sheet: DOMRect) {
  const rank = (s: PlacedSettlement) => (s.type === 'capital' ? RANK.capital : RANK[s.size]);
  // Dots are obstacles too, so a name never hides another port.
  const dots = new Map(pins.map((p) => [p.s.id, p.dot.getBoundingClientRect()]));
  const labels: DOMRect[] = [];
  const hit = (r: DOMRect, o: DOMRect) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
  for (const { s, label } of [...pins].sort((a, b) => rank(a.s) - rank(b.s))) {
    label.hidden = false;
    // A name stays on the chart: one that would run off its edge (under the planner) tries another side.
    const inside = (r: DOMRect) => r.left >= sheet.left && r.right <= sheet.right && r.top >= sheet.top && r.bottom <= sheet.bottom;
    const clear = (r: DOMRect) => inside(r) && !labels.some((o) => hit(r, o)) && ![...dots].some(([id, o]) => id !== s.id && hit(r, o));
    const spot = PLACEMENTS.find((where) => {
      label.dataset.place = where;
      return clear(label.getBoundingClientRect());
    });
    // Capitals and cities always keep their name, on the right if nothing is clear.
    if (!spot && rank(s) > RANK.city) {
      label.hidden = true;
      continue;
    }
    // Crowded out: take a side that at least stays on the chart.
    if (!spot) {
      label.dataset.place = PLACEMENTS.find((where) => {
        label.dataset.place = where;
        return inside(label.getBoundingClientRect());
      }) ?? 'right';
    }
    labels.push(label.getBoundingClientRect());
  }
}

function paintOverview(map: TileMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(map.width, map.height);
  const h = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : (map.elevation[y * map.width + x] ?? 0);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const [r, g, b] = TILE_RGB[map.tiles[i]! as Tile];
      const shade = (h(x + 1, y + 1) - h(x - 1, y - 1)) * RELIEF_PER_BAND;
      image.data[i * 4] = r + shade;
      image.data[i * 4 + 1] = g + shade;
      image.data[i * 4 + 2] = b + shade;
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** What the captain knows of each port's market. */
export interface ChartMarket {
  goods: { id: string; name: string; staple?: boolean }[];
  known: (settlementId: string) => KnownPrices | undefined;
  /** Whether a port makes or needs a good: common knowledge, known before any visit. */
  lean: (settlementId: string, good: string) => 'exports' | 'wants' | undefined;
  /** Rumours the captain has heard about a port, as text with their age. */
  rumours: (settlementId: string) => string[];
  today: () => number;
  /** The wars between nations now, as pairs of names ("England", "Spain"). */
  wars: () => [string, string][];
  /** Pirates' interest in a port halves this far from their haven: the chart shades pirate waters by it. */
  pirateRangeTiles: number;
  /** Whether a port would deal with the captain, in a line (or nothing when it simply would). */
  welcome: (settlementId: string) => string | undefined;
  /** A port's people and trend, in a few words. */
  people: (settlementId: string) => string;
  /** The voyages worth sailing from where the captain is: trades priced from what she has seen, and leads. */
  plan: () => VoyagePlan;
}

/** A trade from what the captain has seen: buy at `from`, sell at `to`. */
export interface PlannedTrade {
  good: string;
  from: PlacedSettlement;
  to: PlacedSettlement;
  buy: number;
  sell: number;
  /** About what a full hold makes, the price falling as she sells. */
  profit: number;
  /** Days to sail there from here, then on to sell. */
  daysToStart: number;
  days: number;
  /** Pirate waters along the way. */
  risk: 'low' | 'some' | 'high';
}
/** A governor's contract the captain has heard of: land `units` of a good at `to` for the reward. */
export interface PlannedContract {
  good: string;
  to: PlacedSettlement;
  /** Where to buy the goods (the cheapest she knows, else the nearest port that makes them). */
  from?: PlacedSettlement;
  /** Her hold has them already: sail straight there. */
  inHold: boolean;
  units: number;
  delivered: number;
  reward: number;
  /** Days to sail (by way of `from`) to the town, and the days the offer has left. */
  days: number;
  daysLeft: number;
}
export interface VoyagePlan {
  contracts: PlannedContract[];
  trades: PlannedTrade[];
  /** Made at `from` and needed at `to`, but prices not yet seen at one end or the other. */
  leads: Omit<PlannedTrade, 'buy' | 'sell' | 'profit'>[];
}



/** `onSelect` gets the port clicked on the chart, or undefined when the chosen port is clicked again. */
export function createCharts(
  parent: HTMLElement,
  map: TileMap,
  settlements: PlacedSettlement[],
  onSelect: (port: PlacedSettlement | undefined) => void,
  market: ChartMarket,
) {
  let selected: PlacedSettlement | undefined;
  const overview = paintOverview(map);

  const minimap = parent.appendChild(document.createElement('canvas'));
  minimap.className = 'minimap';
  minimap.width = MINIMAP_TILES.w;
  minimap.height = MINIMAP_TILES.h;
  const mctx = minimap.getContext('2d')!;
  mctx.imageSmoothingEnabled = false;

  const chart = parent.appendChild(document.createElement('div'));
  chart.className = 'chart';
  chart.hidden = true;
  const sheet = chart.appendChild(document.createElement('div'));
  sheet.className = 'chart-sheet';
  sheet.style.aspectRatio = `${map.width} / ${map.height}`;
  sheet.appendChild(overview);
  // Pirate waters: a faint red about each haven, fading out where pirates' interest has halved (in a
  // layer of their own, clipped to the sheet).
  const watersLayer = sheet.appendChild(document.createElement('div'));
  watersLayer.className = 'chart-waters-layer';
  for (const h of settlements.filter((s) => s.nation === 'pirate')) {
    const waters = watersLayer.appendChild(document.createElement('div'));
    waters.className = 'chart-waters';
    waters.style.left = `${(h.x / map.width) * 100}%`;
    waters.style.top = `${(h.y / map.height) * 100}%`;
    waters.style.width = `${((2 * market.pirateRangeTiles) / map.width) * 100}%`;
  }
  // Every port gets a dot; its name is placed later by layoutLabels, which needs the chart visible.
  const pins = settlements.map((s) => {
    // A port is a square in its nation's colour (painted towns read poorly at chart size).
    const dot = sheet.appendChild(document.createElement('div'));
    dot.className = `chart-dot label-${s.nation}`;
    dot.title = s.name;
    // Where marks overlap, the bigger port lies on top (a hamlet's never hides a capital or a haven).
    dot.style.zIndex = String(4 - (s.type === 'capital' ? RANK.capital : s.nation === 'pirate' ? RANK.city : RANK[s.size]));
    const label = sheet.appendChild(document.createElement('div'));
    label.className = `chart-port label-${s.nation}`;
    label.textContent = s.name;
    for (const el of [dot, label]) {
      el.style.left = `${(s.x / map.width) * 100}%`;
      el.style.top = `${(s.y / map.height) * 100}%`;
    }
    const choose = () => {
      selected = selected?.id === s.id ? undefined : s;
      for (const p of pins) p.label.classList.toggle('selected', p.s.id === selected?.id);
      onSelect(selected);
    };
    dot.addEventListener('click', choose);
    label.addEventListener('click', choose);
    for (const el of [dot, label]) {
      el.addEventListener('pointerenter', () => showPrices(s));
      el.addEventListener('pointerleave', () => (prices.hidden = true));
    }
    return { s, dot, label };
  });
  // Hovering a port shows what its merchant charged when the captain last called (PRD section 6).
  const prices = sheet.appendChild(document.createElement('div'));
  prices.className = 'chart-prices';
  prices.hidden = true;
  const showPrices = (s: PlacedSettlement) => {
    const known = market.known(s.id);
    const age = known && market.today() - known.day;
    const when = age === undefined ? '' : age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
    const kind = s.nation === 'pirate' ? 'pirate haven' : `${NATION_NAME[s.nation]} ${s.type === 'capital' ? 'capital' : s.size}`;
    const makes = market.goods.filter((g) => market.lean(s.id, g.id) === 'exports').map((g) => g.name);
    const needs = market.goods.filter((g) => market.lean(s.id, g.id) === 'wants').map((g) => g.name);
    const welcome = market.welcome(s.id);
    const head =
      `<div class="chart-prices-name">${s.name}</div><div class="chart-prices-age">${kind} · ${market.people(s.id)}</div>` +
      (makes.length ? `<div class="chart-prices-trade"><span class="lean-exports">▲ makes</span> ${makes.join(', ')}</div>` : '') +
      (needs.length ? `<div class="chart-prices-trade"><span class="lean-wants">▼ needs</span> ${needs.join(', ')}</div>` : '') +
      (welcome ? `<div class="chart-prices-warn">${welcome}</div>` : '');
    prices.innerHTML = known
      ? `${head}<div class="chart-prices-age">Prices seen ${when}</div><table><tr><th></th><th>Buy</th><th>Sell</th><th title="Units it took before its sell price fell a quarter">Takes</th></tr>${market.goods
          .map((g) => {
            const p = known.prices[g.id];
            const depth = p?.depth === undefined ? '' : `<span class="takes${p.depth < 15 ? ' shallow' : ''}">${p.depth >= 999 ? '999+' : `~${p.depth}`}</span>`;
            return `<tr><td>${g.name}</td><td>${p?.buy ?? ''}</td><td>${p?.sell ?? ''}</td><td>${depth}</td></tr>`;
          })
          .join('')}</table>`
      : `${head}<div class="chart-prices-age">Prices unknown: call here to learn them</div>`;
    // Rumours heard about this port, so news can be acted on from the chart.
    const rumours = market.rumours(s.id);
    if (rumours.length) prices.innerHTML += rumours.map((r) => `<div class="chart-rumour">${r}</div>`).join('');
    prices.style.left = `${(s.x / map.width) * 100}%`;
    prices.style.top = `${(s.y / map.height) * 100}%`;
    // Open towards the middle of the chart so the card never runs off an edge.
    prices.dataset.side = `${s.x > map.width / 2 ? 'left' : 'right'} ${s.y > map.height / 2 ? 'up' : 'down'}`;
    prices.hidden = false;
  };
  // Ships the lookouts have seen, fading as the sighting ages (PRD section 3: last-known markers).
  const sighted = sheet.appendChild(document.createElement('div'));
  sighted.className = 'chart-ships';
  const marker = sheet.appendChild(document.createElement('img'));
  marker.className = 'chart-player';
  marker.src = ART['ui.chart.you'] ?? '';
  marker.alt = '';
  marker.title = 'You';
  // A compass rose in the corner, as on any chart.
  const rose = sheet.appendChild(document.createElement('img'));
  rose.className = 'chart-rose';
  rose.src = ART['ui.chart.compass'] ?? '';
  rose.alt = '';
  const hint = chart.appendChild(document.createElement('div'));
  hint.className = 'chart-hint';
  hint.textContent = 'Sea chart · time stands still while you study it · click a port to set your destination · M to close';
  // The key: what every mark on the chart means, and who is at war (it decides who trades with you and who hunts you).
  const key = chart.appendChild(document.createElement('div'));
  key.className = 'chart-key';
  const NATION_KEY: [string, string][] = [
    ['spain', 'Spain'],
    ['england', 'England'],
    ['france', 'France'],
    ['netherlands', 'the Netherlands'],
  ];
  // The voyage planner: the trades worth sailing from here, best gold for the days first, and leads to
  // look into. Choosing one sets the course to where the buying is.
  const planner = chart.appendChild(document.createElement('div'));
  planner.className = 'chart-plan';
  const choosePort = (id: string) => {
    const pin = pins.find((p) => p.s.id === id);
    if (!pin) return;
    selected = pin.s;
    for (const p of pins) p.label.classList.toggle('selected', p.s.id === selected.id);
    onSelect(selected);
  };
  const goodName = (id: string) => market.goods.find((g) => g.id === id)?.name ?? id;
  const days = (d: number) => (d < 1 ? 'under a day' : `${Math.round(d)} ${Math.round(d) === 1 ? 'day' : 'days'}`);
  const showPlan = () => {
    const plan = market.plan();
    const rows = plan.trades
      .map(
        (t) =>
          `<button class="chart-plan-row" data-port="${t.from.id}" title="Sets your course to ${t.from.name}">${keyMark(`ui.icon.good.${t.good}`)}<span><b>${goodName(t.good)}</b>: buy at ${t.from.name} (${t.buy}), sell at ${t.to.name} (${t.sell})<br><span class="gain">about +${t.profit.toLocaleString()} gold a hold</span> · ${days(t.daysToStart + t.days)} · <span class="risk-${t.risk}">pirates ${t.risk}</span></span></button>`,
      )
      .join('');
    const contracts = plan.contracts
      .map((c) => {
        const port = c.from ?? c.to;
        const late = c.days > c.daysLeft;
        return `<button class="chart-plan-row" data-port="${port.id}" title="Sets your course to ${port.name}">${keyMark(`ui.icon.good.${c.good}`)}<span><b>${c.units - c.delivered} ${goodName(c.good).toLowerCase()} for ${c.to.name}</b>${c.inHold ? ': in your hold' : c.from ? `: buy at ${c.from.name}` : ''}<br><span class="gain">${c.reward.toLocaleString()} gold reward</span> · ${days(c.days)} · <span class="${late ? 'risk-high' : 'risk-low'}">${days(c.daysLeft)} left${late ? ': too far' : ''}</span></span></button>`;
      })
      .join('');
    const leads = plan.leads
      .map(
        (t) =>
          `<button class="chart-plan-row lead" data-port="${t.from.id}" title="Sets your course to ${t.from.name}">${keyMark(`ui.icon.good.${t.good}`)}<span><b>${goodName(t.good)}</b>: made at ${t.from.name}, needed at ${t.to.name}<br>${days(t.daysToStart + t.days)} · <span class="risk-${t.risk}">pirates ${t.risk}</span> · call to learn the prices</span></button>`,
      )
      .join('');
    planner.innerHTML =
      (contracts ? `<div class="chart-plan-head">Contracts you have heard of</div>${contracts}` : '') +
      '<div class="chart-plan-head">Voyages from here</div>' +
      (rows || '<div class="chart-plan-empty">No trade you know of pays yet: call at more ports to learn their prices.</div>') +
      (leads ? `<div class="chart-plan-head">Worth a look</div>${leads}` : '') +
      '<div class="chart-plan-foot">Click one to set your course to where you buy; F follows it.</div>';
    for (const b of planner.querySelectorAll<HTMLButtonElement>('[data-port]')) b.addEventListener('click', () => choosePort(b.dataset.port!));
  };
  /** A painted mark in the key, or nothing if the art isn't there. */
  const keyMark = (id: string) => (ART[id] ? `<img class="chart-key-mark" src="${ART[id]}" alt="">` : '');
  const showKey = () => {
    const wars = market.wars();
    key.innerHTML =
      '<span class="chart-key-item">ports:</span>' +
      NATION_KEY.map(([id, name]) => `<span class="chart-key-item"><span class="chart-key-dot label-${id}"></span>${name}</span>`).join('') +
      '<span class="chart-key-item"><span class="chart-key-dot label-pirate"></span>pirate haven, in <span class="chart-key-waters"></span> pirate waters</span>' +
      `<span class="chart-key-item">${keyMark('ui.chart.you')}you</span>` +
      '<span class="chart-key-item"><span class="chart-key-ship"></span>a ship seen (fades over days)</span>' +
      `<div class="chart-key-wars">${wars.length ? `At war: ${wars.map(([a, b]) => `${a} and ${b}`).join(' · ')}` : 'All nations at peace'} · pirates are at war with everyone</div>`;
  };

  // Goods filter: pick a good and every port shows whether it makes or needs it (common knowledge)
  // and, where the captain has called, the price that matters there: what you'd pay where it's
  // made, what you'd get everywhere else.
  let good: string | undefined;
  const filter = chart.insertBefore(document.createElement('div'), sheet);
  filter.className = 'chart-goods';
  // Staples (food) are never worth carrying, so they have no filter.
  const goodButtons = market.goods.filter((g) => !g.staple).map((g) => {
    const b = filter.appendChild(document.createElement('button'));
    b.textContent = g.name;
    b.addEventListener('click', () => {
      good = good === g.id ? undefined : g.id;
      showGood();
    });
    return { id: g.id, b };
  });
  const legend = filter.appendChild(document.createElement('span'));
  legend.className = 'chart-legend';
  legend.innerHTML =
    '<span class="lean-exports">▲ green</span>: made there, the price to buy · <span class="lean-wants">▼ pink</span>: needed there, the price to sell';
  const showGood = () => {
    for (const { id, b } of goodButtons) b.classList.toggle('active', id === good);
    legend.hidden = !good;
    for (const { s, label } of pins) {
      const lean = good ? market.lean(s.id, good) : undefined;
      const seen = good ? market.known(s.id)?.prices[good] : undefined;
      const price = seen && (lean === 'exports' ? seen.buy : seen.sell);
      const mark = lean === 'exports' ? '▲ ' : lean === 'wants' ? '▼ ' : '';
      label.textContent = `${mark}${s.name}${price !== undefined ? ` ${price}` : ''}`;
      label.classList.toggle('lean-exports', lean === 'exports');
      label.classList.toggle('lean-wants', lean === 'wants');
      label.classList.toggle('faded', Boolean(good) && !lean);
    }
    layoutLabels(pins, sheet.getBoundingClientRect());
  };

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') {
      chart.hidden = !chart.hidden;
      // A card left from the last look would show stale prices until the pointer moved.
      prices.hidden = true;
      // Prices may have been learned since the chart was last open.
      if (!chart.hidden) {
        showGood();
        showKey();
        showPlan();
      }
    }
    if (e.key === 'Escape') chart.hidden = true;
  });

  return {
    /** The chart is open: the world waits while the captain studies it. */
    get open() {
      return !chart.hidden;
    },
    /** Forget the destination (made port): no port highlighted. */
    clearDestination() {
      selected = undefined;
      for (const p of pins) p.label.classList.remove('selected');
    },
    /** `camera` is the top-left of the view in world pixels. */
    update(
      player: Ship | undefined,
      camera: { x: number; y: number },
      view: { width: number; height: number },
      seen?: { sightings: Record<string, Sighting>; tick: number; ticksPerDay: number },
    ) {
      if (!player) return;
      // Minimap: a window on the overview centred on the ship, clamped to the map.
      const sx = Math.max(0, Math.min(map.width - MINIMAP_TILES.w, Math.round(player.x - MINIMAP_TILES.w / 2)));
      const sy = Math.max(0, Math.min(map.height - MINIMAP_TILES.h, Math.round(player.y - MINIMAP_TILES.h / 2)));
      mctx.drawImage(overview, sx, sy, MINIMAP_TILES.w, MINIMAP_TILES.h, 0, 0, MINIMAP_TILES.w, MINIMAP_TILES.h);
      for (const s of settlements) {
        mctx.fillStyle = NATION_COLOURS[s.nation];
        mctx.fillRect(Math.floor(s.x - sx) - 1, Math.floor(s.y - sy) - 1, 3, 3);
      }
      const vw = view.width / map.tileSize;
      const vh = view.height / map.tileSize;
      mctx.strokeStyle = '#ebede9';
      const vx = camera.x / map.tileSize - sx;
      const vy = camera.y / map.tileSize - sy;
      mctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, vw, vh);
      if (selected) {
        mctx.strokeStyle = '#e8c170';
        mctx.strokeRect(Math.floor(selected.x - sx) - 3.5, Math.floor(selected.y - sy) - 3.5, 8, 8);
      }
      mctx.fillStyle = '#e8c170';
      mctx.fillRect(Math.round(player.x - sx) - 1, Math.round(player.y - sy) - 1, 3, 3);

      // A sighting fades out over SIGHTING_DAYS; one seen this tick is solid.
      const marks = Object.values(seen?.sightings ?? {})
        .map((s) => ({ s, fade: 1 - (seen!.tick - s.tick) / (seen!.ticksPerDay * SIGHTING_DAYS) }))
        .filter((m) => m.fade > 0);
      for (const { s, fade } of marks) {
        mctx.globalAlpha = fade;
        mctx.fillStyle = NATION_COLOURS[s.nation];
        mctx.fillRect(Math.round(s.x - sx) - 1, Math.round(s.y - sy) - 1, 2, 2);
      }
      mctx.globalAlpha = 1;

      if (!chart.hidden) {
        marker.style.left = `${(player.x / map.width) * 100}%`;
        marker.style.top = `${(player.y / map.height) * 100}%`;
        marker.style.transform = `translate(-50%, -50%) rotate(${player.headingDeg}deg)`;
        sighted.innerHTML = marks
          .map(
            ({ s, fade }) =>
              `<div class="chart-ship label-${s.nation}" title="A ${s.nation === 'pirate' ? 'pirate' : s.nation} ship, seen ${Math.max(0, Math.floor((seen!.tick - s.tick) / seen!.ticksPerDay))} days ago" style="left:${(s.x / map.width) * 100}%;top:${(s.y / map.height) * 100}%;opacity:${fade.toFixed(2)}"></div>`,
          )
          .join('');
      }
    },
  };
}
