import type { Ship, Wind, WorldState } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { angleOffWind, pointOfSail, polarAt } from '@corsair/systems-navigation';
import type { Polar } from '@corsair/data';
import { Key, Stat } from './ui/kit';
import { Art } from './ui-art';

const ROSE = { size: 168, ring: 62, inner: 10, outer: 54 };
const GILT = '#e6bf6a';
const GILT_DARK = '#9a6e34';
const WIND_RED = '#d8352a';

export interface CompassProps {
  polar: Polar;
  wind: Wind;
  /** The wind's strength, 0..1 of the strongest. */
  windDrive: number;
  headingDeg: number;
  /** Wind strength x sail setting, as a fraction of the strongest wind on full sail. */
  scale: number;
  knots: number;
  /** Her point of sail ("Beam reach"). */
  pointName: string;
  /** How well the wind drives her on this heading, 0 (in irons) .. 1 (her best point of sail). */
  sailing: number;
  /** The view's turn (degrees clockwise from north up the screen): the rose turns with it, so it matches the sea. */
  viewDeg?: number;
  className?: string;
}

/**
 * The compass (after Sid Meier's Pirates!, whose HUD shows the wind as a red arrow through a gilt compass rose):
 * north-up like the map, the red arrow pointing where the wind blows, longer and bolder the harder it blows;
 * the ship's heading as a gold mark on the rim, and her speed in knots beneath. Quietly behind the rose, for
 * the sailor: her speed for every heading in this wind (the pale shape, against the strongest wind on full
 * sail), and the no-go zone dark red on the ring.
 */
export function Compass({
  polar,
  wind,
  windDrive,
  headingDeg,
  scale,
  knots,
  pointName,
  sailing,
  viewDeg = 0,
  className,
}: CompassProps) {
  // Its gradients' ids are its own: another compass (the sea HUD's, hidden in battle) can't lend them.
  const uid = `compass-${className ?? 'sea'}`;
  const windFromDeg = wind.fromDeg;
  const c = ROSE.size / 2;
  const at = (deg: number, r: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [c + Math.sin(rad) * r, c - Math.cos(rad) * r];
  };
  const pt = (deg: number, r: number) => at(deg, r).join(',');
  const radius = (deg: number) => ROSE.inner + polarAt(polar, angleOffWind(deg, windFromDeg)) * scale * (ROSE.outer - ROSE.inner);
  const curve = Array.from({ length: 72 }, (_, i) => pt(i * 5, radius(i * 5))).join(' ');
  const noGo = Array.from({ length: 72 }, (_, i) => i * 5).filter((d) => polarAt(polar, angleOffWind(d, windFromDeg)) < 0.02);
  // The rose: four long points to the quarters, four short between, each lit on one side (a gilt star).
  const star = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
    const long = d % 90 === 0;
    const r = long ? ROSE.outer - 4 : ROSE.outer * 0.55;
    const w = long ? 16 : 12;
    return (
      <g key={d}>
        <polygon points={`${c},${c} ${pt(d - w, r * 0.32)} ${pt(d, r)}`} fill={long ? GILT : GILT_DARK} />
        <polygon points={`${c},${c} ${pt(d + w, r * 0.32)} ${pt(d, r)}`} fill={long ? GILT_DARK : '#6e4d24'} />
      </g>
    );
  });
  // The wind's arrow, through the rose to where it blows; its length and weight by how hard it blows.
  const to = windFromDeg + 180;
  const reach = 22 + windDrive * 30;
  const [tx, ty] = at(to, reach);
  const [fx, fy] = at(windFromDeg, reach * 0.85);
  const width = 3 + windDrive * 3;
  const head = `${pt(to, reach + 8)} ${pt(to + 24, reach - 6)} ${pt(to - 24, reach - 6)}`;
  const flight = (side: number) => `${pt(windFromDeg + side * 14, reach * 0.85 + 6)} ${pt(windFromDeg, reach * 0.85 - 4)} ${pt(windFromDeg + side * 4, reach * 0.85 + 8)}`;
  const [hx, hy] = at(headingDeg, ROSE.ring - 3);
  // Her hull in the middle, pointing her way: the wind's arrow against her shows at a glance where it takes her.
  const hull = [
    [0, 30],
    [7, 14],
    [8, -6],
    [6, -22],
    [-6, -22],
    [-8, -6],
    [-7, 14],
  ]
    .map(([x, y]) => {
      const r = (headingDeg * Math.PI) / 180;
      return `${c + Math.cos(r) * x! + Math.sin(r) * y!},${c + Math.sin(r) * x! - Math.cos(r) * y!}`;
    })
    .join(' ');
  // How well the wind drives her: green at her best, amber when pinching or running, red in irons.
  const drawing = sailing > 0.75 ? '#7fcf6a' : sailing > 0.4 ? '#e6bf4a' : '#d8352a';
  return (
    <div class={`hud-rose${className ? ` ${className}` : ''}`} title="Compass: the red arrow is the wind, the gold mark your heading">
      <svg width={ROSE.size} height={ROSE.size} viewBox={`0 0 ${ROSE.size} ${ROSE.size}`}>
        <g transform={`rotate(${-viewDeg} ${c} ${c})`}>
        <defs>
          <radialGradient id={`${uid}-face`} cx="50%" cy="45%" r="60%">
            <stop offset="0" stop-color="#2a5d8c" />
            <stop offset="1" stop-color="#132c47" />
          </radialGradient>
          <linearGradient id={`${uid}-gilt`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#f6dc95" />
            <stop offset="0.5" stop-color={GILT} />
            <stop offset="1" stop-color={GILT_DARK} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={ROSE.ring + 8} fill={`url(#${uid}-face)`} stroke={`url(#${uid}-gilt)`} stroke-width="5" />
        <circle cx={c} cy={c} r={ROSE.ring} fill="none" stroke={`url(#${uid}-gilt)`} stroke-width="1.5" opacity="0.8" />
        {/* Ticks round the ring: long at the quarters. */}
        {Array.from({ length: 32 }, (_, i) => {
          const d = i * 11.25;
          const [ax, ay] = at(d, ROSE.ring);
          const [bx, by] = at(d, ROSE.ring - (i % 8 === 0 ? 7 : i % 2 === 0 ? 4 : 2));
          return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke={GILT} stroke-width={i % 8 === 0 ? 1.5 : 1} opacity="0.85" />;
        })}
        <polygon points={curve} fill="rgb(150 220 235 / 0.16)" stroke="rgb(150 220 235 / 0.45)" stroke-width="1" />
        {noGo.map((d) => {
          const [ax, ay] = at(d - 2.5, ROSE.ring + 3);
          const [bx, by] = at(d + 2.5, ROSE.ring + 3);
          return <line key={d} x1={ax} y1={ay} x2={bx} y2={by} stroke="#7a2a24" stroke-width="4" />;
        })}
        {star}
        {/* North: a fleur-de-lis above the ring. */}
        <path
          d={`M${c},${c - ROSE.ring - 14} q-5,6 0,13 q5,-7 0,-13 M${c - 10},${c - ROSE.ring - 2} q3,-9 10,-4 q7,-5 10,4`}
          fill={GILT}
          stroke={GILT_DARK}
          stroke-width="0.8"
        />
        <text x={c} y={c - ROSE.ring + 18} text-anchor="middle" class="compass-n">N</text>
        {/* The wind's red arrow, over everything. */}
        <g opacity={0.55 + windDrive * 0.45}>
          <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={WIND_RED} stroke-width={width} stroke-linecap="round" />
          <polygon points={head} fill={WIND_RED} stroke="#7a1a14" stroke-width="1" />
          <polygon points={flight(1)} fill={WIND_RED} />
          <polygon points={flight(-1)} fill={WIND_RED} />
        </g>
        {/* Her hull, her way, over the arrow, lit by how well she sails. */}
        <polygon points={hull} fill="#3a2418" stroke={drawing} stroke-width="2.5" stroke-linejoin="round" />
        {/* Her heading: a gold mark on the rim. */}
        <circle cx={hx} cy={hy} r="4.5" fill="#fff1c4" stroke={GILT_DARK} stroke-width="1.5" />
        </g>
      </svg>
      <div class="compass-speed">
        {Math.round(knots)} {Math.round(knots) === 1 ? 'knot' : 'knots'} · {pointName.toLowerCase()}
      </div>
      <div class="compass-sailing" title="How well the wind fills your sails on this heading">
        <span style={{ width: `${Math.round(sailing * 100)}%`, background: drawing }} />
      </div>
    </div>
  );
}

/** The compass's reading for a ship in this wind, going at `knots`. */
export function compassProps(content: ContentPack, ship: { classId: string; headingDeg: number; sails: Ship['sails'] }, wind: Wind, knots: number): CompassProps {
  const nav = content.navigation;
  const polar = content.polars[content.ships[ship.classId]!.polar]!;
  const drive = nav.windStrength[wind.strength]! * nav.sailSettings[ship.sails]!;
  const strongest = Math.max(...Object.values(nav.windStrength)) * Math.max(...Object.values(nav.sailSettings));
  return {
    polar,
    wind,
    windDrive: nav.windStrength[wind.strength]! / Math.max(...Object.values(nav.windStrength)),
    headingDeg: ship.headingDeg,
    scale: drive / strongest,
    knots,
    pointName: pointOfSail(content, angleOffWind(ship.headingDeg, wind.fromDeg)).name,
    sailing: polarAt(polar, angleOffWind(ship.headingDeg, wind.fromDeg)) / Math.max(...polar.values),
  };
}

/** The part of the day an hour falls in, as a sailor says it. */
export function partOfDay(hour: number): string {
  if (hour < 5 || hour >= 20) return 'night';
  if (hour < 7) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'dusk';
}

export interface HudProps {
  state: WorldState;
  content: ContentPack;
  /** Wind where the ship is. */
  wind: Wind;
  date: string;
  seaArea: string;
  inStorm: boolean;
  /** Wind source note near coasts ("sea breeze", "land breeze"). */
  breeze?: string;
  /** The port picked on the chart: distance along the plotted route, the bearing of its next leg, and
   * whether the autopilot is following it. */
  destination?: { name: string; distanceKm: number; bearingDeg: number; following: boolean };
  /** Sound status hint, shown until sound is running (or while muted). */
  sound?: string;
  /** The one thing to do now ("Enter Port Royal · E"): a trailing " · K" shows as a key cap. */
  prompt?: string;
  /** "Sail ho!": a ship just come into sight, called out across the top: who and where, and whether she can be hailed. */
  banner?: { text: string; hail: boolean };
  /** Notes that come and go (a goal done, a dig's result, rent paid) and warnings that stay while they hold. */
  toasts?: Toast[];
  /** The hour the sky shows (0 to 24), for the date line's "morning" or "dusk". */
  hour: number;
  /** Why cruising is held at 1x ("near land", "sail in sight", "storm"), while it is. */
  held?: string;
  /** True for a moment after the career is saved. */
  saved?: boolean;
  /** Knots for a speed of one tile a second (from the map's scale and the game's clock). */
  knotsPerTilePerSecond: number;
  /** The view's turn (degrees clockwise): the 3D camera from astern turns with her, and the compass with it. */
  viewDeg?: number;
  /** The career's next goal, shown in a pill (opens the log). */
  goal?: { title: string; have: number; of: number; unit: string; mission?: boolean };
  /** The strip: gold, the chest, men, food, morale, hull, hold; faded while nothing changes. */
  strip: { gold: number; chest: number; crew: number; berths: number; foodDays: number; morale: string; moraleLow: boolean; hull: string; hullLow: boolean; foul?: number; hold: number; capacity: number };
  faded: boolean;
  /** Sails and cruise speed, by the compass. */
  setSails: (sails: Ship['sails']) => void;
  /** Cruise speed, and whether it drops to 1x near land, a port, a sail or a storm (`holds`). */
  cruise: { speed: number; choose: (speed: number) => void; holds: boolean; toggleHolds: () => void };
  /** The gentle wind setting: any heading, and a calm, still make way for her. */
  gentleWind: { on: boolean; toggle: () => void };
  /** F1: every key, grouped, and closing it. */
  help: boolean;
  closeHelp: () => void;
  /** The fleet held to its slowest ship's pace: why, in a few words (until the log's Fleet page, slice S8). */
  fleetPace?: string;
}

/** A note on the HUD: what it says, what kind it is (said small beneath), its icon, and gold or red for a goal or a warning. */
export interface Toast {
  text: string;
  kind: string;
  icon: string;
  tone?: 'gold' | 'warn';
}

/** "Enter Port Royal · E" as text and a key cap. */
function Prompt({ text }: { text: string }) {
  const m = /^(.*) · ([A-Z0-9]{1,5}|[A-Z] [a-z]+(?: [a-z]+)?)$/.exec(text);
  if (!m) return <div class="hud-prompt">{text}</div>;
  // A trailing "· I intercept" names its key and what it does.
  const [k, ...rest] = m[2]!.split(' ');
  return (
    <div class="hud-prompt">
      <Key k={k!} />
      <span>
        {m[1]}
        {rest.length ? ` · ${rest.join(' ')}` : ''}
      </span>
    </div>
  );
}

const KEYS: { group: string; keys: [string, string][] }[] = [
  { group: 'Sailing', keys: [['A D', 'steer'], ['W S', 'more or less sail'], ['T', 'tack'], ['B', 'beat to windward'], ['= −', 'cruise speed'], ['C', 'look from astern']] },
  { group: 'Course and chart', keys: [['M', 'the chart: pick a port'], ['F', 'follow the route'], ['I', 'intercept a ship'], ['Click', 'sail there, or dock']] },
  { group: 'Ships and shore', keys: [['H', 'hail a ship'], ['E', 'enter port, set sail'], ['G', 'go ashore and dig'], ['K', 'careen on a beach']] },
  { group: 'Battle', keys: [['Space', 'fire whichever side bears'], ['Q E', 'fire port or starboard'], ['Tab 1-3', 'round, chain, grape'], ['G', 'close to board'], ['R', 'repel boarders'], ['Y', 'strike your colours'], ['Enter', 'take the plunder']] },
  { group: 'The captain', keys: [['L', "the captain's log"], ['Ctrl S', 'save'], ['V', 'sound on or off'], ['N', 'music on or off'], ['F1', 'this help'], ['Esc', 'close, or leave port']] },
];

/** F1: every key, grouped as the storyboard's help (artboard 4.5). */
export function Help({ close }: { close: () => void }) {
  return (
    <div class="hud-help">
      <div class="hud-help-head">
        <span class="k-title">Every key</span>
        <span class="k-sub">At sea only the key you need right now shows · F1 closes this</span>
        <button class="k-btn small" onClick={close}>
          Close · F1
        </button>
      </div>
      <div class="hud-help-groups">
        {KEYS.map((g) => (
          <div key={g.group} class="k-wood hud-help-group">
            <div class="k-who">{g.group}</div>
            {g.keys.map(([k, does]) => (
              <div key={k} class="hud-help-row">
                <Key k={k} />
                <span>{does}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hud(p: HudProps) {
  const { state, content, wind } = p;
  const ship = state.ships.player;
  if (!ship) return null;
  const s = p.strip;
  const food = Math.floor(s.foodDays);
  return (
    <div class="hud">
      <div class="hud-top">
        {p.goal ? (
          <div class="hud-pill hud-goal" title={p.goal.mission ? 'The nearest of your missions: the log (L) shows them all' : 'Your next goal: the log (L) shows them all'}>
            <span class="k-who">{p.goal.mission ? 'Mission' : 'Goal'}</span> {p.goal.title}
            {p.goal.unit ? ` · ${p.goal.have.toLocaleString()} of ${p.goal.of.toLocaleString()}` : ''}
          </div>
        ) : null}
        <div class="hud-pill hud-sea">
          {p.inStorm ? <span class="hud-storm">Storm!</span> : p.seaArea}
          {p.breeze ? <span class="hud-note"> · {p.breeze}</span> : null}
        </div>
        {p.destination ? (
          <div class="hud-pill hud-course">
            To {p.destination.name} · {Math.round(p.destination.distanceKm)} km · bear {Math.round(p.destination.bearingDeg)}°
            {p.destination.following ? ' · following' : ' · F to follow'}
          </div>
        ) : ship.assist ? (
          <div class="hud-pill hud-course">
            {ship.assist.mode === 'course' ? 'Plotted course' : ship.assist.mode === 'intercept' ? 'Intercept' : 'Beating'} · {ship.assist.tack} tack
          </div>
        ) : null}
        {p.fleetPace ? <div class="hud-pill hud-fleet">{p.fleetPace}</div> : null}
      </div>
      <div class="hud-date">
        {p.date} · {partOfDay(p.hour)}
        {p.held ? ` · 1×, ${p.held}` : ''}
      </div>
      {p.banner ? (
        <div class="hud-banner">
          <b>Sail ho!</b>
          <span>{p.banner.text}</span>
          {p.banner.hail ? (
            <span class="hud-banner-key">
              <Key k="H" /> hail
            </span>
          ) : null}
          <span class="hud-banner-key">
            <Key k="I" /> intercept
          </span>
        </div>
      ) : null}
      {p.toasts?.length ? (
        <div class="hud-toasts">
          {p.toasts.map((t) => (
            <div key={t.text} class={`hud-toast${t.tone ? ` ${t.tone}` : ''}`}>
              <Art id={t.icon} class="hud-toast-icon" />
              <div>
                <div>{t.text}</div>
                <div class="hud-toast-kind">{t.kind}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {p.prompt ? <Prompt text={p.prompt} /> : null}
      <div class={`hud-strip${p.faded ? ' faded' : ''}`}>
        <Stat icon="ui.icon.gold" value={s.gold.toLocaleString()} title="Gold in your purse" />
        {s.chest ? <Stat icon="ui.icon.chest" value={s.chest.toLocaleString()} title="The plunder chest the crew sails for: divide it in a tavern" /> : null}
        <Stat icon="ui.icon.crew" value={`${s.crew} men`} title={`Crew ${s.crew} of ${s.berths} berths`} low={s.crew < s.berths / 3} />
        <Stat icon="ui.icon.food" value={`${food} ${food === 1 ? 'day' : 'days'}`} title="Food aboard, in days for this crew" low={s.foodDays <= 3} />
        <Stat icon="ui.icon.morale" value={s.morale} title="The crew's morale" low={s.moraleLow} />
        <Stat
          icon="ui.icon.hull"
          value={s.foul !== undefined && s.foul >= 0.05 ? `${s.hull} · foul` : s.hull}
          title={s.foul !== undefined && s.foul >= 0.05 ? `Her bottom is foul: ${Math.round(s.foul * 100)}% off her speed. Careen her at a shipwright, or on a beach (K)` : 'Her hull'}
          low={s.hullLow}
        />
        <Stat icon="ui.icon.good.food" value={`${s.hold} / ${s.capacity}`} title="Her hold: cargo aboard of what she carries" />
      </div>
      <div class="hud-controls">
        {(['full', 'half'] as const).map((sail) => (
          <button
            key={sail}
            class={`k-btn small hud-sail${ship.sails === sail ? ' active' : ''}`}
            aria-label={sail === 'full' ? 'Full sail' : 'Half sail'}
            title={sail === 'full' ? 'Full sail (W)' : 'Half sail, tighter turns (S)'}
            onClick={() => p.setSails(sail)}
          >
            <Art id={`ui.icon.${sail}_sail`} />
          </button>
        ))}
        <button
          class="k-btn small"
          aria-label="Cruise speed"
          title="Cruise speed on open sea, 1×, 2× or 4×: click for the next (= and -)"
          onClick={() => p.cruise.choose(p.cruise.speed >= 4 ? 1 : p.cruise.speed * 2)}
        >
          {p.cruise.speed}×
        </button>
        <button
          class={`k-btn small hud-holds${p.cruise.holds ? ' active' : ''}`}
          aria-label="Slow near land and sails"
          title={
            p.cruise.holds
              ? 'Cruising slows to 1× near land, a port, a sail or a storm. Click to keep your speed'
              : 'Cruising keeps your speed everywhere. Click to slow to 1× near land, a port, a sail or a storm'
          }
          onClick={p.cruise.toggleHolds}
        >
          {p.cruise.holds ? 'Slows' : 'Steady'}
        </button>
        <button
          class={`k-btn small hud-wind${p.gentleWind.on ? ' active' : ''}`}
          aria-label="Gentle wind"
          title={
            p.gentleWind.on
              ? 'Gentle wind: you make way on any heading, and in a calm. Click for the real wind'
              : 'Real wind: your heading against it sets your speed. Click for a gentle wind, to sail where you like'
          }
          onClick={p.gentleWind.toggle}
        >
          {p.gentleWind.on ? 'Gentle' : 'Real'}
        </button>
      </div>
      <Compass {...compassProps(content, ship, wind, ship.speed * p.knotsPerTilePerSecond)} viewDeg={p.viewDeg} />
      {p.sound ? <div class="hud-sound">{p.sound}</div> : null}
      {p.saved ? <div class="hud-saved">Saved</div> : null}
      <div class="hud-help-hint">
        <Key k="F1" /> keys
      </div>
      {p.help ? <Help close={p.closeHelp} /> : null}
    </div>
  );
}
