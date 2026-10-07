// The ship card (bottom left, at sea, in port and in battle): the one place the ship and her crew are shown.
// Her portrait, hull, sails and crew, the crew's morale and food, the purse, the chest and the hold, a row of
// cannon per broadside lit as they are loaded (after Pirates!' cannon status), and the modes to click.
// The art is the painted UI kit (./ui-art).

import type { SailSetting } from '@corsair/core';
import { ART, Art } from './ui-art';

export type Shot = 'round' | 'chain' | 'grape';

export interface ShipPanelProps {
  name: string;
  /** Her class (ship.brig), for the portrait. */
  classId: string;
  hull: number;
  hullMax: number;
  /** Sail condition, 0 to 100. */
  sails: number;
  crew: number;
  berths: number;
  /** The crew's morale (0 to 100) and its word, and the days the food will last (at sea). */
  morale?: { value: number; word: string };
  foodDays?: number;
  /** Gold in the captain's purse, the plunder chest, and the hold (at sea and in port). */
  purse?: { gold: number; chest: number; hold: number; capacity: number };
  /** Guns mounted against the most she can carry (at sea and in port). */
  mounted?: { guns: number; of: number };
  /** The rest of her fleet, and the pace its slowest ship holds her to (when it does). */
  fleet?: { name: string; classId: string; speed: number }[];
  pace?: number;
  sailSetting: SailSetting;
  /** Guns per broadside, and how many of them are loaded now (all of them at sea). */
  guns: { port: { loaded: number; of: number }; starboard: { loaded: number; of: number } };
  /** In battle: the shot loaded, and choosing another. */
  shot?: { loaded: Shot; choose: (shot: Shot) => void };
  /** Setting sail (at sea and in battle; in port there's nothing to set). */
  setSails?: (sails: SailSetting) => void;
  /** At sea: the cruise speed, and stopping a course. */
  cruise?: { speed: number; choose: (speed: number) => void; course: boolean; stop: () => void };
}

const SHOTS: { id: Shot; name: string; key: string }[] = [
  { id: 'round', name: 'Round', key: '1' },
  { id: 'chain', name: 'Chain', key: '2' },
  { id: 'grape', name: 'Grape', key: '3' },
];

/** A bar of value against max; `lowIsBad` marks it red under 30% (not for the hold: empty is fine). */
function Bar({ label, icon, value, max, lowIsBad = true }: { label: string; icon: string; value: number; max: number; lowIsBad?: boolean }) {
  const share = Math.max(0, Math.min(1, value / Math.max(1, max)));
  return (
    <div class="panel-bar" title={label}>
      <Art id={icon} class="panel-icon" />
      <span class="battle-bar-track">
        <span class={`battle-bar-fill${lowIsBad && share < 0.3 ? ' low' : ''}`} style={{ width: `${Math.round(share * 100)}%` }} />
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
        <Art key={i} id={i < loaded ? 'ui.icon.cannon_loaded' : 'ui.icon.cannon_empty'} class="panel-gun" />
      ))}
    </div>
  );
}

export function ShipPanel(p: ShipPanelProps) {
  return (
    <div class="ship-panel" style={{ borderImageSource: `url(${ART['ui.panel.frame']})` }}>
      <div class="panel-top">
        <Art id={`ui.ship.${p.classId.replace(/^ship\./, '')}`} class="panel-ship" />
        <div class="panel-name">
          {p.name}
          {p.mounted ? <div class="panel-sub">{`${p.mounted.guns} of ${p.mounted.of} guns`}</div> : null}
        </div>
      </div>
      <Bar label="Hull" icon="ui.icon.hull" value={p.hull} max={p.hullMax} />
      <Bar label="Sails" icon="ui.icon.full_sail" value={p.sails} max={100} />
      <Bar label="Crew" icon="ui.icon.crew" value={p.crew} max={p.berths} />
      {p.morale ? (
        <div class="panel-bar" title={`Morale: ${p.morale.word} (${Math.round(p.morale.value)})`}>
          <Art id="ui.icon.morale" class="panel-icon" />
          <span class="battle-bar-track">
            <span class={`battle-bar-fill${p.morale.value < 40 ? ' low' : ''}`} style={{ width: `${Math.round(p.morale.value)}%` }} />
          </span>
          <span class={`panel-bar-value${p.morale.value < 40 ? ' low' : ''}`}>{p.morale.word}</span>
        </div>
      ) : null}
      {p.foodDays !== undefined ? (
        <div class="panel-bar" title="Food aboard, in days for this crew">
          <Art id="ui.icon.food" class="panel-icon" />
          <span class={p.foodDays <= 3 ? 'low' : ''}>
            {Math.floor(p.foodDays)} {Math.floor(p.foodDays) === 1 ? 'day' : 'days'} of food
          </span>
        </div>
      ) : null}
      {p.purse ? (
        <>
          <div class="panel-bar panel-purse" title="Your purse, and the plunder chest the crew sails for">
            <Art id="ui.icon.gold" class="panel-icon" />
            <span>{p.purse.gold.toLocaleString()}</span>
            <Art id="ui.icon.chest" class="panel-icon" />
            <span>{p.purse.chest.toLocaleString()}</span>
          </div>
          <Bar label="Hold" icon="ui.icon.good.food" value={p.purse.hold} max={p.purse.capacity} lowIsBad={false} />
        </>
      ) : null}
      {p.fleet?.length ? (
        <div class="panel-fleet" title={p.fleet.map((f) => `${f.name} (${f.classId.replace(/^ship\./, '')})`).join(', ')}>
          <span>Fleet:</span>
          {p.fleet.map((f) => (
            <Art key={f.name} id={`ui.ship.${f.classId.replace(/^ship\./, '')}`} class="panel-fleet-ship" title={`${f.name} (${f.classId.replace(/^ship\./, '')})`} />
          ))}
          {p.pace !== undefined ? (
            <span class="panel-fleet-pace">
              held to {p.pace} by the {[...p.fleet].sort((a, b) => a.speed - b.speed)[0]!.classId.replace(/^ship\./, '')}
            </span>
          ) : null}
        </div>
      ) : null}
      <Battery label="Port" {...p.guns.port} />
      <Battery label="Stbd" {...p.guns.starboard} />
      {p.shot ? (
        <div class="panel-modes">
          {SHOTS.map((s) => (
            <button key={s.id} class={p.shot!.loaded === s.id ? 'active' : ''} title={`${s.name} shot (${s.key}, Tab cycles)`} onClick={() => p.shot!.choose(s.id)}>
              <Art id={`ui.icon.${s.id}_shot`} class="panel-icon" /> {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {p.setSails ? (
        <div class="panel-modes">
          {(['full', 'half'] as const).map((s) => (
            <button key={s} class={p.sailSetting === s ? 'active' : ''} title={s === 'full' ? 'Full sail (W)' : 'Half sail, tighter turns (S)'} onClick={() => p.setSails!(s)}>
              <Art id={s === 'full' ? 'ui.icon.full_sail' : 'ui.icon.half_sail'} class="panel-icon" /> {s === 'full' ? 'Full sail' : 'Half sail'}
            </button>
          ))}
        </div>
      ) : null}
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
