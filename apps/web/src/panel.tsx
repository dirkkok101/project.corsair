// The ship panel (bottom left, at sea and in battle): the ship drawn with her state on her, a row of
// cannon per broadside lit as they are loaded (after Pirates!' cannon status), and the modes to click.
// The drawing and icons are placeholders in SVG until the painted panel art (art/sources/grok/README.md).

import type { SailSetting } from '@corsair/core';

export type Shot = 'round' | 'chain' | 'grape';

export interface ShipPanelProps {
  name: string;
  hull: number;
  hullMax: number;
  /** Sail condition, 0 to 100. */
  sails: number;
  crew: number;
  berths: number;
  sailSetting: SailSetting;
  /** Guns per broadside, and how many of them are loaded now (all of them at sea). */
  guns: { port: { loaded: number; of: number }; starboard: { loaded: number; of: number } };
  /** In battle: the shot loaded, and choosing another. */
  shot?: { loaded: Shot; choose: (shot: Shot) => void };
  setSails: (sails: SailSetting) => void;
  /** At sea: the cruise speed, and stopping a course. */
  cruise?: { speed: number; choose: (speed: number) => void; course: boolean; stop: () => void };
}

const SHOTS: { id: Shot; name: string; key: string }[] = [
  { id: 'round', name: 'Round', key: '1' },
  { id: 'chain', name: 'Chain', key: '2' },
  { id: 'grape', name: 'Grape', key: '3' },
];

function ShotIcon({ shot }: { shot: Shot }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {shot === 'round' ? <circle cx="8" cy="8" r="5" fill="currentColor" /> : null}
      {shot === 'chain' ? (
        <>
          <circle cx="4" cy="8" r="3" fill="currentColor" />
          <circle cx="12" cy="8" r="3" fill="currentColor" />
          <path d="M6 8h4" stroke="currentColor" stroke-width="1.5" />
        </>
      ) : null}
      {shot === 'grape' ? [5, 11].flatMap((x) => [5, 11].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.5" fill="currentColor" />)) : null}
    </svg>
  );
}

/** Side view of a ship: hull, two masts, and sails drawn by how they're set (and how torn). */
function ShipDrawing({ sailSetting, sails }: { sailSetting: SailSetting; sails: number }) {
  const height = sailSetting === 'full' ? 1 : sailSetting === 'half' ? 0.55 : 0.12;
  const sail = (x: number) => {
    const h = 26 * height;
    return <rect x={x - 9} y={34 - h} width="18" height={h} rx="2" fill="#e7d5b3" opacity={0.5 + (0.5 * sails) / 100} />;
  };
  return (
    <svg class="panel-ship" viewBox="0 0 96 56" width="96" height="56" aria-hidden="true">
      <path d="M30 6v32M62 4v34" stroke="#4d2b32" stroke-width="2" />
      {sail(30)}
      {sail(62)}
      <path d="M6 38h84l-10 12H16z" fill="#7a4841" stroke="#3e222a" />
      <path d="M12 42h72" stroke="#c09473" stroke-width="1" />
    </svg>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const share = Math.max(0, Math.min(1, value / Math.max(1, max)));
  return (
    <div class="panel-bar">
      <span class="panel-bar-label">{label}</span>
      <span class="battle-bar-track">
        <span class={`battle-bar-fill${share < 0.3 ? ' low' : ''}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span class="panel-bar-value">
        {Math.max(0, Math.round(value))}/{Math.round(max)}
      </span>
    </div>
  );
}

/** One broadside's guns as little cannon, lit when loaded. */
function Battery({ label, loaded, of }: { label: string; loaded: number; of: number }) {
  return (
    <div class="panel-battery" title={`${label}: ${loaded} of ${of} guns loaded`}>
      <span class="panel-bar-label">{label}</span>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} class={`panel-gun${i < loaded ? ' loaded' : ''}`} />
      ))}
    </div>
  );
}

export function ShipPanel(p: ShipPanelProps) {
  return (
    <div class="ship-panel">
      <div class="panel-top">
        <ShipDrawing sailSetting={p.sailSetting} sails={p.sails} />
        <div class="panel-name">{p.name}</div>
      </div>
      <Bar label="Hull" value={p.hull} max={p.hullMax} />
      <Bar label="Sails" value={p.sails} max={100} />
      <Bar label="Crew" value={p.crew} max={p.berths} />
      <Battery label="Port" {...p.guns.port} />
      <Battery label="Stbd" {...p.guns.starboard} />
      {p.shot ? (
        <div class="panel-modes">
          {SHOTS.map((s) => (
            <button key={s.id} class={p.shot!.loaded === s.id ? 'active' : ''} title={`${s.name} shot (${s.key}, Tab cycles)`} onClick={() => p.shot!.choose(s.id)}>
              <ShotIcon shot={s.id} /> {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div class="panel-modes">
        {(['full', 'half'] as const).map((s) => (
          <button key={s} class={p.sailSetting === s ? 'active' : ''} title={s === 'full' ? 'Full sail (W)' : 'Half sail, tighter turns (S)'} onClick={() => p.setSails(s)}>
            {s === 'full' ? 'Full sail' : 'Half sail'}
          </button>
        ))}
      </div>
      {p.cruise ? (
        <div class="panel-modes">
          {[1, 2, 4].map((n) => (
            <button key={n} class={p.cruise!.speed === n ? 'active' : ''} title="Cruise speed on open sea (= and -)" onClick={() => p.cruise!.choose(n)}>
              {n}×
            </button>
          ))}
          <button disabled={!p.cruise.course} title="Drop the course and take the helm (right-click)" onClick={p.cruise.stop}>
            Stop
          </button>
        </div>
      ) : null}
    </div>
  );
}
