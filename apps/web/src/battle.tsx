import type { BattleResult } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import type { Ammo, BattleShip, BattleState } from '@corsair/minigame-sea-battle';

// The sea battle HUD (scenes doc S3): both ships' hull, sails and crew, the ammo loaded, each
// broadside's reload, and the report when the fight is over.

const AMMO: { id: Ammo; key: string; name: string; hint: string }[] = [
  { id: 'round', key: '1', name: 'Round', hint: 'hull' },
  { id: 'chain', key: '2', name: 'Chain', hint: 'sails' },
  { id: 'grape', key: '3', name: 'Grape', hint: 'crew, close' },
];

const OUTCOME: Record<BattleResult['outcome'], string> = {
  sunk: 'She goes down by the head, and her cargo with her.',
  struck: 'She strikes her colours! Her purse and what cargo your hold can take are yours.',
  boarded: 'Your men carry her deck. She is your prize: her purse and what cargo your hold can take are yours.',
  escaped: 'She slips away, and you let her go.',
  lost: 'You are beaten and forced to strike. They let you go, but not empty-handed.',
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
  playerTitle: string;
  enemyName: string;
  enemyTitle: string;
  reloadSeconds: number;
  onContinue: () => void;
}

export function BattleHud({ state, playerTitle, enemyName, enemyTitle, reloadSeconds, onContinue }: BattleHudProps) {
  const me = state.ships.player;
  const reload = (side: 'port' | 'starboard') => 1 - Math.min(1, me.reload[side] / reloadSeconds);
  return (
    <div class="battle">
      <ShipCard ship={me} title={playerTitle} name="Your ship" />
      <div class="battle-card battle-enemy">
        <ShipCard ship={state.ships.enemy} title={enemyTitle} name={enemyName} />
      </div>
      <div class="battle-bottom">
        <div class="battle-ammo">
          {AMMO.map((a) => (
            <span key={a.id} class={me.ammo === a.id ? 'active' : ''} title={a.hint}>
              {a.key} {a.name}
            </span>
          ))}
        </div>
        <div class="battle-guns">
          {(['port', 'starboard'] as const).map((side) => (
            <span key={side} class="battle-gun">
              {side === 'port' ? 'Q port' : 'E starboard'}
              <span class="battle-bar-track">
                <span class={`battle-bar-fill${reload(side) >= 1 ? ' ready' : ''}`} style={{ width: `${Math.round(reload(side) * 100)}%` }} />
              </span>
            </span>
          ))}
        </div>
        <div class="battle-keys">A/D steer · W/S sails · Q/E fire · 1–3 ammo · board by laying her alongside</div>
      </div>
      {state.result ? (
        <div class="battle-report">
          <div class="port-name">{state.result.outcome === 'lost' ? 'Defeat' : state.result.outcome === 'escaped' ? 'She got away' : 'Victory'}</div>
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
