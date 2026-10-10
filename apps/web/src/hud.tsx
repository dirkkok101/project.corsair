import type { Ship, Wind, WorldState } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { angleOffWind, pointOfSail, polarAt, speedPoints, targetSpeed, toSpeedPoints } from '@corsair/systems-navigation';
import type { Polar } from '@corsair/data';

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
        {Math.round(knots)} {Math.round(knots) === 1 ? 'knot' : 'knots'}
      </div>
      <div class="compass-point">{pointName}</div>
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
  /** "Enter Port Royal · E" when a port is in reach. */
  prompt?: string;
  /** Time acceleration in force (2 or 4), or why cruising is held at 1x ("near land", "sail in sight", "storm"). */
  timeScale?: number | string;
  /** True for a moment after the career is saved. */
  saved?: boolean;
  /** Knots for a speed of one tile a second (from the map's scale and the game's clock). */
  knotsPerTilePerSecond: number;
  /** The view's turn (degrees clockwise): the 3D camera from astern turns with her, and the compass with it. */
  viewDeg?: number;
}

export function Hud({
  state,
  content,
  wind,
  date,
  seaArea,
  inStorm,
  breeze,
  destination,
  sound,
  prompt,
  timeScale,
  saved,
  knotsPerTilePerSecond,
  viewDeg,
}: HudProps) {
  const ship = state.ships.player;
  if (!ship) return null;
  const offWind = angleOffWind(ship.headingDeg, wind.fromDeg);
  return (
    <>
      <div class="hud">
        <div class="hud-date">
          {date}

          {typeof timeScale === 'string' ? ` · 1×, ${timeScale}` : timeScale ? ` · ${timeScale}×` : ''}
        </div>
        <div class="hud-date">{inStorm ? <span class="hud-storm">Storm!</span> : seaArea}</div>
        <div>Wind</div>
        <div>
          {wind.strength} from {Math.round(wind.fromDeg)}°
        </div>
        <div />
        <div>
          {pointOfSail(content, offWind).name} · {Math.round(offWind)}° off the wind
        </div>
        {breeze ? (
          <>
            <div />
            <div class="hud-note">{breeze}</div>
          </>
        ) : null}
        {ship.assist ? (
          <>
            <div>Course</div>
            <div class="hud-note">
              {ship.assist.mode === 'course' ? 'Plotted course' : ship.assist.mode === 'intercept' ? 'Intercept' : 'Beating'} · {ship.assist.tack} tack
            </div>
          </>
        ) : null}
        {destination ? (
          <>
            <div>To</div>
            <div>
              {destination.name} · {Math.round(destination.distanceKm)} km · bear {Math.round(destination.bearingDeg)}°
              {destination.following ? ' · following' : ' · F to follow'}
            </div>
          </>
        ) : null}
        <div>Sails</div>
        <div>{ship.sails}</div>
        <div>Heading</div>
        <div>{Math.round(ship.headingDeg)}°</div>
        <div>Speed</div>
        <div>
          {speedPoints(content, ship).toFixed(1)} → {toSpeedPoints(content, targetSpeed(content, ship, wind)).toFixed(1)}
          {ship.blocked ? ' · aground' : ''}
        </div>
      </div>
      <Compass {...compassProps(content, ship, wind, ship.speed * knotsPerTilePerSecond)} viewDeg={viewDeg} />
      {sound ? <div class="hud-sound">{sound}</div> : null}
      {prompt ? <div class="hud-prompt">{prompt}</div> : null}
      {saved ? <div class="hud-saved">Saved</div> : null}
      <div class="hud-keys">A/D or ←/→ steer · W/S or ↑/↓ sails · T tack · B beat · I intercept · H hail · M chart (pick a port) · F follow route · E port · L log · G dig · K careen · =/- cruise · Ctrl+S save · V sound · N music · [ ] turn wind · 1–5 wind strength</div>
    </>
  );
}
