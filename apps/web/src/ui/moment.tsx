import type { WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement, TileMap } from '@corsair/data';
import { hoardRing, rungBrings } from '@corsair/systems-economy';
import { topTen } from '@corsair/systems-traffic';
import { Parchment, quartersHeld, waterNear } from '../log';
import { Bust, curly, Key } from './kit';

// Moments (storyboard 2.13): short full-screen beats that reward and then get out of the way, one at a time from a
// queue, the world stopped while one shows. Enter or Escape closes one.

export type Moment =
  /** News that matters (war, peace): a dated letter, its headline and what it means for you. */
  | { kind: 'letter'; newsId: string; at: string; date: string; headline: string; text: string; means: string; governor?: boolean }
  /** A governor's commission: the new rank, what it brings, and the next. */
  | { kind: 'promotion'; nation: string; rank: string; acres: number; town: string }
  /** A famous pirate seen for the first time. */
  | { kind: 'famous'; pirateId: string }
  /** A hoard dug up. */
  | { kind: 'hoard'; name: string; gold: number; fame: number; revenge: boolean }
  /** A piece of a treasure map: whose, the line that came with it. */
  | { kind: 'map'; pirateId: string; line: string }
  /** A new career's opening letter (storyboard 1.4): her ship, the war, and the first goal. */
  | { kind: 'opening'; town: string; date: string; ship: string; guns: number; men: number; enemies: string; goal?: { title: string; have: string; where: string } };

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
}

/** The moment at the head of the queue, full screen. */
export function MomentView({ moment, content, state, map, settlements, scene, close, plot, toGovernor }: MomentProps) {
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
    const ladder = content.politics.ranks.ladder;
    const rung = ladder.findIndex((r) => r.name === moment.rank);
    const next = ladder[rung + 1];
    const merit = state.captain?.merit?.[moment.nation as keyof NonNullable<NonNullable<WorldState['captain']>['merit']>] ?? 0;
    const brings = rungBrings(content, rung);
    const country = COUNTRY[moment.nation] ?? 'The Crown';
    // The governor says what the rank opens to him, by the best thing it brings.
    const perks = new Set(Object.entries(content.politics.ranks.perks).filter(([, p]) => p.rung === ladder[rung]?.id).map(([k]) => k));
    const gives = perks.has('frigate')
      ? `${country}'s yards will build you a frigate.`
      : perks.has('repair')
        ? `${country}'s yards are yours.`
        : perks.has('upgrade')
          ? `${country}'s shipwrights will fit you out at a friend's price.`
          : perks.has('price')
            ? `${country}'s merchants will deal fairly with you.`
            : perks.has('recruit')
              ? `Men will sooner sign on under an officer of ${country}.`
              : ladder[rung]?.acres
                ? `${country} rewards you with land.`
                : `${country} does not forget those who serve her.`;
    const now = brings.join(' · ');
    return (
      <div class="moment" style={paint(scene('moment.promotion'))}>
        <div class="moment-head">
          <div class="moment-kicker">By order of the Governor of {moment.town}</div>
          <h2 class="moment-title">{moment.rank}</h2>
          <div class="moment-sub">in the service of {COUNTRY[moment.nation] ?? moment.nation}</div>
        </div>
        <div class="k-wood moment-card">
          <div class="k-speech">
            <Bust id={`bust.governor.${moment.nation}`} label={`The governor of ${moment.town}`} />
            <div class="k-speech-body">
              <div class="k-say">
                “{moment.rank}, then. {gives}”
              </div>
              <b class="moment-gold">Now, at {ADJECTIVE[moment.nation] ?? ''} ports</b>
              <div>{now ? now[0]!.toUpperCase() + now.slice(1) : 'Your rank, and the respect it carries.'}</div>
              {moment.acres ? <div>Your land: {moment.acres} acres, paying rent each month.</div> : null}
              {next ? (
                <div class="k-sub">
                  Next: {next.name} at merit {next.merit} ({Math.max(0, next.merit - merit)} more){rungBrings(content, rung + 1).length ? `: ${rungBrings(content, rung + 1).join(', ')}` : ''}.
                </div>
              ) : null}
            </div>
          </div>
          <div class="moment-actions end">
            <button class="k-btn primary" onClick={close}>
              Thank him <Key k="Enter" />
            </button>
          </div>
        </div>
      </div>
    );
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
          The chart rings where to search, about {Math.round(ring.r * 2)} tiles across. Close the shore inside it and press <Key k="G" /> to dig.
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

/** A moment's painting behind it, darkened enough for the words; a plain dark ground while it is unpainted. */
function paint(url: string | undefined) {
  return url ? { backgroundImage: `linear-gradient(rgb(8 10 16 / 0.35), rgb(8 10 16 / 0.65)), url(${url})` } : undefined;
}
