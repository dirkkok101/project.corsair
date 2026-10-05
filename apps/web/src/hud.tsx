import type { Wind, WorldState } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import { angleOffWind, pointOfSail, polarAt, speedPoints, targetSpeed, toSpeedPoints } from '@corsair/systems-navigation';
import type { Polar } from '@corsair/data';

const ROSE = { size: 120, inner: 8, outer: 46 };

/**
 * The ship's speed for every heading in this wind, drawn north-up like the map. The shape is the
 * polar table scaled by wind strength and sail setting, against an outer ring at the strongest wind
 * on full sail, so it grows and shrinks with the wind. The red arc is the no-go zone; gold is the heading.
 */
function WindRose({
  polar,
  wind,
  headingDeg,
  scale,
  best,
}: {
  polar: Polar;
  wind: Wind;
  headingDeg: number;
  /** Wind strength x sail setting, as a fraction of the strongest wind on full sail. */
  scale: number;
  /** Best speed in this wind, on the class's 1-10 scale. */
  best: number;
}) {
  const windFromDeg = wind.fromDeg;
  const c = ROSE.size / 2;
  const at = (deg: number, r: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [c + Math.sin(rad) * r, c - Math.cos(rad) * r];
  };
  const radius = (deg: number) =>
    ROSE.inner + polarAt(polar, angleOffWind(deg, windFromDeg)) * scale * (ROSE.outer - ROSE.inner);
  const curve = Array.from({ length: 72 }, (_, i) => at(i * 5, radius(i * 5)).join(',')).join(' ');
  const noGo = Array.from({ length: 72 }, (_, i) => i * 5).filter((d) => polarAt(polar, angleOffWind(d, windFromDeg)) < 0.02);
  const [hx, hy] = at(headingDeg, ROSE.outer + 6);
  const [sx, sy] = at(headingDeg, radius(headingDeg));
  const [w1x, w1y] = at(windFromDeg, ROSE.outer + 12);
  const [w2x, w2y] = at(windFromDeg, ROSE.outer + 2);
  return (
    <svg class="hud-rose" width={ROSE.size} height={ROSE.size} viewBox={`0 0 ${ROSE.size} ${ROSE.size}`}>
      <circle cx={c} cy={c} r={ROSE.outer} fill="none" stroke="#394a50" />
      <circle cx={c} cy={c} r={(ROSE.inner + ROSE.outer) / 2} fill="none" stroke="#202e37" />
      <text x={c} y={9} text-anchor="middle" fill="#819796" font-size="9">N</text>
      <text x={c} y={ROSE.size - 3} text-anchor="middle" fill="#819796" font-size="9">
        best {best.toFixed(1)}
      </text>
      <polygon points={curve} fill="rgb(115 190 211 / 0.25)" stroke="#73bed3" />
      {noGo.map((d) => {
        const [ax, ay] = at(d - 2.5, ROSE.outer);
        const [bx, by] = at(d + 2.5, ROSE.outer);
        return <line key={d} x1={ax} y1={ay} x2={bx} y2={by} stroke="#cf573c" stroke-width="4" />;
      })}
      <line x1={w1x} y1={w1y} x2={w2x} y2={w2y} stroke="#ebede9" stroke-width="2" marker-end="url(#rose-arrow)" />
      <line x1={c} y1={c} x2={hx} y2={hy} stroke="#e8c170" stroke-width="2" />
      <circle cx={sx} cy={sy} r={3} fill="#e8c170" />
      <defs>
        <marker id="rose-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="#ebede9" />
        </marker>
      </defs>
    </svg>
  );
}

export interface HudProps {
  state: WorldState;
  content: ContentPack;
  /** Wind where the ship is. */
  wind: Wind;
  date: string;
  seaArea: string;
  inStorm: boolean;
  /** Time of day, "15:00". */
  time: string;
  /** Wind source note near coasts ("sea breeze", "land breeze"). */
  breeze?: string;
  destination?: { name: string; distanceKm: number; bearingDeg: number; closing: number };
}

export function Hud({ state, content, wind, date, seaArea, inStorm, time, breeze, destination }: HudProps) {
  const ship = state.ships.player;
  if (!ship) return null;
  const cls = content.ships[ship.classId]!;
  const offWind = angleOffWind(ship.headingDeg, wind.fromDeg);
  const nav = content.navigation;
  const polar = content.polars[cls.polar]!;
  const drive = nav.windStrength[wind.strength]! * nav.sailSettings[ship.sails]!;
  const strongest = Math.max(...Object.values(nav.windStrength)) * Math.max(...Object.values(nav.sailSettings));
  const best = cls.speed * Math.max(...polar.values) * drive;
  return (
    <>
      <div class="hud">
        <div class="hud-date">
          {date} · {time}
        </div>
        <div class="hud-date">{inStorm ? <span class="hud-storm">Storm!</span> : seaArea}</div>
        {/* The arrow shows where the wind blows to; fromDeg is where it comes from. */}
        <div class="hud-wind" style={{ transform: `rotate(${wind.fromDeg}deg)` }} title="Wind">
          ↓
        </div>
        <div>
          Wind {wind.strength} from {Math.round(wind.fromDeg)}°
        </div>
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
            <div class="hud-note">Beating · {ship.assist.tack} tack</div>
          </>
        ) : null}
        {destination ? (
          <>
            <div>To</div>
            <div>
              {destination.name} · {Math.round(destination.distanceKm)} km · {Math.round(destination.bearingDeg)}° · closing{' '}
              {destination.closing.toFixed(1)}
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
      <WindRose polar={polar} wind={wind} headingDeg={ship.headingDeg} scale={drive / strongest} best={best} />
      <div class="hud-keys">A/D or ←/→ steer · W/S or ↑/↓ sails · T tack · B beat · M chart · [ ] turn wind · 1–5 wind strength</div>
    </>
  );
}
