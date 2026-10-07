import { useEffect, useState } from 'preact/hooks';
import type { BattleResult, Command } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import type { Aim, Broadside, BattleShip, BattleState } from '@corsair/minigame-sea-battle';
import { ShipPanel } from './panel';
import { GoodIcon } from './ui-art';
import type { ShipPanelProps } from './panel';

// The sea battle HUD (scenes doc S3): both ships' hull, sails and crew, the ammo loaded, each
// broadside's reload, a marker on the screen edge pointing to an enemy out of sight, the warning as
// the ships draw apart, and the report when the fight is over.

const OUTCOME: Record<BattleResult['outcome'], string> = {
  sunk: 'She goes down by the head, and her cargo with her.',
  struck: 'She strikes her colours! Her purse is yours; choose what to take from her hold.',
  boarded: 'Your men carry her deck. She is your prize: her purse is yours; choose what to take from her hold.',
  escaped: 'She draws clear and slips away over the horizon.',
  fled: 'You break off and leave her astern. She will remember your colours.',
  lost: 'You are beaten and forced to strike. They let you go, but not empty-handed.',
};

const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands', pirate: 'the pirates' };

/** What the fight changed (the world's BattleOver event): the after-action report reads it line by line. */
export interface BattleReport {
  outcome: BattleResult['outcome'];
  nation: string;
  role: string;
  purse: number;
  salvageGold: number;
  rescued: number;
  menLost: number;
  volunteers: number;
  moraleBefore: number;
  morale: number;
  standing: Record<string, number>;
  lost: { gold: number; chest: number; cargo: Record<string, number> };
}

/** A prize waiting on the plunder screen: her hold, the men who would sign on, and the player's own hold. */
export interface PlunderOffer {
  theirs: Record<string, number>;
  volunteers: number;
  mine: Record<string, number>;
  capacity: number;
}

export type PlunderChoice = Omit<Extract<Command, { type: 'TakePlunder' }>, 'type' | 'shipId'>;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const goodsText = (content: ContentPack, goods: Record<string, number>) =>
  Object.entries(goods)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${content.goods.find((x) => x.id === g)?.name.toLowerCase() ?? g}`)
    .join(', ');

/** The report's lines: what was won, what was lost, and what the world thinks of it. */
function reportLines(content: ContentPack, r: BattleReport, attacked: boolean): string[] {
  const lines: string[] = [];
  if (r.purse) lines.push(`Her purse: ${r.purse} gold into the plunder chest.`);
  if (r.salvageGold || r.rescued) {
    const bits = [r.salvageGold ? `${r.salvageGold} gold from the barrels` : '', r.rescued ? `${r.rescued} men out of the water join you` : ''].filter(Boolean);
    lines.push(`From the wreck: ${bits.join('; ')}.`);
  }
  if (r.lost.chest) lines.push(`The pirates took the plunder chest: ${r.lost.chest} gold.`);
  if (goodsText(content, r.lost.cargo)) lines.push(`They emptied your hold: ${goodsText(content, r.lost.cargo)}.`);
  if (r.lost.gold) lines.push(`Her captain fined you ${r.lost.gold} gold.`);
  if (r.menLost) lines.push(`Men lost: ${r.menLost}.`);
  if (r.morale !== r.moraleBefore) lines.push(`Crew morale ${r.moraleBefore} to ${r.morale}.`);
  const standing = Object.entries(r.standing).map(([n, d]) => `${COUNTRY[n] ?? n} ${signed(d)}`);
  if (attacked && r.nation !== 'pirate') standing.unshift(`${COUNTRY[r.nation]} ${signed(content.combat.standing.attack)} for the attack`);
  if (standing.length) lines.push(`Standing: ${standing.join(', ')}.`);
  if (r.outcome === 'sunk' || r.outcome === 'struck' || r.outcome === 'boarded') {
    lines.push(r.nation === 'pirate' ? 'Any governor pays a bounty for her.' : `Governors at war with ${COUNTRY[r.nation]} pay a bounty for her.`);
  }
  return lines;
}

/** Her hold the most valuable first, as much as the room allows: the plunder screen's starting choice. */
function bestTake(content: ContentPack, theirs: Record<string, number>, room: number) {
  const take: Record<string, number> = {};
  const value = (g: string) => content.goods.find((x) => x.id === g)?.basePrice ?? 0;
  for (const g of Object.keys(theirs).sort((a, b) => value(b) - value(a))) {
    const n = Math.min(theirs[g]!, room);
    if (n > 0) take[g] = n;
    room -= n;
  }
  return take;
}

/**
 * The plunder screen (Pirates! 2004): pick what comes aboard from her hold, throw your own over the side to
 * make room, sign the volunteers on or put them ashore, then sink her (Enter) or let her go (L).
 */
function Plunder({ content, offer, onPlunder }: { content: ContentPack; offer: PlunderOffer; onPlunder: (choice: PlunderChoice) => void }) {
  const used = Object.values(offer.mine).reduce((a, b) => a + b, 0);
  const [take, setTake] = useState(() => bestTake(content, offer.theirs, offer.capacity - used));
  const [jettison, setJettison] = useState<Record<string, number>>({});
  const [volunteers, setVolunteers] = useState(offer.volunteers > 0);
  const thrown = Object.values(jettison).reduce((a, b) => a + b, 0);
  const taking = Object.values(take).reduce((a, b) => a + b, 0);
  const room = offer.capacity - used + thrown - taking;
  const choose = (release: boolean) => onPlunder({ take, jettison, volunteers, release });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Enter') choose(false);
      else if (e.key.toLowerCase() === 'l') choose(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const name = (g: string) => content.goods.find((x) => x.id === g)?.name ?? g;
  const step = (n: number) => Math.max(1, Math.ceil(n / 4));
  return (
    <div class="plunder">
      <div class="plunder-hold">
        Your hold {used - thrown + taking} / {offer.capacity}
      </div>
      {Object.keys(offer.theirs).length ? null : <div>Her hold is empty.</div>}
      <table>
        <tbody>
          {Object.entries(offer.theirs).map(([g, n]) => (
            <tr key={g} class="plunder-take">
              <td>
                <GoodIcon id={g} /> {name(g)}
              </td>
              <td>her {n}</td>
              <td>
                <button onClick={() => setTake({ ...take, [g]: Math.max(0, (take[g] ?? 0) - step(n)) })}>−</button>
                <span class="plunder-n">take {take[g] ?? 0}</span>
                <button onClick={() => setTake({ ...take, [g]: Math.min(n, (take[g] ?? 0) + Math.min(step(n), room)) })}>+</button>
              </td>
            </tr>
          ))}
          {Object.entries(offer.mine).map(([g, n]) => (
            <tr key={`mine-${g}`} class="plunder-throw">
              <td>
                <GoodIcon id={g} /> {name(g)}
              </td>
              <td>yours {n}</td>
              <td>
                <button onClick={() => setJettison({ ...jettison, [g]: Math.max(0, (jettison[g] ?? 0) - step(n)) })}>−</button>
                <span class="plunder-n">over the side {jettison[g] ?? 0}</span>
                <button onClick={() => setJettison({ ...jettison, [g]: Math.min(n, (jettison[g] ?? 0) + step(n)) })}>+</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {offer.volunteers > 0 ? (
        <label class="plunder-volunteers">
          <input type="checkbox" checked={volunteers} onChange={() => setVolunteers(!volunteers)} /> {offer.volunteers} of her men will sign on (more mouths, thinner shares)
        </label>
      ) : null}
      <div class="plunder-actions">
        <button class="leave" onClick={() => choose(false)}>
          Take it and sink her · Enter
        </button>
        <button onClick={() => choose(true)}>Take it and let her go · L</button>
      </div>
    </div>
  );
}

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
  /** She may strike any moment now. */
  wavering: boolean;
  /** The after-action report, once the fight's result has reached the world. */
  report?: BattleReport;
  /** The player started the fight (an attack on a nation's ship costs standing with it). */
  attacked: boolean;
  /** A prize waiting on the plunder screen. */
  offer?: PlunderOffer;
  onPlunder: (choice: PlunderChoice) => void;
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

export function BattleHud({ state, content, enemyName, enemyTitle, reloadSeconds, aim, panel, view, wavering, report, attacked, offer, onPlunder, onContinue }: BattleHudProps) {
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
      {state.result || state.wreck ? null : <EnemyMarker state={state} view={view} />}
      {wavering ? <div class="battle-parting battle-waver">She's wavering: keep at her and she'll strike</div> : null}
      {state.wreck && !state.result ? (
        <div class="battle-parting battle-wreck">
          <span>
            She's gone down. Sail over the barrels and the men in the water ({state.wreck.gold} gold, {state.wreck.men} men so far) · Enter to leave the
            wreck
          </span>
          <span class="battle-bar-track">
            <span class="battle-bar-fill" style={{ width: `${Math.round(Math.max(0, (state.wreck.until - state.tick / 30) / content.combat.salvage.seconds) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      {!state.result && !state.wreck && apart > b.warnTiles ? (
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
          {report ? (
            <ul class="battle-ledger">
              {reportLines(content, report, attacked).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p class="port-sub">
            Your crew: {state.result.player.crew}. Hull {state.result.player.hull}, sails {state.result.player.sailCondition}%.
          </p>
          {offer ? (
            <Plunder content={content} offer={offer} onPlunder={onPlunder} />
          ) : (
            <button class="leave" onClick={onContinue}>
              Continue · Enter
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
