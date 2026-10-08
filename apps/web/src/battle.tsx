import { useEffect, useRef, useState } from 'preact/hooks';
import type { BattleResult, Command } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import type { Aim, Broadside, BattleShip, BattleState } from '@corsair/minigame-sea-battle';
import { Compass } from './hud';
import type { CompassProps } from './hud';
import { ShipPanel } from './panel';
import { Art, GoodIcon, shipIcon, shipKind } from './ui-art';
import type { ShipPanelProps } from './panel';

// The sea battle HUD (scenes doc S3): both ships' hull, sails and crew, the ammo loaded, each
// broadside's reload, a marker on the screen edge pointing to an enemy out of sight, the warning as
// the ships draw apart, and the report when the fight is over.

const OUTCOME: Record<BattleResult['outcome'], string> = {
  sunk: 'She goes down by the head, and her cargo with her.',
  struck: 'She strikes her colours! She is your prize.',
  boarded: 'Your men carry her deck. She is your prize.',
  escaped: 'She draws clear and slips away over the horizon.',
  fled: 'You break off and leave her astern. She will remember your colours.',
  lost: 'You are beaten and forced to strike. They let you go, but not empty-handed.',
};

/** The painted picture for each ending (art/sources/paintings/README.md, group outcomes). */
const PICTURES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../../art/game/scenes/outcome.*.png', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.png$/, ''),
    url,
  ]),
);
const PICTURE: Record<BattleResult['outcome'], string> = {
  sunk: 'outcome.sunk',
  struck: 'outcome.taken',
  boarded: 'outcome.taken',
  escaped: 'outcome.escaped',
  fled: 'outcome.escaped',
  lost: 'outcome.lost',
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
  lost: { gold: number; chest: number; cargo: Record<string, number>; ship?: { name: string; classId: string }; men?: number; boundFor?: string };
  /** Ships of the player's she had in tow: back in the fleet, or laid up in port when there was no room. */
  retaken?: { name: string; classId: string }[];
  laidUp?: { name: string; classId: string; at: string }[];
}

/** A prize waiting on the plunder screen: her hold, the men who would sign on, and the player's own hold. */
export interface PlunderOffer {
  theirs: Record<string, number>;
  volunteers: number;
  mine: Record<string, number>;
  capacity: number;
  /** Who she is: her role and nation decide what letting her go or sinking her means. */
  role: string;
  nation: string;
  /** Days of food aboard now, and with the volunteers signed on. */
  foodNow: number;
  foodWith: number;
  /** Keeping her: her hold, the men she needs and her speed, and why she can't be kept, if not. */
  /** Her pace as she is (her damage slows her), and once a shipwright has mended her. */
  keep: { hold: number; minCrew: number; speed: number; fullSpeed: number; whyNot?: string };
}

export type PlunderChoice = Omit<Extract<Command, { type: 'TakePlunder' }>, 'type' | 'shipId'>;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const goodName = (content: ContentPack, g: string) => content.goods.find((x) => x.id === g)?.name.toLowerCase() ?? g;
const goodsText = (content: ContentPack, goods: Record<string, number>) =>
  Object.entries(goods)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${goodName(content, g)}`)
    .join(', ');
const worth = (content: ContentPack, goods: Record<string, number>) =>
  Object.entries(goods).reduce((n, [g, u]) => n + (content.goods.find((x) => x.id === g)?.basePrice ?? 0) * u, 0);

interface Row {
  icon: string;
  text: string;
  tone?: 'good' | 'bad';
}

/** The report, a row each: what was won, what was lost, and what it did to the crew. */
function reportRows(content: ContentPack, r: BattleReport): Row[] {
  const rows: Row[] = [];
  if (r.purse) rows.push({ icon: 'ui.icon.chest', text: `+${r.purse} gold from her purse, into the plunder chest`, tone: 'good' });
  if (r.salvageGold) rows.push({ icon: 'ui.icon.gold', text: `+${r.salvageGold} gold from the barrels, into the plunder chest`, tone: 'good' });
  if (r.rescued) rows.push({ icon: 'ui.icon.crew', text: `+${r.rescued} men pulled from the water join your crew`, tone: 'good' });
  if (r.lost.chest) rows.push({ icon: 'ui.icon.chest', text: `−${r.lost.chest} gold: the pirates took the plunder chest`, tone: 'bad' });
  const cargo = goodsText(content, r.lost.cargo);
  if (cargo) rows.push({ icon: 'ui.icon.good.luxuries', text: `They emptied your hold: ${cargo}${r.lost.cargo.food ? '' : ' (they left the food)'}`, tone: 'bad' });
  const kind = shipKind;
  if (r.lost.ship) {
    rows.push({
      icon: shipIcon(content, r.lost.ship.classId),
      text: `They took your ${kind(r.lost.ship.classId)} ${r.lost.ship.name}${r.lost.men ? ` and ${r.lost.men} men with her` : ''}${
        r.lost.boundFor ? `. She's bound for ${r.lost.boundFor}: catch her before she's sold there` : ''
      }`,
      tone: 'bad',
    });
  }
  for (const s of r.retaken ?? []) rows.push({ icon: shipIcon(content, s.classId), text: `Your ${kind(s.classId)} ${s.name} is yours again: she rejoins the fleet`, tone: 'good' });
  for (const s of r.laidUp ?? []) {
    rows.push({ icon: shipIcon(content, s.classId), text: `Your ${kind(s.classId)} ${s.name} is free, but you've no room or men to sail her: she lies at ${s.at} for you to collect`, tone: 'good' });
  }
  if (r.lost.gold) rows.push({ icon: 'ui.icon.gold', text: `−${r.lost.gold} gold: her captain fined your purse`, tone: 'bad' });
  if (r.menLost) rows.push({ icon: 'ui.icon.crew', text: `−${r.menLost} men killed or wounded`, tone: 'bad' });
  if (r.morale !== r.moraleBefore) {
    rows.push({ icon: 'ui.icon.morale', text: `Crew morale ${r.moraleBefore} → ${r.morale}`, tone: r.morale > r.moraleBefore ? 'good' : 'bad' });
  }
  if (r.outcome === 'sunk' || r.outcome === 'struck' || r.outcome === 'boarded') {
    rows.push({
      icon: 'ui.icon.gold',
      text: r.nation === 'pirate' ? 'A bounty: any governor pays for her' : `A bounty: governors at war with ${COUNTRY[r.nation]} pay for her`,
      tone: 'good',
    });
  }
  return rows;
}

/** Standing with each nation the fight moved, attack included, as chips. */
function standingChips(content: ContentPack, r: BattleReport, attacked: boolean) {
  const chips = Object.entries(r.standing).map(([n, d]) => ({ name: COUNTRY[n] ?? n, d }));
  if (attacked && r.nation !== 'pirate') chips.unshift({ name: `${COUNTRY[r.nation]} (for the attack)`, d: content.combat.standing.attack });
  return chips;
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

/** What her fate means, in a line, for the choice on the plunder screen. */
function fateText(content: ContentPack, offer: PlunderOffer, release: boolean, keep: boolean) {
  if (keep) {
    const pace =
      offer.keep.speed < offer.keep.fullSpeed
        ? `her shot-through sails slow her to ${offer.keep.speed} (${offer.keep.fullSpeed} once a shipwright mends them), and the fleet sails at its slowest ship's pace`
        : `the fleet sails at its slowest ship's pace (hers is ${offer.keep.speed})`;
    return `She joins your fleet: +${offer.keep.hold} tons of hold, ${offer.keep.minCrew} of your men to sail her; ${pace}.${
      offer.nation === 'pirate' ? '' : ` ${COUNTRY[offer.nation] ?? offer.nation} hears of it (${signed(content.combat.standing.scuttle)}).`
    }`;
  }
  if (offer.nation === 'pirate') return release ? 'She goes back to raiding these waters.' : 'One pirate fewer at sea.';
  const nation = COUNTRY[offer.nation] ?? offer.nation;
  return release
    ? `She sails home with what's left in her hold, and ${nation} thinks a little better of you (${signed(content.combat.standing.mercy)}).`
    : `No one sails home to tell it kindly: ${nation} thinks worse of you (${signed(content.combat.standing.scuttle)}).`;
}

/**
 * The plunder screen (Pirates! 2004), made easy: one button takes the best of her hold, signs on her
 * volunteers and settles her fate (Enter); each choice says what it means; picking goods by hand, or
 * throwing your own over to make room, is there for whoever wants it.
 */
function Plunder({ content, offer, onPlunder }: { content: ContentPack; offer: PlunderOffer; onPlunder: (choice: PlunderChoice) => void }) {
  const used = Object.values(offer.mine).reduce((a, b) => a + b, 0);
  const [take, setTake] = useState(() => bestTake(content, offer.theirs, offer.capacity - used));
  const [jettison, setJettison] = useState<Record<string, number>>({});
  const [volunteers, setVolunteers] = useState(offer.volunteers > 0);
  // A pirate is best sunk; a merchant let go (her nation hears of it either way).
  const [release, setRelease] = useState(offer.nation !== 'pirate');
  const [keep, setKeep] = useState(false);
  const [byHand, setByHand] = useState(false);
  const thrown = Object.values(jettison).reduce((a, b) => a + b, 0);
  const taking = Object.values(take).reduce((a, b) => a + b, 0);
  // Kept, her hold joins the fleet's.
  const room = offer.capacity + (keep ? offer.keep.hold : 0) - used + thrown - taking;
  const herUnits = Object.values(offer.theirs).reduce((a, b) => a + b, 0);
  // Taking the most her hold allows: with her own hold kept, all of hers fits.
  const choose = () => onPlunder({ take: keep ? { ...offer.theirs } : take, jettison, volunteers, release, keep });
  // Enter takes whatever is chosen at that moment: the listener, set once, reads the latest choice (a listener
  // rebound after each render could answer with the choice before the last click).
  const latest = useRef(choose);
  latest.current = choose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.repeat && e.key === 'Enter') latest.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const name = (g: string) => content.goods.find((x) => x.id === g)?.name ?? g;
  const step = (n: number) => Math.max(1, Math.ceil(n / 4));
  return (
    <div class="plunder">
      <div class="plunder-row">
        <Art id="ui.icon.good.luxuries" class="plunder-icon" />
        <div>
          {herUnits ? (
            <>
              <div>
                Taking {goodsText(content, take) || 'nothing'}
                {taking ? ` (worth about ${worth(content, take).toLocaleString()} gold)` : ''}
              </div>
              {herUnits > taking ? <div class="plunder-note">{herUnits - taking} left in her hold: no room in yours. Choose the goods yourself to make room.</div> : null}
            </>
          ) : (
            <div>Her hold is empty: her purse was all she carried.</div>
          )}
        </div>
      </div>
      {offer.volunteers > 0 ? (
        <label class="plunder-row">
          <Art id="ui.icon.crew" class="plunder-icon" />
          <div>
            <div>
              <input type="checkbox" checked={volunteers} onChange={() => setVolunteers(!volunteers)} /> Sign on {offer.volunteers} of her men
            </div>
            <div class="plunder-note">
              {volunteers
                ? `Stronger boarders and faster reloads${
                    Math.floor(offer.foodWith) < Math.floor(offer.foodNow) ? `; food lasts ${Math.floor(offer.foodWith)} days instead of ${Math.floor(offer.foodNow)}` : ''
                  }, and the plunder is split more ways.`
                : 'They are put ashore.'}
            </div>
          </div>
        </label>
      ) : null}
      <div class="plunder-row">
        <Art id="ui.icon.anchor" class="plunder-icon" />
        <div>
          <div class="plunder-fate">
            <button class={release && !keep ? 'active' : ''} onClick={() => (setRelease(true), setKeep(false))}>
              Let her go
            </button>
            <button class={!release && !keep ? 'active' : ''} onClick={() => (setRelease(false), setKeep(false))}>
              Sink her
            </button>
            <button class={keep ? 'active' : ''} disabled={Boolean(offer.keep.whyNot)} title={offer.keep.whyNot} onClick={() => setKeep(true)}>
              Keep her
            </button>
          </div>
          <div class="plunder-note">{offer.keep.whyNot && keep ? offer.keep.whyNot : fateText(content, offer, release, keep)}</div>
          {offer.keep.whyNot ? <div class="plunder-note">Keep her: {offer.keep.whyNot}</div> : null}
        </div>
      </div>
      {herUnits ? (
        <button class="plunder-toggle" onClick={() => setByHand(!byHand)}>
          {byHand ? '▾' : '▸'} Choose the goods myself
        </button>
      ) : null}
      {byHand ? (
        <div class="plunder-hand">
          <div class="plunder-hold">
            Your hold {used - thrown + taking} / {offer.capacity}
          </div>
          <table>
            <tbody>
              {Object.entries(offer.theirs).map(([g, n]) => (
                <tr key={g} class="plunder-take">
                  <td>
                    <GoodIcon id={g} /> {name(g)}
                  </td>
                  <td>hers {n}</td>
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
        </div>
      ) : null}
      <button class="leave plunder-go" onClick={choose}>
        {keep ? 'Take her into the fleet' : (
          <>
            {herUnits ? 'Take it and ' : ''}
            {release ? (herUnits ? 'let her go' : 'Let her go') : herUnits ? 'sink her' : 'Sink her'}
          </>
        )}{' '}
        · Enter
      </button>
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

/** A ship's masts by name, fore to aft. */
const MAST_NAMES: Record<number, string[]> = { 1: ['mast'], 2: ['foremast', 'mainmast'], 3: ['foremast', 'mainmast', 'mizzen'] };

function ShipCard({ ship, title, name }: { ship: BattleShip; title: string; name: string }) {
  const up = ship.masts.filter((m) => m > 0).length;
  return (
    <div class="battle-card">
      <div class="battle-name">{name}</div>
      <div class="battle-title">{title}</div>
      <Bar label="Hull" value={ship.hull} max={ship.hullMax} />
      <Bar label="Sails" value={ship.sailCondition} max={100} unit="%" />
      <Bar label="Crew" value={ship.crew} max={Math.max(ship.crewStart, 1)} />
      <div class="battle-title">
        {ship.guns} guns{up < ship.masts.length ? ` · ${up} of ${ship.masts.length} masts standing` : ''}
      </div>
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
  /** What to do next, after a fight that left her hurt (where to repair). */
  advice?: string;
  /** The compass: the wind on the battle water, her heading, speed and point of sail. */
  compass: CompassProps;
  /** Boarding: the chance the player's boarders carry her deck now, and whether "close to board" is on. */
  board: { odds: number; active: boolean };
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

export function BattleHud({ state, content, enemyName, enemyTitle, reloadSeconds, aim, panel, view, wavering, report, attacked, offer, advice, compass, board, onPlunder, onContinue }: BattleHudProps) {
  const me = state.ships.player;
  const b = content.combat.battle;
  const apart = Math.hypot(state.ships.enemy.x - me.x, state.ships.enemy.y - me.y);
  const reload = (side: 'port' | 'starboard') => 1 - Math.min(1, me.reload[side] / reloadSeconds);
  // A mast going by the board, called out for a few seconds (the sim's own record of it lasts a moment).
  const mastCall = useRef<{ text: string; until: number; seen: number }>({ text: '', until: -1, seen: -1 });
  const now = state.tick / 30;
  for (const e of state.effects) {
    if (e.kind !== 'mast' || e.at <= mastCall.current.seen || e.mast === undefined || !e.ship) continue;
    const masts = state.ships[e.ship].masts.length;
    const mast = MAST_NAMES[masts]?.[e.mast] ?? 'mast';
    const text = e.ship === 'enemy' ? `Her ${mast} goes by the board!` : `Your ${mast} is shot away!`;
    mastCall.current = { text, until: e.at + 3.5, seen: e.at };
  }
  return (
    <div class="battle">
      <ShipPanel {...panel} />
      <div class="battle-card battle-enemy">
        <ShipCard ship={state.ships.enemy} title={enemyTitle} name={enemyName} />
      </div>
      {state.result || state.wreck ? null : <EnemyMarker state={state} view={view} />}
      {state.result ? null : <Compass {...compass} className="battle-compass" />}
      {!state.result && !state.wreck && state.grappling === 0 && (board.active || (apart <= 12 && board.odds >= 0.5)) ? (
        <div class="battle-parting battle-board">
          {board.active
            ? `Closing to board: your boarders would carry her about ${Math.round(board.odds * 100)}% of the time · G or the helm to stop`
            : `Board her · G: your boarders would carry her about ${Math.round(board.odds * 100)}% of the time`}
        </div>
      ) : null}
      {wavering ? <div class="battle-parting battle-waver">She's wavering: keep at her and she'll strike</div> : null}
      {!state.result && now < mastCall.current.until ? <div class="battle-parting battle-mast">{mastCall.current.text}</div> : null}
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
        <div class="battle-keys">Space fire (hold to fire as she bears) · Tab or 1 to 3 shot · A/D steer · W/S sails · G close to board</div>
      </div>
      {state.result ? (
        <div class="battle-report">
          <div class="battle-report-head">
            {PICTURES[PICTURE[state.result.outcome]] ? <img class="battle-report-picture" src={PICTURES[PICTURE[state.result.outcome]]} alt="" /> : null}
            <div class="battle-report-text">
              <div class="port-name">{TITLE[state.result.outcome]}</div>
              <p>{OUTCOME[state.result.outcome]}</p>
              {report ? (
                <ul class="battle-ledger">
                  {reportRows(content, report).map((row) => (
                    <li key={row.text} class={row.tone ?? ''}>
                      <Art id={row.icon} class="inline-icon" /> {row.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {report && standingChips(content, report, attacked).length ? (
                <div class="battle-standing">
                  Standing:{' '}
                  {standingChips(content, report, attacked).map((c) => (
                    <span key={c.name} class={`chip ${c.d > 0 ? 'good' : 'bad'}`}>
                      {c.name} {signed(c.d)}
                    </span>
                  ))}
                </div>
              ) : null}
              <p class="port-sub">
                Your ship: {state.result.player.crew} men · hull {state.result.player.hull} · sails {state.result.player.sailCondition}%
              </p>
              {advice ? <p class="battle-advice">{advice}</p> : null}
            </div>
          </div>
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
