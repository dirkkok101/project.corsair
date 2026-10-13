import type { KnownPrices, Ship, Sighting } from '@corsair/core';
import { Tile } from '@corsair/data';
import type { PlacedSettlement, TileMap } from '@corsair/data';
import { ART } from './ui-art';

// The minimap (storyboard 4.1): a corner of the parchment chart around her, at a little over a pixel a tile.
const MINIMAP_TILES = { w: 160, h: 94 };
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
  // With a good picked, the ports it marks are placed first, and a faded port's name gives way rather than crowd them.
  const faded = (l: HTMLElement) => (l.classList.contains('faded') ? 1 : 0);
  for (const { s, label } of [...pins].sort((a, b) => faded(a.label) - faded(b.label) || rank(a.s) - rank(b.s))) {
    label.hidden = false;
    // A name stays on the chart: one that would run off its edge (under the planner) tries another side.
    const inside = (r: DOMRect) => r.left >= sheet.left && r.right <= sheet.right && r.top >= sheet.top && r.bottom <= sheet.bottom;
    const clear = (r: DOMRect) => inside(r) && !labels.some((o) => hit(r, o)) && ![...dots].some(([id, o]) => id !== s.id && hit(r, o));
    const find = () =>
      PLACEMENTS.find((where) => {
        label.dataset.place = where;
        return clear(label.getBoundingClientRect());
      });
    label.classList.remove('stacked');
    let spot = find();
    // A name with a tag that finds no room tries the tag beneath the name: narrower, it fits more gaps.
    if (!spot && label.querySelector('.chart-mark')) {
      label.classList.add('stacked');
      spot = find();
      if (!spot) label.classList.remove('stacked');
    }
    // Capitals and cities always keep their name, on the right if nothing is clear.
    if (!spot && (rank(s) > RANK.city || faded(label))) {
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

/** The chart's inks on parchment (storyboard 4.4): pale sea, shallows a shade darker, tan land darkening uphill, an ink coast. */
const PAPER = { sea: [230, 211, 168], shallow: [219, 196, 150], land: [190, 152, 98], hills: [172, 135, 84], mountain: [146, 113, 70], coast: [94, 64, 36] } as const;

/** The map drawn as an old chart: parchment with a grain, the land washed in, the coast inked. */
function paintParchment(map: TileMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(map.width, map.height);
  const land = (x: number, y: number) => {
    const t = map.tiles[y * map.width + x] as Tile;
    return x >= 0 && y >= 0 && x < map.width && y < map.height && t !== Tile.Deep && t !== Tile.Shallow;
  };
  const h = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : (map.elevation[y * map.width + x] ?? 0));
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const t = map.tiles[i]! as Tile;
      const here = land(x, y);
      const coast = here && (!land(x + 1, y) || !land(x - 1, y) || !land(x, y + 1) || !land(x, y - 1));
      const ink =
        coast ? PAPER.coast : !here ? (t === Tile.Shallow ? PAPER.shallow : PAPER.sea) : t === Tile.Mountain ? PAPER.mountain : t === Tile.Hills ? PAPER.hills : PAPER.land;
      // The paper's grain (a fixed hash, so it never shimmers) and, on land, the hills lit from the north-west.
      const grain = (((x * 73856093) ^ (y * 19349663)) & 15) - 7;
      const shade = here && !coast ? (h(x + 1, y + 1) - h(x - 1, y - 1)) * 8 : 0;
      image.data[i * 4] = ink[0] + grain + shade;
      image.data[i * 4 + 1] = ink[1] + grain + shade;
      image.data[i * 4 + 2] = ink[2] + grain * 0.8 + shade;
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** One line on a port's card: what it means for you, good or bad, and how old the knowing is. */
export interface CardLine {
  text: string;
  tone?: 'good' | 'bad';
  age?: string;
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
  /** A port's card: its harbour painting, about how many days' sail, and what it means for you, a line each. */
  card: (settlementId: string) => { painting?: string; days?: number; lines: CardLine[] };
  /** The course by the lanes from where she is to a port, to show before it is set. */
  route: (settlementId: string) => [number, number][] | undefined;
  /** Whether a port is closed to her flag (at war): drawn faded in red ink, its mark struck through. */
  closed: (settlementId: string) => boolean;
  /** The one thing a port has for you, shown by its name (plague, a good price for your hold), if any. */
  mark: (settlementId: string) => string | undefined;
  /** The wind now at a spot on the map: where it blows from, in degrees, and how hard. */
  wind: (x: number, y: number) => { fromDeg: number; strength: string };
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
  /** Pirate waters along the way, and the haven whose waters they are. */
  risk: 'low' | 'some' | 'high';
  haven: string;
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
  const paper = paintParchment(map);

  const minimap = parent.appendChild(document.createElement('canvas'));
  minimap.className = 'minimap';
  minimap.width = MINIMAP_TILES.w;
  minimap.height = MINIMAP_TILES.h;
  const mctx = minimap.getContext('2d')!;

  const chart = parent.appendChild(document.createElement('div'));
  chart.className = 'chart';
  chart.hidden = true;
  const sheet = chart.appendChild(document.createElement('div'));
  sheet.className = 'chart-sheet';
  sheet.style.aspectRatio = `${map.width} / ${map.height}`;
  sheet.appendChild(paper);
  // The course (dashed, in red ink) and the wind's arrows, drawn over the parchment.
  const ink = sheet.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  ink.setAttribute('class', 'chart-ink');
  ink.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
  ink.setAttribute('preserveAspectRatio', 'none');
  const winds = ink.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  winds.setAttribute('class', 'chart-winds');
  const course = ink.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
  course.setAttribute('class', 'chart-course');
  // The way to a port picked but not yet set as the course, in fainter ink.
  const preview = ink.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
  preview.setAttribute('class', 'chart-preview');
  let courseDrawn = '';
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
    // A click picks the port: ringed, the way there drawn, her card beside the chart; a double click sets course.
    for (const el of [dot, label]) {
      el.addEventListener('click', () => showCard(s));
      el.addEventListener('dblclick', () => (choosePort(s.id), showCard(s)));
    }
    // A name hidden to keep the crowded islands legible shows while the pointer is on its port.
    dot.addEventListener('mouseenter', () => {
      if (!label.hidden) return;
      hover.textContent = s.name;
      hover.style.left = dot.style.left;
      hover.style.top = dot.style.top;
      hover.hidden = false;
    });
    dot.addEventListener('mouseleave', () => (hover.hidden = true));
    return { s, dot, label };
  });
  const hover = sheet.appendChild(document.createElement('div'));
  hover.className = 'chart-hover-name';
  hover.hidden = true;
  // How far the picked port is, by it on the chart.
  const far = sheet.appendChild(document.createElement('div'));
  far.className = 'chart-days';
  far.hidden = true;
  // A port's card (storyboard 4.4): beside the chart in the voyages' place, so the chart stays clear: her harbour in
  // miniature, how far, what she means for you in a few lines with their age, the talk about her, every price seen
  // there folded away, and Set course.
  const card = chart.appendChild(document.createElement('div'));
  card.className = 'chart-card k-wood';
  card.hidden = true;
  // A click on the bare chart puts the card away.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || (e.target as Element).tagName === 'CANVAS') hideCard();
  });
  /** Back to the voyages: no port picked. */
  const hideCard = () => {
    card.hidden = true;
    planner.hidden = false;
    far.hidden = true;
    preview.setAttribute('points', '');
    cardPort = undefined;
    for (const p of pins) {
      p.dot.classList.remove('picked');
      p.label.classList.remove('picked');
    }
  };
  const showCard = (s: PlacedSettlement) => {
    const known = market.known(s.id);
    const age = known && market.today() - known.day;
    const when = age === undefined ? '' : age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
    const kind = s.nation === 'pirate' ? 'Pirate haven' : `${NATION_NAME[s.nation]} ${s.type === 'capital' ? 'capital' : s.size}`;
    const about = market.card(s.id);
    const sail = about.days === undefined ? '' : about.days < 0.5 ? 'here' : about.days < 1.5 ? 'a day' : `${Math.round(about.days)} days`;
    const welcome = market.welcome(s.id);
    const lines = [...about.lines, ...(welcome ? [{ text: welcome, tone: 'bad' as const }] : [])];
    const rumours = market.rumours(s.id);
    card.innerHTML =
      `<div class="chart-card-head">${about.painting ? `<img class="chart-card-art" src="${about.painting}" alt="">` : ''}<div><div class="chart-card-name">${s.name}</div><div class="k-sub">${kind} · ${market.people(s.id)}${sail && sail !== 'here' ? ` · ${sail} by the lanes` : sail ? ' · here' : ''}</div></div></div>` +
      `<div class="chart-card-lines">${lines.map((l) => `<div class="${l.tone ?? ''}">${l.text}${l.age ? ` <span class="k-sub">(${l.age})</span>` : ''}</div>`).join('')}</div>` +
      rumours.map((r) => `<div class="chart-rumour">${r}</div>`).join('') +
      (known
        ? `<details class="chart-card-prices"><summary>All prices, seen ${when}</summary><table><tr><th></th><th>Buy</th><th>Sell</th><th title="Units it took before its sell price fell a quarter">Takes</th></tr>${market.goods
            .map((g) => {
              const p = known.prices[g.id];
              const depth = p?.depth === undefined ? '' : `<span class="takes${p.depth < 15 ? ' shallow' : ''}">${p.depth >= 999 ? '999+' : `~${p.depth}`}</span>`;
              return `<tr><td>${g.name}</td><td>${p?.buy ?? ''}</td><td>${p?.sell ?? ''}</td><td>${depth}</td></tr>`;
            })
            .join('')}</table></details>`
        : '<div class="k-sub">Prices unknown: call here to learn them</div>') +
      (selected?.id === s.id
        ? '<div class="chart-card-actions"><div class="chart-card-set">Your course · <kbd class="k-key">F</kbd> follows it</div></div>'
        : '<div class="chart-card-actions"><button class="k-btn primary chart-card-go" data-go>Set course · Enter</button></div>') +
      '<div class="chart-card-hint">Double-click a port to set course at once · Esc back</div>';
    card.insertAdjacentHTML('afterbegin', '<button class="chart-card-back" data-back>← Voyages</button>');
    card.querySelector('[data-go]')?.addEventListener('click', () => (choosePort(s.id), showCard(s)));
    card.querySelector('[data-back]')!.addEventListener('click', hideCard);
    cardPort = s;
    card.hidden = false;
    planner.hidden = true;
    // On the chart: the port ringed, the way there drawn from her, and how far beside it.
    for (const p of pins) {
      p.dot.classList.toggle('picked', p.s.id === s.id);
      p.label.classList.toggle('picked', p.s.id === s.id);
    }
    const way = selected?.id === s.id ? undefined : market.route(s.id);
    preview.setAttribute('points', way?.length && here ? [here, ...way].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') : '');
    far.hidden = !sail || sail === 'here';
    far.textContent = sail;
    far.style.left = `${(s.x / map.width) * 100}%`;
    far.style.top = `${(s.y / map.height) * 100}%`;
  };
  let cardPort: PlacedSettlement | undefined;
  // Where she is, for the course drawn to a picked port.
  let here: [number, number] | undefined;
  /** The wind's arrows over open water, in faint ink: which way it blows now, longer the harder. */
  const drawWinds = () => {
    const step = Math.round(map.width / 9);
    const length: Record<string, number> = { calm: 0, light: 0.45, fresh: 0.65, strong: 0.85, gale: 1 };
    let html = '';
    for (let y = step / 2; y < map.height; y += step) {
      for (let x = step / 2; x < map.width; x += step) {
        const t = map.tiles[Math.floor(y) * map.width + Math.floor(x)] as Tile;
        if (t !== Tile.Deep && t !== Tile.Shallow) continue;
        const w = market.wind(x, y);
        const l = (length[w.strength] ?? 0.6) * step * 0.4;
        if (!l) continue;
        // It blows toward the opposite of where it comes from (0 north, 90 east; y grows southward).
        const to = ((w.fromDeg + 180) * Math.PI) / 180;
        const dx = Math.sin(to);
        const dy = -Math.cos(to);
        const [x0, y0, x1, y1] = [x - dx * l, y - dy * l, x + dx * l, y + dy * l];
        const head = l * 0.35;
        const back = (a: number) => [x1 - (dx * Math.cos(a) - dy * Math.sin(a)) * head, y1 - (dy * Math.cos(a) + dx * Math.sin(a)) * head];
        const [lx, ly] = back(0.5);
        const [rx, ry] = back(-0.5);
        html += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} M${lx!.toFixed(1)} ${ly!.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} L${rx!.toFixed(1)} ${ry!.toFixed(1)}"/>`;
      }
    }
    winds.innerHTML = html;
  };
  // Ships the lookouts have seen, fading as the sighting ages (PRD section 3: last-known markers).
  const sighted = sheet.appendChild(document.createElement('div'));
  sighted.className = 'chart-ships';
  // Treasure maps: a dashed ring about each search area (smaller with more pieces of its map).
  const ringsLayer = sheet.appendChild(document.createElement('div'));
  ringsLayer.className = 'chart-rings';
  let ringsDrawn = '';
  const marker = sheet.appendChild(document.createElement('img'));
  marker.className = 'chart-player';
  marker.src = ART['ui.chart.you'] ?? '';
  marker.alt = '';
  marker.title = 'You';
  const you = sheet.appendChild(document.createElement('div'));
  you.className = 'chart-you';
  you.innerHTML = '<span class="chart-you-tag">you</span>';
  // A compass rose in the corner, as on any chart.
  const rose = sheet.appendChild(document.createElement('img'));
  rose.className = 'chart-rose';
  rose.src = ART['ui.chart.compass'] ?? '';
  rose.alt = '';
  const hint = chart.appendChild(document.createElement('div'));
  hint.className = 'chart-hint';
  // The voyage planner: the trades worth sailing from here, best gold for the days first, and leads to
  // look into. Choosing one sets the course to where the buying is.
  const planner = chart.appendChild(document.createElement('div'));
  planner.className = 'chart-plan k-wood';
  const choosePort = (id: string) => {
    const pin = pins.find((p) => p.s.id === id);
    if (!pin) return;
    selected = pin.s;
    for (const p of pins) p.label.classList.toggle('selected', p.s.id === selected.id);
    onSelect(selected);
  };
  const goodName = (id: string) => market.goods.find((g) => g.id === id)?.name ?? id;
  const days = (d: number) => (d < 1 ? 'under a day' : `${Math.round(d)} ${Math.round(d) === 1 ? 'day' : 'days'}`);
  const PIRATES = { low: 'pirates rare', some: 'some pirates', high: 'pirates likely' } as const;
  // How near a lane runs to a haven is all the chart knows: it names the haven, so the warning says why.
  const pirates = (t: { risk: keyof typeof PIRATES; haven: string }) =>
    `<span class="risk-${t.risk}">${PIRATES[t.risk]}${t.risk === 'low' ? '' : `: ${t.risk === 'high' ? 'passes' : 'skirts'} ${t.haven}`}</span>`;
  const GO = '<span class="chart-plan-go">Set course</span>';
  const showPlan = () => {
    const plan = market.plan();
    const rows = plan.trades
      .map(
        (t) =>
          `<button class="chart-plan-row" data-port="${t.from.id}" title="Sets your course to ${t.from.name}">${keyMark(`ui.icon.good.${t.good}`)}<span><b>${goodName(t.good)}</b>: buy at ${t.from.name} (${t.buy}), sell at ${t.to.name} (${t.sell})<br><span class="gain">about +${t.profit.toLocaleString()} gold a hold</span> · ${days(t.daysToStart + t.days)} · ${pirates(t)}</span>${GO}</button>`,
      )
      .join('');
    const contracts = plan.contracts
      .map((c) => {
        const port = c.from ?? c.to;
        const late = c.days > c.daysLeft;
        return `<button class="chart-plan-row" data-port="${port.id}" title="Sets your course to ${port.name}">${keyMark(`ui.icon.good.${c.good}`)}<span><b>${c.units - c.delivered} ${goodName(c.good).toLowerCase()} for ${c.to.name}</b>${c.inHold ? ': in your hold' : c.from ? `: buy at ${c.from.name}` : ''}<br><span class="gain">${c.reward.toLocaleString()} gold reward</span> · ${days(c.days)} · <span class="${late ? 'risk-high' : 'risk-low'}">${days(c.daysLeft)} left${late ? ': too far' : ''}</span></span>${GO}</button>`;
      })
      .join('');
    const leads = plan.leads
      .map(
        (t) =>
          `<button class="chart-plan-row lead" data-port="${t.from.id}" title="Sets your course to ${t.from.name}">${keyMark(`ui.icon.good.${t.good}`)}<span><b>${goodName(t.good)}</b>: made at ${t.from.name}, needed at ${t.to.name}<br>${days(t.daysToStart + t.days)} · ${pirates(t)} · call to learn the prices</span>${GO}</button>`,
      )
      .join('');
    planner.innerHTML =
      (contracts ? `<div class="chart-plan-head">Contracts you have heard of</div>${contracts}` : '') +
      '<div class="chart-plan-head">Voyages from here</div>' +
      (rows || '<div class="chart-plan-empty">No trade you know of pays yet: call at more ports to learn their prices.</div>') +
      (leads ? `<div class="chart-plan-head">Worth a look</div>${leads}` : '') +
      '<div class="chart-plan-foot">A course goes to where you buy; F follows it.</div>';
    for (const b of planner.querySelectorAll<HTMLButtonElement>('[data-port]')) b.addEventListener('click', () => choosePort(b.dataset.port!));
  };
  /** A good's painted icon, or nothing if the art isn't there. */
  const keyMark = (id: string) => (ART[id] ? `<img class="chart-key-mark" src="${ART[id]}" alt="">` : '');
  // The title strip (storyboard 4.4), and who is at war: it decides who trades with you and who hunts you.
  const showHint = () => {
    const wars = market.wars();
    hint.innerHTML =
      '<span class="chart-hint-title">The Caribbean</span><span>arrows: the wind now</span>' +
      `<span class="chart-hint-wars">${wars.length ? `At war: ${wars.map(([a, b]) => `${a}–${b}`).join(', ')}` : 'All nations at peace'}</span>` +
      '<span><kbd class="k-key">M</kbd> close</span>';
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
    b.className = 'k-btn small';
    b.textContent = g.name;
    b.addEventListener('click', () => {
      good = good === g.id ? undefined : g.id;
      showGood();
    });
    return { id: g.id, b };
  });
  const pin = (id: string) => pins.find((p) => p.s.id === id);
  const showGood = () => {
    for (const { id, b } of goodButtons) b.classList.toggle('active', id === good);
    for (const { s, label } of pins) {
      const lean = good ? market.lean(s.id, good) : undefined;
      const seen = good ? market.known(s.id)?.prices[good] : undefined;
      const price = seen && (lean === 'exports' ? seen.buy : seen.sell);
      label.textContent = s.name;
      // Made there it is cheap (the price to buy); needed there it is wanted (the price to sell).
      const verdict = lean === 'exports' ? 'cheap' : lean === 'wants' ? 'wanted' : undefined;
      const has = verdict ? `${verdict}${price !== undefined ? ` · ${price}` : ''}` : good ? undefined : market.mark(s.id);
      if (has) {
        const tag = label.appendChild(document.createElement('span'));
        tag.className = `chart-mark${verdict ? ` ${verdict}` : ''}`;
        tag.textContent = has;
      }
      label.classList.toggle('faded', Boolean(good) && !lean);
      const shut = market.closed(s.id);
      label.classList.toggle('closed', shut);
      pin(s.id)?.dot.classList.toggle('closed', shut);
    }
    layoutLabels(pins, sheet.getBoundingClientRect());
  };

  const toggle = (open = chart.hidden) => {
    chart.hidden = !open;
    // A card left from the last look would show stale prices.
    hideCard();
    // Prices may have been learned since the chart was last open, and the wind has moved.
    if (open) {
      showGood();
      showHint();
      showPlan();
      drawWinds();
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') toggle();
    if (e.key === 'Escape') {
      if (!card.hidden) hideCard();
      else chart.hidden = true;
    }
    // Enter sets course to the port picked.
    if (e.key === 'Enter' && !chart.hidden && !card.hidden && cardPort && selected?.id !== cardPort.id) {
      choosePort(cardPort.id);
      showCard(cardPort);
    }
  });

  return {
    /** The chart is open: the world waits while the captain studies it. */
    get open() {
      return !chart.hidden;
    },
    /** Open the chart, its voyages beside it (the log's trading goal sends the captain here). */
    show() {
      toggle(true);
    },
    /** The search rings of the treasure maps held: centre and radius in tiles, and whose hoard. */
    rings(list: { x: number; y: number; r: number; label: string }[]) {
      const html = list
        .map(
          (g) =>
            `<div class="chart-ring" title="${g.label}" style="left:${(g.x / map.width) * 100}%;top:${(g.y / map.height) * 100}%;width:${((2 * g.r) / map.width) * 100}%"></div>` +
            // Its label in red ink above the ring: whose hoard, search here.
            `<div class="chart-ring-label" style="left:${(g.x / map.width) * 100}%;top:${((g.y - g.r) / map.height) * 100}%">${g.label.split(':')[0]}: search here</div>`,
        )
        .join('');
      if (html !== ringsDrawn) ringsLayer.innerHTML = ringsDrawn = html;
    },
    /** Forget the destination (made port): no port highlighted. */
    clearDestination() {
      selected = undefined;
      for (const p of pins) p.label.classList.remove('selected');
    },
    update(
      player: Ship | undefined,
      seen?: { sightings: Record<string, Sighting>; tick: number; ticksPerDay: number },
      /** The course plotted, by the lanes, from her to the destination. */
      route?: [number, number][],
    ) {
      if (!player) return;
      here = [player.x, player.y];
      // Minimap: a window on the parchment centred on the ship, clamped to the map.
      const sx = Math.max(0, Math.min(map.width - MINIMAP_TILES.w, Math.round(player.x - MINIMAP_TILES.w / 2)));
      const sy = Math.max(0, Math.min(map.height - MINIMAP_TILES.h, Math.round(player.y - MINIMAP_TILES.h / 2)));
      mctx.drawImage(paper, sx, sy, MINIMAP_TILES.w, MINIMAP_TILES.h, 0, 0, MINIMAP_TILES.w, MINIMAP_TILES.h);
      // Ports inked in, the destination ringed in red ink, and her as the chart's gold pin.
      mctx.fillStyle = '#3b2a1c';
      for (const s of settlements) mctx.fillRect(Math.floor(s.x - sx) - 1, Math.floor(s.y - sy) - 1, 3, 3);
      if (selected) {
        mctx.strokeStyle = '#8e2414';
        mctx.lineWidth = 1.5;
        mctx.beginPath();
        mctx.arc(selected.x - sx, selected.y - sy, 5, 0, Math.PI * 2);
        mctx.stroke();
      }
      mctx.fillStyle = '#e8c170';
      mctx.strokeStyle = '#1d1410';
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(player.x - sx, player.y - sy, 3.5, 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();

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
        const line = route?.length ? [[player.x, player.y], ...route].map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ') : '';
        if (line !== courseDrawn) course.setAttribute('points', (courseDrawn = line));
        marker.style.left = `${(player.x / map.width) * 100}%`;
        marker.style.top = `${(player.y / map.height) * 100}%`;
        marker.style.transform = `translate(-50%, -50%) rotate(${player.headingDeg}deg)`;
        you.style.left = marker.style.left;
        you.style.top = marker.style.top;
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
