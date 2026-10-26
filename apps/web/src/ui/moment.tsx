import type { WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { hoardRing, rungBrings } from '@corsair/systems-economy';
import { topTen } from '@corsair/systems-traffic';
import { useEffect } from 'preact/hooks';
import { Parchment, quartersHeld, waterNear } from '../log';
import { ART } from '../ui-art';
import { Bust, curly, Key } from './kit';
import { OrdersList } from '../voyage';
import type { Order } from '../voyage';

// Moments (storyboard 2.13): short full-screen beats that reward and then get out of the way, one at a time from a
// queue, the world stopped while one shows. Enter or Escape closes one.

export type Moment =
  /** News that matters (war, peace): a dated letter, its headline and what it means for you. */
  | { kind: 'letter'; newsId: string; at: string; date: string; headline: string; text: string; means: string; governor?: boolean }
  /** A governor's commission: the new rank (risen from `from`; none when his letter came with it), what it brings, and the next. */
  | { kind: 'promotion'; nation: string; rank: string; from?: string; acres: number; town: string }
  /** A famous pirate seen for the first time. */
  | { kind: 'famous'; pirateId: string }
  /** A hoard dug up. */
  | { kind: 'hoard'; name: string; gold: number; fame: number; revenge: boolean }
  /** A piece of a treasure map: whose, the line that came with it. */
  | { kind: 'map'; pirateId: string; line: string }
  /** The First Voyage's letter: the storm's wreck on the cay, and her orders. */
  | { kind: 'voyage'; town: string; date: string; ship: string; cay: string; bearing: string; orders: Order[]; fate?: Fate }
  /** A new career's opening letter (storyboard 1.4): her ship, the war, and the first goal. */
  | { kind: 'opening'; town: string; date: string; ship: string; guns: number; men: number; enemies: string; goal?: { title: string; have: string; where: string }; fate?: Fate };

/** What she would retire to today, and the next fate up with the score it takes. */
type Fate = { now: string; next?: string; at?: number };

/** The career's end in view (a new career's letter): the fate she would retire to today, and the next one up. */
function FateLine({ fate }: { fate?: Fate }) {
  if (!fate) return null;
  const lower = (t: string) => t[0]!.toLowerCase() + t.slice(1);
  return (
    <div class="moment-fate">
      <span class="moment-kicker">If you retired today</span> {lower(fate.now)}
      {fate.next ? (
        <span class="book-sub">
          {' '}
          · score {fate.at} makes you {lower(fate.next)}
        </span>
      ) : null}
    </div>
  );
}

const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };
const ADJECTIVE: Record<string, string> = { spain: 'Spanish', england: 'English', france: 'French', netherlands: 'Dutch' };
/** One line of a famous pirate's reputation, by her temperament (pirates.json). */
const REPUTATION: Record<string, string> = {
  bold: 'Bold: fights hard, and boards at the first chance.',
  steadfast: 'Steadfast: never runs, whatever the odds.',
  slippery: 'Slippery: runs at the first ill wind, and is hard to catch.',
  reckless: 'Reckless: lays you aboard at once.',
  disciplined: 'Disciplined: boards only at good odds, and makes them.',
  gunner: 'A gunner: stands off and fights with the guns.',
};
const ORDINAL = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export interface MomentProps {
  moment: Moment;
  content: ContentPack;
  state: WorldState;
  map: TileMap;
  settlements: PlacedSettlement[];
  /** A painting's url by scene id (art/game/scenes), or none while it is unpainted. */
  scene: (id: string) => string | undefined;
  close: () => void;
  /** Plot a course to a spot at sea (tile coordinates). */
  plot: (x: number, y: number) => void;
  /** Closes a letter and goes in to the port's governor. */
  toGovernor: () => void;
  /** The sound of an honour (a promotion's seal coming down). */
  honour: () => void;
}

/** The moment at the head of the queue, full screen. */
export function MomentView({ moment, content, state, map, settlements, scene, close, plot, toGovernor, honour }: MomentProps) {
  if (moment.kind === 'letter') {
    // The news's first sentence says who ("England and France are at war!"); the rest is the story.
    const [who, ...rest] = moment.text.split(/(?<=[!.])\s+/);
    return (
      <div class="moment moment-dim">
        <div class="k-paper moment-letter">
          <div class="moment-dateline">
            News reaches you at {moment.at} · {moment.date}
          </div>
          <div class="book-rule" />
          <div class="moment-headline">{moment.headline}</div>
          <div class="moment-who">{who!.replace(/[!.]$/, '')}</div>
          {rest.length ? (
            <>
              <div class="book-rule" />
              <p class="moment-news">{rest.join(' ')}</p>
            </>
          ) : null}
          <div class="moment-means">
            <b>What it means for you</b>
            <div>{moment.means}</div>
          </div>
          <div class="moment-actions">
            {moment.governor ? (
              <button class="k-btn primary" onClick={toGovernor}>
                To the governor
              </button>
            ) : null}
            <button class={`k-btn${moment.governor ? '' : ' primary'}`} onClick={close}>
              Into the log <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (moment.kind === 'voyage')
    return (
      <div class="moment moment-dim">
        <div class="k-paper moment-letter moment-voyage">
          <div class="moment-seal" aria-hidden="true" />
          <div class="moment-dateline">
            {moment.town}, {moment.date}
          </div>
          <div class="moment-body">
            <p>Captain,</p>
            <p>
              Your uncle's {moment.ship} is yours. Last night's storm drove a sloop onto {moment.cay}, a short sail to the {moment.bearing}: whatever she
              carried is anyone's who gets there first.
            </p>
            <p>Take her out and see. Your quartermaster knows the way, and he knows the ship.</p>
          </div>
          <div class="moment-signed">the Governor of {moment.town}</div>
          <div class="book-rule" />
          <div class="moment-kicker">Your orders</div>
          <OrdersList orders={moment.orders} />
          <FateLine fate={moment.fate} />
          <div class="moment-actions">
            <button class="k-btn primary" onClick={close}>
              To the harbour <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );

  if (moment.kind === 'opening')
    return (
      <div class="moment moment-dim">
        <div class="k-paper moment-letter moment-opening">
          <div class="moment-seal" aria-hidden="true" />
          <div class="moment-dateline">
            {moment.town}, {moment.date}
          </div>
          <div class="moment-body">
            <p>Captain,</p>
            <p>
              Your uncle's {moment.ship} is yours, with {moment.guns} guns and {moment.men} men. The Main is rich
              {moment.enemies ? `, and ${moment.enemies} at war with us` : ''}.
            </p>
            <p>Fill her battery and her crew, and come and see me.</p>
          </div>
          <div class="moment-signed">the Governor of {moment.town}</div>
          <div class="book-rule" />
          <FateLine fate={moment.fate} />
          <div class="moment-goal">
            {moment.goal ? (
              <div>
                <div class="moment-kicker">Your first goal</div>
                <div class="moment-goal-title">{moment.goal.title}</div>
                <div class="book-sub">
                  {moment.goal.have} · {moment.goal.where}
                </div>
              </div>
            ) : (
              <span />
            )}
            <button class="k-btn primary" onClick={close}>
              To the harbour <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );

  if (moment.kind === 'promotion') {
    return <Promotion key={`${moment.nation}:${moment.rank}`} moment={moment} content={content} state={state} scene={scene} close={close} honour={honour} />;
  }

  if (moment.kind === 'famous') {
    const c = content.pirates.captains.find((x) => x.id === moment.pirateId)!;
    const ranks = topTen(content, state);
    const place = ranks.findIndex((r) => r.id === c.id) + 1;
    const wealth = ranks[place - 1]?.wealth ?? c.wealth;
    return (
      <div class="moment" style={paint(scene('moment.famous'))}>
        <div class="moment-head left">
          <div class="moment-kicker">A famous pirate</div>
          <h2 class="moment-title">{c.name}</h2>
          <div class="moment-sub">
            the {c.ship} · {ORDINAL(place)} on the Top Ten, {wealth.toLocaleString()} gold
          </div>
          <div class="moment-line">{REPUTATION[c.temperament] ?? ''} Beat this one, and half that wealth is yours.</div>
          <div class="moment-actions flush">
            <button class="k-btn primary" onClick={close}>
              Onward <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (moment.kind === 'hoard')
    return (
      <div class="moment" style={paint(scene('moment.hoard'))}>
        <div class="moment-head left">
          <div class="moment-kicker">A hoard dug up</div>
          <h2 class="moment-title">{moment.name}'s gold</h2>
          <div class="moment-sub">
            {moment.gold.toLocaleString()} gold to the plunder chest · +{moment.fame} fame
          </div>
          {moment.revenge ? <div class="moment-line">{moment.name} will hear of it: he swears revenge, and will hunt you.</div> : null}
          <div class="moment-actions flush">
            <button class="k-btn primary" onClick={close}>
              Into the chest <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );

  // A piece of a treasure map: the parchment as far as the pieces show it, and where to dig.
  const c = content.pirates.captains.find((x) => x.id === moment.pirateId)!;
  const hoard = state.famous?.[c.id]?.hoard;
  const held = state.captain?.mapPieces?.[c.id] ?? 0;
  const whole = content.pirates.rules.mapPieces;
  if (!hoard) return null;
  const ring = hoardRing(content, hoard, held);
  const near = settlements.find((s) => s.id === hoard.near)?.name ?? hoard.near;
  const got = quartersHeld(hoard, held);
  // The piece just come to hand is ringed, so the captain sees which quarter it is.
  const fresh = got[got.length - 1];
  return (
    <div class="moment moment-map">
      <div class="moment-map-sheet">
        <Parchment content={content} map={map} hoard={hoard} pieces={held} />
        {/* The quarters still missing, marked as such over the torn-away parchment. */}
        <div class="moment-quarters" aria-hidden="true">
          {[0, 1, 2, 3].map((q) => (
            <div key={q} class={got.includes(q) ? (q === fresh ? 'new' : '') : 'missing'}>
              {got.includes(q) ? null : <span>not yet found</span>}
            </div>
          ))}
        </div>
      </div>
      <div class="moment-head left">
        <div class="moment-kicker">A piece of a treasure map</div>
        <h2 class="moment-title">{c.name}'s hoard</h2>
        <div class="k-say">“{moment.line}”</div>
        <div class="book-rule light" />
        <div class="moment-line">
          <b>
            {held} of {whole} pieces.
          </b>{' '}
          {held >= 2 ? `The map marks ${hoard.landmark}, on the coast near ${near}.` : `On the coast near ${near}.`} About {hoard.value.toLocaleString()} gold buried.
        </div>
        <div class="k-sub">
          The chart rings where to search, about {Math.round(ring.r * 2)} tiles across. Close the shore inside it and press <Key k="E" /> to dig.
        </div>
        <div class="moment-actions flush">
          <button
            class="k-btn primary"
            onClick={() => {
              plot(...waterNear(map, ring.x, ring.y));
              close();
            }}
          >
            Plot a course to the ring
          </button>
          <button class="k-btn" onClick={close}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a war or a peace between two nations means for the captain, by the letters of marque he holds. */
export function letterMeans(kind: 'war' | 'peace', a: string, b: string, marques: readonly string[], flag?: string): string {
  // Her own flag in it: the other side's ports and warships are what changes for her.
  if (flag === a || flag === b) {
    const foe = flag === a ? b : a;
    return kind === 'war'
      ? `${COUNTRY[foe]}'s ports are closed to you now, and once you attack her ships, her warships will hunt you. ${ADJECTIVE[flag]} governors grant letters of marque against her.`
      : `${COUNTRY[foe]}'s ports open to you again, and her warships leave your flag be. Taking her ships is piracy now.`;
  }
  const mine = marques.includes(a) ? a : marques.includes(b) ? b : undefined;
  const other = mine === a ? b : a;
  if (kind === 'war')
    return mine
      ? `Your ${ADJECTIVE[mine]} letter of marque now covers ${COUNTRY[other]}: her ships are lawful prizes, and ${ADJECTIVE[mine]} governors pay bounties for them.`
      : `${COUNTRY[a]}'s governors will grant a letter of marque against ${COUNTRY[b]}, and ${COUNTRY[b]}'s against ${COUNTRY[a]}.`;
  return mine
    ? `Your ${ADJECTIVE[mine]} letter of marque no longer covers ${COUNTRY[other]}: taking her ships now is piracy.`
    : `Their ships are no longer lawful prizes for each other's privateers.`;
}

/** Each rank's perk by the icon its card shows. */
const PERK_ICON: Record<string, string> = {
  recruit: 'ui.icon.crew',
  repair: 'ui.icon.hull',
  bestFits: 'ui.icon.fit.bronze_cannon',
  price: 'ui.icon.gold',
  frigate: 'ui.icon.full_sail',
  upgrade: 'ui.icon.fit.copper',
};

/**
 * A promotion, as a ceremony (storyboard 2.13, docs/reference/game-ui.md "reveal moments are the reward"): the ladder
 * fills from the rung he rose from to his new one, its seal comes down with the sound of it, then the governor speaks and
 * what the rank brings comes up one by one: its perks, a title's grant of land, and how far to the next. Enter closes
 * it at any point.
 */
function Promotion({
  moment,
  content,
  state,
  scene,
  close,
  honour,
}: Pick<MomentProps, 'content' | 'state' | 'scene' | 'close' | 'honour'> & { moment: Extract<Moment, { kind: 'promotion' }> }) {
  const ranks = content.politics.ranks;
  const ladder = ranks.ladder;
  const rung = ladder.findIndex((r) => r.name === moment.rank);
  const from = moment.from ? ladder.findIndex((r) => r.name === moment.from) : -1;
  const next = ladder[rung + 1];
  const merit = state.captain?.merit?.[moment.nation as keyof NonNullable<NonNullable<WorldState['captain']>['merit']>] ?? 0;
  const country = COUNTRY[moment.nation] ?? 'The Crown';
  // rungBrings words each perk of the rung in the perks' own order: pair them with their ids for the icons.
  const perkIds = Object.entries(ranks.perks)
    .filter(([, p]) => p.rung === ladder[rung]?.id)
    .map(([k]) => k);
  const perks = rungBrings(content, rung, false).map((words, i) => ({ id: perkIds[i]!, words: words[0]!.toUpperCase() + words.slice(1) }));
  const ids = new Set(perkIds);
  // The governor says what the rank opens to him, by the best thing it brings.
  const gives = ids.has('frigate')
    ? `${country}'s yards will build you a frigate.`
    : ids.has('repair')
      ? `${country}'s yards are yours.`
      : ids.has('upgrade')
        ? `${country}'s shipwrights will fit you out at a friend's price.`
        : ids.has('price')
          ? `${country}'s merchants will deal fairly with you.`
          : ids.has('recruit')
            ? `Men will sooner sign on under an officer of ${country}.`
            : ladder[rung]?.acres
              ? `Rise, ${moment.rank}: ${country} rewards you with land.`
              : `${country} does not forget those who serve her.`;
  const line = ladder[rung]?.acres ? gives : `${moment.rank}, then. ${gives}`;

  // The timeline, in seconds: the title, then the ladder filling a rung at a time, the seal, then what it brings.
  const step = 0.32;
  const climb = Math.max(1, rung - from);
  const stamp = 0.55 + climb * step;
  const card = stamp + 0.35;
  const perksAt = card + 0.35;
  const deedAt = perksAt + perks.length * 0.18;
  const barAt = deedAt + (moment.acres ? 0.45 : 0.1);
  const doneAt = barAt + 0.5;
  useEffect(() => {
    const t = setTimeout(honour, stamp * 1000);
    return () => clearTimeout(t);
  }, []);
  const at = (s: number) => ({ '--at': `${s.toFixed(2)}s` });
  // The fill runs between the first and last rungs' centres; each rung's share of it.
  const share = (r: number) => `${((Math.max(0, r) / (ladder.length - 1)) * 100).toFixed(2)}%`;
  const toNext = next ? Math.min(1, Math.max(0, (merit - ladder[rung]!.merit) / (next.merit - ladder[rung]!.merit))) : 1;

  return (
    <div class="moment moment-promotion" style={paint(scene('moment.promotion'))}>
      <div class="moment-head rise" style={at(0)}>
        <div class="moment-kicker">{ladder[rung]?.acres ? `By letters patent, read by the Governor of ${moment.town}` : `By order of the Governor of ${moment.town}`}</div>
        <h2 class="moment-title promo-title">{moment.rank}</h2>
        <div class="moment-sub">{ladder[rung]?.acres ? `a title, and land, from ${country}` : `in the service of ${country}`}</div>
      </div>

      <div class="promo-ladder" style={{ '--rungs': ladder.length }}>
        <div class="promo-track" aria-hidden="true">
          <div class="promo-fill" style={{ '--from': from < 0 ? '0%' : share(from), '--to': share(rung), '--climb': `${(climb * step).toFixed(2)}s` }} />
        </div>
        <ol aria-label={`Ranks with ${country}`}>
          {ladder.map((r, i) => (
            <li
              key={r.id}
              class={`promo-rung${i <= from ? ' held' : ''}${i > from && i < rung ? ' passed' : ''}${i === rung ? ' new' : ''}${i > rung ? ' ahead' : ''}`}
              style={at(i === rung ? stamp : 0.55 + (i - from - 0.5) * step)}
              aria-current={i === rung ? 'step' : undefined}
            >
              <span class="promo-mark" />
              <span class="promo-name">{r.name}</span>
            </li>
          ))}
        </ol>
      </div>

      <div class="k-wood moment-card promo-card rise" style={at(card)}>
        <div class="k-speech">
          <Bust id={`bust.governor.${moment.nation}`} label={`The governor of ${moment.town}`} />
          <div class="k-speech-body">
            <div class="k-say">“{line}”</div>
            {perks.length ? (
              <>
                <b class="moment-gold">Now yours, at {ADJECTIVE[moment.nation] ?? ''} ports</b>
                <div class="promo-perks">
                  {perks.map((p, i) => (
                    <div key={p.id} class="promo-perk pop" style={at(perksAt + i * 0.18)}>
                      {ART[PERK_ICON[p.id] ?? ''] ? <img src={ART[PERK_ICON[p.id]!]} alt="" draggable={false} /> : null}
                      <span>{p.words}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {moment.acres ? (
              <div class="k-paper promo-deed pop" style={at(deedAt)}>
                <div class="promo-deed-head">Grant of land to the {moment.rank}</div>
                <div class="promo-acres">
                  <b>{moment.acres}</b> acres
                </div>
                <div class="promo-deed-terms">
                  <span>
                    <b>{Math.round(moment.acres * ranks.rentPerAcre)} gold a month</b> in rent
                  </span>
                  <span>
                    <b>It grows with you:</b> {ranks.acresPerMerit} acres for every merit past {ladder.find((r) => r.acres)?.merit}
                  </span>
                </div>
                <span class="promo-seal" style={at(deedAt + 0.3)} aria-hidden="true" />
              </div>
            ) : null}
            {next ? (
              <div class="promo-next rise" style={at(barAt)}>
                <div class="promo-next-line">
                  <span>
                    <b>Next: {next.name}</b>
                    {rungBrings(content, rung + 1).length ? ` · ${rungBrings(content, rung + 1).join(', ')}` : ''}
                  </span>
                  <span>{Math.max(0, next.merit - merit)} more merit</span>
                </div>
                <div class="promo-bar">
                  <div style={{ ...at(barAt + 0.1), '--to': `${(toNext * 100).toFixed(1)}%` }} />
                </div>
              </div>
            ) : (
              <div class="promo-next rise" style={at(barAt)}>
                <b>The highest rank {country} gives.</b>
              </div>
            )}
          </div>
        </div>
        <div class="moment-actions end rise" style={at(doneAt)}>
          <button class="k-btn primary" onClick={close}>
            {ladder[rung]?.acres ? `Rise, ${moment.rank}` : 'Thank him'} <Key k="Enter" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A moment's painting behind it, darkened enough for the words; a plain dark ground while it is unpainted. */
function paint(url: string | undefined) {
  return url ? { backgroundImage: `linear-gradient(rgb(8 10 16 / 0.35), rgb(8 10 16 / 0.65)), url(${url})` } : undefined;
}
