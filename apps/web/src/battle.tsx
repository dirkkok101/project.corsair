import type { BattleResult } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import type { Aim, Broadside, BattleShip, BattleState } from '@corsair/minigame-sea-battle';
import { ShipPanel } from './panel';
import type { ShipPanelProps } from './panel';

// The sea battle HUD (scenes doc S3): both ships' hull, sails and crew, the ammo loaded, each
// broadside's reload, a marker on the screen edge pointing to an enemy out of sight, the warning as
// the ships draw apart, and the report when the fight is over.

const OUTCOME: Record<BattleResult['outcome'], string> = {
  sunk: 'She goes down by the head, and her cargo with her.',
  struck: 'She strikes her colours! Her purse and what cargo your hold can take are yours.',
  boarded: 'Your men carry her deck. She is your prize: her purse and what cargo your hold can take are yours.',
  escaped: 'She draws clear and slips away over the horizon.',
  fled: 'You break off and leave her astern. She will remember your colours.',
  lost: 'You are beaten and forced to strike. They let you go, but not empty-handed.',
};

const AIM: Record<Aim, string> = {
  ready: 'fire!',
  loading: 'loading',
  'no-target': 'not bearing',
  'out-of-range': 'out of range',
  'no-guns': 'no guns',
};

const TITLE: Record<BattleResult['outcome'], string> = {
  sunk: 'Victory',
  struck: 'Victory',
  boarded: 'Victory',
  escaped: 'She got away',
  fled: 'You broke off',
  lost: 'Defeat',
};

function Bar({ label, value, max, unit = '' }: { label: string; value: number; max: number; unit?: string }) {
  const share = Math.max(0, Math.min(1, value / max));
  return (
    <div class="battle-bar">
      <span class="battle-bar-label">{label}</span>
      <span class="battle-bar-track">
        <span class={`battle-bar-fill${share < 0.3 ? ' low' : ''}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span class="battle-bar-value">
        {Math.max(0, Math.round(value))}
        {unit}
      </span>
    </div>
  );
}

function ShipCard({ ship, title, name }: { ship: BattleShip; title: string; name: string }) {
  return (
    <div class="battle-card">
      <div class="battle-name">{name}</div>
      <div class="battle-title">{title}</div>
      <Bar label="Hull" value={ship.hull} max={ship.hullMax} />
      <Bar label="Sails" value={ship.sailCondition} max={100} unit="%" />
      <Bar label="Crew" value={ship.crew} max={Math.max(ship.crewStart, 1)} />
      <div class="battle-title">{ship.guns} guns</div>
    </div>
  );
}

export interface BattleHudProps {
  state: BattleState;
  content: ContentPack;
  enemyName: string;
  enemyTitle: string;
  reloadSeconds: number;
  /** Each broadside: ready, or why it can't fire. */
  aim: Record<Broadside, Aim>;
  /** The player's ship panel, with its mode buttons. */
  panel: ShipPanelProps;
  /** The battle view in CSS pixels (the player's ship is at its centre), and CSS pixels per tile. */
  view: { w: number; h: number; pxPerTile: number };
  onContinue: () => void;
}

// How far inside each screen edge the off-screen marker sits: clear of the warning at the top and the
// guns bar at the bottom.
const EDGE = { side: 34, top: 70, bottom: 110 };

/** An arrow at the screen edge on the line to the enemy, with how far off she is, when she is out of sight. */
function EnemyMarker({ state, view }: { state: BattleState; view: BattleHudProps['view'] }) {
  const dx = (state.ships.enemy.x - state.ships.player.x) * view.pxPerTile;
  const dy = (state.ships.enemy.y - state.ships.player.y) * view.pxPerTile;
  if (Math.abs(dx) < view.w / 2 && Math.abs(dy) < view.h / 2) return null;
  // Walk from the centre toward her until the inset screen edge.
  const t = Math.min((view.w / 2 - EDGE.side) / Math.max(1e-6, Math.abs(dx)), (view.h / 2 - (dy > 0 ? EDGE.bottom : EDGE.top)) / Math.max(1e-6, Math.abs(dy)));
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const tiles = Math.round(Math.hypot(dx, dy) / view.pxPerTile);
  return (
    <div class="battle-marker" style={{ left: `${view.w / 2 + dx * t}px`, top: `${view.h / 2 + dy * t}px` }}>
      <span class="battle-marker-arrow" style={{ transform: `rotate(${deg}deg)` }} />
      <span class="battle-marker-distance">{tiles}</span>
    </div>
  );
}

export function BattleHud({ state, content, enemyName, enemyTitle, reloadSeconds, aim, panel, view, onContinue }: BattleHudProps) {
  const me = state.ships.player;
  const b = content.combat.battle;
  const apart = Math.hypot(state.ships.enemy.x - me.x, state.ships.enemy.y - me.y);
  const reload = (side: 'port' | 'starboard') => 1 - Math.min(1, me.reload[side] / reloadSeconds);
  return (
    <div class="battle">
      <ShipPanel {...panel} />
      <div class="battle-card battle-enemy">
        <ShipCard ship={state.ships.enemy} title={enemyTitle} name={enemyName} />
      </div>
      {state.result ? null : <EnemyMarker state={state} view={view} />}
      {!state.result && apart > b.warnTiles ? (
        <div class="battle-parting">
          <span>{apart > b.escapeTiles ? 'Drawing apart: close in or she is gone' : 'Drawing apart'}</span>
          <span class="battle-bar-track">
            <span class="battle-bar-fill low" style={{ width: `${Math.round(Math.min(1, state.parting / b.escapeSeconds) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      {!state.result && state.grappling > 0 ? (
        <div class="battle-parting battle-grapple">
          <span>Grappled! Sail clear to cut free, or stand by to repel boarders</span>
          <span class="battle-bar-track">
            <span class="battle-bar-fill low" style={{ width: `${Math.round(Math.min(1, state.grappling / b.grappleSeconds) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      <div class="battle-bottom">
        <div class="battle-guns">
          {(['port', 'starboard'] as const).map((side) => (
            <span key={side} class="battle-gun">
              {side === 'port' ? 'Port' : 'Starboard'}
              <span class="battle-bar-track">
                <span class={`battle-bar-fill${reload(side) >= 1 ? ' ready' : ''}`} style={{ width: `${Math.round(reload(side) * 100)}%` }} />
              </span>
              <span class={`battle-aim${aim[side] === 'ready' ? ' ready' : ''}`}>{AIM[aim[side]]}</span>
            </span>
          ))}
        </div>
        <div class="battle-keys">Space fire (hold to fire as she bears) · Tab shot · A/D steer · W/S sails · board by laying her alongside</div>
      </div>
      {state.result ? (
        <div class="battle-report">
          <div class="port-name">{TITLE[state.result.outcome]}</div>
          <p>{OUTCOME[state.result.outcome]}</p>
          <p class="port-sub">
            Your crew: {state.result.player.crew}. Hull {state.result.player.hull}, sails {state.result.player.sailCondition}%.
          </p>
          <button class="leave" onClick={onContinue}>
            Continue · Enter
          </button>
        </div>
      ) : null}
    </div>
  );
}
