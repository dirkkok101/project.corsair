import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BattleResult, Command, SailSetting } from '@corsair/core';
import type { ContentPack } from '@corsair/data';
import type { Aim, Broadside, BattleShip, BattleState } from '@corsair/minigame-sea-battle';
import { rowing, shotHarmOf, weatherGauge } from '@corsair/minigame-sea-battle';
import { Compass, Help } from './hud';
import type { CompassProps } from './hud';
import { bandOf, Key } from './ui/kit';
import { Art, GoodIcon, shipIcon, shipKind } from './ui-art';

// The sea battle HUD (storyboard 5.1-5.4): both ships' hull, sails and men as named bands, each broadside's state and
// the shot loaded, the call-outs (raked, a mast gone, wavering, close to board, drawing apart), a famous pirate's
// demand with both consequences, then the report and the plunder screen.

/** How the fight went, in a line: how it ended, after how long, and when it was lost, how. */
function outcomeText(state: BattleState): string {
  const minutes = Math.round(state.tick / 30 / 60);
  const after = minutes <= 1 ? 'after a minute' : `after ${minutes} minutes`;
  const result = state.result!;
  switch (result.outcome) {
    case 'sunk':
      return `She went down by the head ${after}, and her cargo with her.`;
    case 'struck':
      return `She hauled down her colours ${after}. She is your prize.`;
    case 'boarded':
      return `Your men carried her deck ${after}. She is your prize.`;
    case 'escaped':
      return `She drew clear ${after} and slipped away over the horizon.`;
    case 'fled':
      return 'You broke off and left her astern. She will remember your colours.';
    case 'lost':
      return `${result.player.hull <= 0 ? 'Your hull was shot through' : 'Her men won the fight on deck'} ${after}, and you had to strike. They let you go, but not empty-handed.`;
    case 'yielded':
      return 'You struck your colours. He takes the plunder chest and your hold, and leaves you your ship and your men.';
  }
}

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
  yielded: 'outcome.lost',
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
  /** A famous pirate beaten: her name, the share of her wealth that came to the chest, and the fame. */
  famous?: { name: string; share: number; fame: number; piece?: number } | null;
  /** A blockader beaten off a port: the blockade is broken, and its governors pay `bounty` more for it. */
  relieved?: { town: string; nation: string; bounty: number } | null;
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
  /** Her value is what she fetches where she sells best (`where`): her papers decide it. */
  keep: { hold: number; minCrew: number; speed: number; fullSpeed: number; value: number; where: string; whyNot?: string };
  /**
   * A famous pirate taken prisoner: her name, the map pieces of her hoard already held (of `pieces`), the bounty
   * any governor pays and the standing it brings, and the morale setting her free gives.
   */
  captive?: { name: string; held: number; pieces: number; bounty: number; standing: number; morale: number };
}

type CaptiveChoice = NonNullable<PlunderChoice['captive']>;

/** What each choice for a famous prisoner means, in a line. */
function captiveText(c: NonNullable<PlunderOffer['captive']>, choice: CaptiveChoice) {
  if (choice === 'hoard') {
    return `He gives up a piece of the map to his buried hoard: you will hold ${c.held + 1} of its ${c.pieces} pieces. Map pieces are keepsakes, never sold.`;
  }
  if (choice === 'bounty') {
    return `He stays in irons until you hand him to any governor: ${c.bounty.toLocaleString()} gold to the plunder chest, and that nation thinks better of you (+${c.standing}). He won't sail again till the governor's jail lets him go.`;
  }
  return `Your men think the better of a captain who keeps the code (+${c.morale} morale), and he will leave you be when he sails again, unless you fire on him.`;
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
  if (r.famous) {
    rows.push({ icon: 'ui.icon.chest', text: `+${r.famous.share.toLocaleString()} gold of ${r.famous.name}'s fortune, into the plunder chest`, tone: 'good' });
    rows.push({ icon: 'ui.icon.morale', text: `+${r.famous.fame} fame: ${r.famous.name} is beaten, and the whole Main will hear of it`, tone: 'good' });
    if (r.famous.piece) {
      rows.push({ icon: 'ui.icon.chest', text: `A survivor pulled from the water carried a piece of ${r.famous.name}'s map: you hold ${r.famous.piece}. See it in the log (L)`, tone: 'good' });
    }
  }
  if (r.relieved) {
    const country = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' }[r.relieved.nation] ?? r.relieved.nation;
    rows.push({ icon: 'ui.icon.anchor', text: `The blockade of ${r.relieved.town} is broken: ${country}'s governors will pay ${r.relieved.bounty.toLocaleString()} gold more for it`, tone: 'good' });
  }
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
 * The victory screen (storyboard 5.3-5.4, after Pirates! 2004), made easy: what the fight did beside her hold, the best
 * of it already chosen; her fate as three cards, each with what it costs; signing on her men; a famous prisoner's
 * fate; and one big button that does it all (Enter). Picking the goods by hand is a click away.
 */
function Plunder({ content, offer, name, report, onPlunder }: { content: ContentPack; offer: PlunderOffer; name: string; report: ComponentChildren; onPlunder: (choice: PlunderChoice) => void }) {
  const used = Object.values(offer.mine).reduce((a, b) => a + b, 0);
  const [take, setTake] = useState(() => bestTake(content, offer.theirs, offer.capacity - used));
  const [jettison, setJettison] = useState<Record<string, number>>({});
  const [volunteers, setVolunteers] = useState(offer.volunteers > 0);
  // Keeping her is the better bargain when she would sell for more than her hold is worth: then Enter keeps her.
  const keepBest = !offer.keep.whyNot && offer.keep.value > worth(content, offer.theirs);
  // Else a pirate is best sunk; a merchant let go (her nation hears of it either way).
  const [release, setRelease] = useState(offer.nation !== 'pirate');
  const [keep, setKeep] = useState(keepBest);
  const [byHand, setByHand] = useState(false);
  // A famous prisoner: his map piece is the best of it, while his map is not yet whole.
  const [captive, setCaptive] = useState<CaptiveChoice>(offer.captive && offer.captive.held >= offer.captive.pieces ? 'bounty' : 'hoard');
  const thrown = Object.values(jettison).reduce((a, b) => a + b, 0);
  const taking = Object.values(take).reduce((a, b) => a + b, 0);
  // Kept, her hold joins the fleet's.
  const room = offer.capacity + (keep ? offer.keep.hold : 0) - used + thrown - taking;
  const herUnits = Object.values(offer.theirs).reduce((a, b) => a + b, 0);
  // Taking the most her hold allows: with her own hold kept, all of hers fits.
  const choose = () => onPlunder({ take: keep ? { ...offer.theirs } : take, jettison, volunteers, release, keep, ...(offer.captive ? { captive } : {}) });
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
  const goodLabel = (g: string) => content.goods.find((x) => x.id === g)?.name ?? g;
  const step = (n: number) => Math.max(1, Math.ceil(n / 4));
  const taken = keep ? offer.theirs : take;
  const go = keep ? 'Take her into the fleet' : `${herUnits ? 'Take the best and ' : ''}${release ? 'let her go' : 'sink her'}`;
  const nation = COUNTRY[offer.nation] ?? offer.nation;
  const fates: { id: 'release' | 'sink' | 'keep'; label: string; what: string; on: boolean; pick: () => void; why?: string }[] = [
    {
      id: 'release',
      label: 'Let her go',
      what: offer.nation === 'pirate' ? 'back to raiding' : `${nation} ${signed(content.combat.standing.mercy)}`,
      on: release && !keep,
      pick: () => (setRelease(true), setKeep(false)),
    },
    {
      id: 'sink',
      label: 'Sink her',
      what: offer.nation === 'pirate' ? 'one pirate fewer' : `${nation} ${signed(content.combat.standing.scuttle)}`,
      on: !release && !keep,
      pick: () => (setRelease(false), setKeep(false)),
    },
    {
      id: 'keep',
      label: 'Keep her',
      what: `+${offer.keep.hold} tons, needs ${offer.keep.minCrew} men · sells for about ${offer.keep.value.toLocaleString()} ${offer.keep.where}`,
      on: keep,
      pick: () => setKeep(true),
      ...(offer.keep.whyNot ? { why: offer.keep.whyNot } : {}),
    },
  ];
  return (
    <div class="k-wood victory plunder">
      <div class="victory-top">
        <div class="victory-what">{report}</div>
        <div class="victory-hold">
          <h3 class="plunder-title">{name}'s hold</h3>
          {herUnits ? (
            <div class="plunder-goods">
              {Object.entries(offer.theirs)
                .filter(([, n]) => n > 0)
                .map(([g, n]) => (
                  <div key={g} class={`plunder-good${taken[g] ? ' taking' : ''}`}>
                    <GoodIcon id={g} />
                    <b>{n}</b>
                    <span class="k-sub">{goodLabel(g).toLowerCase()}</span>
                  </div>
                ))}
            </div>
          ) : (
            <div class="k-sub">Her hold is empty: her purse was all she carried.</div>
          )}
          {herUnits > taking && !keep ? <div class="plunder-note">{herUnits - taking} left in her hold: no room in yours. Choose the goods yourself to make room.</div> : null}
          {offer.volunteers > 0 ? (
            <label class="plunder-sign">
              <input type="checkbox" checked={volunteers} aria-label="Sign on her men" onChange={() => setVolunteers(!volunteers)} />
              <span>
                Sign on {offer.volunteers} of her men:{' '}
                {volunteers
                  ? `stronger boarders and faster reloads${
                      Math.floor(offer.foodWith) < Math.floor(offer.foodNow) ? `; food lasts ${Math.floor(offer.foodWith)} days instead of ${Math.floor(offer.foodNow)}` : ''
                    }, and the plunder split more ways`
                  : 'they are put ashore'}
              </span>
            </label>
          ) : null}
        </div>
      </div>
      {offer.captive ? (
        <div class="k-paper plunder-captive">
          <div class="moment-kicker">A famous pirate taken</div>
          <h3 class="plunder-title">{offer.captive.name}, in irons</h3>
          <div class="k-say">“What will you do with me, Captain?”</div>
          <div class="plunder-captive-choices">
            <button
              class={`k-btn paper${captive === 'hoard' ? ' active' : ''}`}
              disabled={offer.captive.held >= offer.captive.pieces}
              title={offer.captive.held >= offer.captive.pieces ? 'You hold his whole map already.' : undefined}
              onClick={() => setCaptive('hoard')}
            >
              <span>Ask about his hoard</span>
              <span class="plunder-go-what">a map piece</span>
            </button>
            <button class={`k-btn paper${captive === 'bounty' ? ' active' : ''}`} onClick={() => setCaptive('bounty')}>
              <span>Hold him for a governor</span>
              <span class="plunder-go-what">{offer.captive.bounty.toLocaleString()} bounty</span>
            </button>
            <button class={`k-btn paper${captive === 'free' ? ' active' : ''}`} onClick={() => setCaptive('free')}>
              <span>Set him free</span>
              <span class="plunder-go-what">morale +{offer.captive.morale}</span>
            </button>
          </div>
          <div class="plunder-captive-note">{captiveText(offer.captive, captive)}</div>
        </div>
      ) : null}
      {/* Her fate: three equal cards, each with what it costs; keeping her is marked when she is the better bargain. */}
      <div class="plunder-fates">
        {fates.map((f) => (
          <button
            key={f.id}
            class={`fate-card fate-${f.id}${f.on ? ' active' : ''}${f.id === 'keep' && keepBest ? ' best' : ''}`}
            aria-pressed={f.on}
            disabled={Boolean(f.why)}
            title={f.why}
            onClick={f.pick}
          >
            <b>
              {f.label}
              {f.id === 'keep' && keepBest ? <span class="k-tag gold">best</span> : null}
            </b>
            <span>{f.why ?? f.what}</span>
          </button>
        ))}
      </div>
      <div class="plunder-fate-note">{fateText(content, offer, release, keep)}</div>
      <div class="victory-go">
        <button class="k-btn primary plunder-go" onClick={choose}>
          <span>
            {go.replace(/^./, (c) => c.toUpperCase())} · Enter
          </span>
          <span class="plunder-go-what">
            {taking && !keep ? `${goodsText(content, take)}, about ${worth(content, take).toLocaleString()} gold` : keep ? `+${offer.keep.hold} tons of hold` : ''}
          </span>
        </button>
        {herUnits ? (
          <button class="k-btn small plunder-toggle" onClick={() => setByHand(!byHand)}>
            {byHand ? 'Take the best for me' : 'Choose the goods myself'}
          </button>
        ) : null}
      </div>
      {byHand && !keep ? (
        <div class="plunder-hand">
          <div class="plunder-room">
            Your hold {used - thrown + taking} / {offer.capacity}
          </div>
          <table>
            <tbody>
              {Object.entries(offer.theirs).map(([g, n]) => (
                <tr key={g} class="plunder-take">
                  <td>
                    <GoodIcon id={g} /> {goodLabel(g)}
                  </td>
                  <td>hers {n}</td>
                  <td>
                    <button class="k-btn small" onClick={() => setTake({ ...take, [g]: Math.max(0, (take[g] ?? 0) - step(n)) })}>
                      −
                    </button>
                    <span class="plunder-n">take {take[g] ?? 0}</span>
                    <button class="k-btn small" onClick={() => setTake({ ...take, [g]: Math.min(n, (take[g] ?? 0) + Math.min(step(n), room)) })}>
                      +
                    </button>
                  </td>
                </tr>
              ))}
              {Object.entries(offer.mine).map(([g, n]) => (
                <tr key={`mine-${g}`} class="plunder-throw">
                  <td>
                    <GoodIcon id={g} /> {goodLabel(g)}
                  </td>
                  <td>yours {n}</td>
                  <td>
                    <button class="k-btn small" onClick={() => setJettison({ ...jettison, [g]: Math.max(0, (jettison[g] ?? 0) - step(n)) })}>
                      −
                    </button>
                    <span class="plunder-n">over the side {jettison[g] ?? 0}</span>
                    <button class="k-btn small" onClick={() => setJettison({ ...jettison, [g]: Math.min(n, (jettison[g] ?? 0) + step(n)) })}>
                      +
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const AIM: Record<Aim, string> = {
  ready: 'Ready',
  loading: 'Loading',
  'no-target': 'Not bearing',
  'out-of-range': 'Out of range',
  'no-guns': 'No guns',
};

const TITLE: Record<BattleResult['outcome'], string> = {
  sunk: 'She went down!',
  struck: 'She struck!',
  boarded: 'Carried her deck!',
  escaped: 'She got away',
  fled: 'You broke off',
  lost: 'Defeat',
  yielded: 'You struck',
};

const NATION_TAG: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'Dutch', pirate: 'Pirate' };

/** How she fights, in words (combat.json styles): "Raider · light guns · thin hull" (a boat with none: swivels). */
function styleLine(content: ContentPack, classId: string) {
  const cls = content.ships[classId]!;
  const s = content.combat.styles[cls.style];
  return `${capital(cls.style)} · ${cls.guns ? `${s.shot} guns` : 'swivels'} · ${s.timbers} hull`;
}

const capital = (word: string) => word[0]!.toUpperCase() + word.slice(1);

/** Below this, her round shot barely marks their sides (combat.json shotHarm). */
const BARELY_MARKS = 0.5;

/** The matchup in a line: whose guns tell, and what to do about it. */
function matchupHint(content: ContentPack, mine: string, theirs: string) {
  const given = shotHarmOf(content, mine, theirs);
  const taken = shotHarmOf(content, theirs, mine);
  if (given < BARELY_MARKS) return 'Your round shot barely marks her sides: chain her rigging, grape her deck, then board.';
  if (taken > given) return 'Her guns outweigh yours: keep off her broadside, rake her, or board.';
  if (given > taken) return 'Your guns outweigh hers: give her your broadside.';
  return undefined;
}

/** Why she may strike (the battle's own tests, combat.json strike), in words that match her card's bars. */
function waverWhy(content: ContentPack, e: BattleShip, p: BattleShip, apart: number) {
  const s = content.combat.strike;
  const merchant = (e.role ?? 'merchant') === 'merchant';
  const why: string[] = [];
  if (e.hull < e.hullMax * s.hull) why.push('her hull is badly hurt');
  if (e.crew < e.crewStart * s.crew) why.push('her men are few');
  if (merchant && e.sailCondition < 100 * s.merchantSails) why.push("her sails are in rags, so she can't run");
  if (merchant && p.crew >= e.crew * s.odds && apart <= s.oddsTiles) why.push(`your men outnumber hers ${s.odds} to one`);
  return why.length ? why.join(' and ') : 'she has had enough';
}

/** A bar with what it means in a word ("Holed"), red once it runs low. */
function Bar({ label, share, word, men }: { label: string; share: number; word: string; men?: boolean }) {
  const s = Math.max(0, Math.min(1, share));
  return (
    <div class="battle-bar">
      <span class="battle-bar-label">{label}</span>
      <span class="k-bar">
        <span class={s < 0.3 ? 'low' : men ? 'men' : ''} style={{ width: `${Math.round(s * 100)}%` }} />
      </span>
      <span class="battle-bar-word">{word}</span>
    </div>
  );
}

/** A ship's masts by name, fore to aft. */
const MAST_NAMES: Record<number, string[]> = { 1: ['mast'], 2: ['foremast', 'mainmast'], 3: ['foremast', 'mainmast', 'mizzen'] };

/** Tiles a second either way under which the gap is holding, not changing; the pace shows past this far apart. */
const PACE_EVEN = 0.05;
const PACE_FROM_TILES = 14;
/** Seconds "Boarders repelled!" or "Too soon!" stays up. */
const REPEL_SAID_SECONDS = 2;
/** Seconds the weather gauge is called out, as the fight opens and each time it changes hands. */
const GAUGE_CALL_SECONDS = 8;

/**
 * A ship's card (storyboard 5.1): her flag, name, what she is and her men, and hull, sails and men as named bands.
 * Light, as Pirates! keeps it: lettering over the sea on a faint shade, not a panel, so the fight stays the picture.
 */
function ShipCard({ ship, tag, gold, name, what, style, hint, wavering, oars }: { ship: BattleShip; tag: string; gold?: boolean; name: string; what: string; style: string; hint?: string; wavering?: boolean; oars?: boolean }) {
  const up = ship.masts.filter((m) => m > 0).length;
  const hull = ship.hull / ship.hullMax;
  const sails = ship.sailCondition / 100;
  const men = ship.crew / Math.max(ship.crewStart, 1);
  return (
    <div class="battle-card">
      <div class="battle-card-head">
        <span class={`k-tag${gold ? ' gold' : ''}`}>{tag}</span>
        <b class="battle-name">{name}</b>
        {wavering ? <span class="k-tag gold">wavering</span> : null}
        {/* At the oars she goes where her sails can't take her, even into the wind: cut her off, don't chase. */}
        {oars ? <span class="k-tag" title="Rowing: she can row into the wind, where you must tack. Cut her off rather than chase, and grape thins her rowers.">rowing</span> : null}
      </div>
      <div class="battle-title">
        {what} · {Math.round(ship.crew)} men
        {up < ship.masts.length ? ` · ${up} of ${ship.masts.length} masts standing` : ''}
      </div>
      <div class="battle-style">{style}</div>
      {hint ? <div class="battle-hint">{hint}</div> : null}
      <Bar label="Hull" share={hull} word={bandOf(hull, [[0, 'Sinking'], [0.25, 'Badly hurt'], [0.6, 'Holed'], [0.9, 'Sound']])} />
      <Bar label="Sails" share={sails} word={bandOf(sails, [[0, 'In rags'], [0.3, 'Torn'], [0.6, 'Holed'], [0.9, 'Whole']])} />
      <Bar label="Men" share={men} men word={bandOf(men, [[0, 'A handful'], [0.3, 'Shaken'], [0.6, 'Steady'], [0.9, 'Eager']])} />
    </div>
  );
}

export type Shot = 'round' | 'chain' | 'grape';
const SHOTS: { id: Shot; name: string; icon: string }[] = [
  { id: 'round', name: 'Round', icon: 'ui.icon.round_shot' },
  { id: 'chain', name: 'Chain', icon: 'ui.icon.chain_shot' },
  { id: 'grape', name: 'Grape', icon: 'ui.icon.grape_shot' },
];

/** The player's own ship in battle: her name, what she is, and her sails and shot to set. */
export interface YourShip {
  name: string;
  what: string;
  sails: SailSetting;
  setSails: (sails: SailSetting) => void;
  shot: Shot;
  chooseShot: (shot: Shot) => void;
}

export interface BattleHudProps {
  state: BattleState;
  content: ContentPack;
  enemyName: string;
  enemyTitle: string;
  enemyNation?: string;
  reloadSeconds: number;
  /** Each broadside: ready, or why it can't fire. */
  aim: Record<Broadside, Aim>;
  you: YourShip;
  /** She may strike any moment now. */
  wavering: boolean;
  /** A famous pirate calls on her to strike: who, the plunder chest she'd give up, and his flag (a picture). */
  demand?: { name: string; chest: number; flag?: string };
  /** Strike your colours to a famous pirate's demand (Y). */
  onStrike: () => void;
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
  /**
   * Boarding: the chance the player's boarders carry her deck now, whether "close to board" is on, and the seconds
   * before her boarders go over in which R repels them (0: nothing to repel).
   */
  board: { odds: number; active: boolean; repel: number };
  onPlunder: (choice: PlunderChoice) => void;
  onContinue: () => void;
  /** The camera's shake at each broadside and blow: on, or off for a still view. */
  shake: { on: boolean; toggle: () => void };
  /** F1's every-key help, open over the battle. */
  help?: { open: boolean; close: () => void };
  /** For tuning (?mind=1): what her captain has in mind, and how much she wants each choice. */
  showMind?: boolean;
}

export function BattleHud({ state, content, enemyName, enemyTitle, enemyNation, reloadSeconds, aim, you, wavering, report, attacked, offer, advice, compass, board, onPlunder, onContinue, demand, onStrike, shake, help, showMind }: BattleHudProps) {
  const me = state.ships.player;
  const b = content.combat.battle;
  const apart = Math.hypot(state.ships.enemy.x - me.x, state.ships.enemy.y - me.y);
  const [fightOn, setFightOn] = useState(false);
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
  // A raking shot, called out for a moment (a mast going by the board says more, and wins).
  for (const e of state.effects) {
    if (!e.place?.rake || e.at <= mastCall.current.seen || !e.ship) continue;
    mastCall.current = { text: e.ship === 'enemy' ? 'Raked her, bow to stern!' : 'She rakes you!', until: e.at + 1.5, seen: e.at };
  }
  const gun = (side: Broadside) => {
    const left = me.reload[side];
    return aim[side] === 'ready' ? 'Ready' : left > 0 ? `Loading ${Math.ceil(left)} s` : AIM[aim[side]];
  };
  const enemy = state.ships.enemy;
  const gauge = weatherGauge(state);
  // How fast the gap is changing (tiles a second; less than nothing: she is closing), from both ships' way.
  const e0 = state.ships.enemy;
  const way = (s: { headingDeg: number; speed: number }): [number, number] => [Math.sin((s.headingDeg * Math.PI) / 180) * s.speed, -Math.cos((s.headingDeg * Math.PI) / 180) * s.speed];
  const [pvx, pvy] = way(me);
  const [evx, evy] = way(e0);
  const opening = apart > 0 ? ((evx - pvx) * (e0.x - me.x) + (evy - pvy) * (e0.y - me.y)) / apart : 0;
  const pace = opening < -PACE_EVEN ? "She's gaining on you" : opening > PACE_EVEN ? "You're drawing away" : "You're holding her off";
  const fightSeconds = state.tick / 30;
  const repelSaid = state.repel && fightSeconds - state.repel.at < REPEL_SAID_SECONDS ? state.repel.result : undefined;
  // The weather gauge is called out as the fight opens and when it changes hands, then left to the compass.
  const gaugeSeen = useRef({ gauge: '', since: 0 });
  if (gaugeSeen.current.gauge !== (gauge ?? 'neither')) gaugeSeen.current = { gauge: gauge ?? 'neither', since: fightSeconds };
  const gaugeCalled = fightSeconds - gaugeSeen.current.since < GAUGE_CALL_SECONDS;
  /** What the fight did: how it ended, a line for each thing won or lost, her own ship, and the standing it moved. */
  const reportBody = (result: BattleResult) => (
    <div class="battle-report-body">
      <h2 class="battle-report-title">{TITLE[result.outcome]}</h2>
      <div class="k-sub">{outcomeText(state)}</div>
      <div class="book-rule light" />
      <ul class="battle-ledger">
        {(report ? reportRows(content, report) : []).map((row) => (
          <li key={row.text} class={row.tone ?? ''}>
            <Art id={row.icon} class="inline-icon" /> {row.text}
          </li>
        ))}
        <li>
          <Art id="ui.icon.hull" class="inline-icon" /> Your ship: hull {result.player.hull} of {me.hullMax}, sails {result.player.sailCondition}%, {result.player.crew} men
        </li>
      </ul>
      {report && standingChips(content, report, attacked).length ? (
        <div class="battle-standing">
          {standingChips(content, report, attacked).map((c) => (
            <span key={c.name} class={`k-tag ${c.d > 0 ? 'gold' : 'war'}`}>
              {c.name} {signed(c.d)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
  return (
    <div class="battle">
      {state.result ? null : (
        <div class="battle-cards">
          <ShipCard ship={me} tag="You" gold name={you.name} what={you.what} style={styleLine(content, me.classId)} oars={rowing(content, state, 'player')} />
          <ShipCard
            ship={enemy}
            tag={NATION_TAG[enemyNation ?? ''] ?? 'Enemy'}
            name={enemyName}
            what={`${enemyTitle} · ${enemy.guns} guns`}
            style={styleLine(content, enemy.classId)}
            hint={matchupHint(content, me.classId, enemy.classId)}
            wavering={wavering}
            oars={rowing(content, state, 'enemy')}
          />
        </div>
      )}
      {state.result ? null : <Compass {...compass} className="battle-compass" />}
      {showMind && state.minds?.enemy ? (
        <div class="battle-mind">
          {state.minds.enemy.intent} · board {state.minds.enemy.wants.board.toFixed(2)} · duel {state.minds.enemy.wants.duel.toFixed(2)} · stalk {state.minds.enemy.wants.stalk.toFixed(2)} · run{' '}
          {state.minds.enemy.wants.flee.toFixed(2)}
        </div>
      ) : null}
      <div class="battle-calls">
        {!state.result && now < mastCall.current.until ? <div class="battle-call battle-mast">{mastCall.current.text}</div> : null}
        {wavering && !state.result ? <div class="battle-call battle-waver">She's wavering: {waverWhy(content, enemy, me, apart)}. Keep at her and she'll strike.</div> : null}
      </div>
      {demand && !report && !fightOn ? (
        <div class="k-wood battle-demand">
          <div class="battle-demand-head">
            {demand.flag ? <img class="battle-demand-flag" src={demand.flag} alt="" /> : null}
            <div>
              <h2 class="battle-demand-title">{demand.name} calls on you to strike!</h2>
              <div class="k-say">“Strike your colours and keep your ship and your men, Captain.”</div>
            </div>
          </div>
          <div class="battle-demand-ifs">
            <div>
              <b>If you strike</b>
              <div class="k-sub">
                You keep the ship and every man. He takes {demand.chest > 0 ? `the plunder chest (${demand.chest.toLocaleString()} gold) and ` : ''}your hold
                {demand.chest > 0 ? '' : ': your plunder chest is empty'}.
              </div>
            </div>
            <div>
              <b>If you fight on</b>
              <div class="k-sub">Your boarders would carry his deck about {Math.round(board.odds * 100)}% of the time. Lose, and he takes the ship too.</div>
            </div>
          </div>
          <div class="moment-actions flush">
            <button class="k-btn primary" onClick={onStrike}>
              Strike your colours <Key k="Y" />
            </button>
            <button class="k-btn" onClick={() => setFightOn(true)}>
              Fight on
            </button>
          </div>
        </div>
      ) : null}
      <div class="battle-toasts">
        {/* Who holds the weather gauge: the ship to windward chooses when to close. */}
        {!state.result && !state.wreck && gaugeCalled ? (
          <div class={`battle-call battle-gauge ${gauge ?? 'neither'}`}>
            {gauge === 'player'
              ? 'Weather gauge: yours. You choose when to close; bear down to board, or hold off and fire.'
              : gauge === 'enemy'
                ? 'Weather gauge: hers. She chooses when to close; work to windward, or turn and run.'
                : 'Weather gauge: neither. Whoever wins the wind chooses when to close.'}
          </div>
        ) : null}
        {/* She means to board: the warning, how the chase goes, and what keeps her off. */}
        {!state.result && !state.wreck && state.grappling === 0 && state.enemyBoarding ? (
          <div class="battle-call battle-boarder">
            <span>
              She means to board! <b>{pace}.</b> Keep her outside the ring: bear away, or sweep her deck with grape.
            </span>
          </div>
        ) : !state.result && !state.wreck && state.grappling === 0 && apart > PACE_FROM_TILES ? (
          <div class="battle-call battle-pace">{pace}</div>
        ) : null}
        {repelSaid && !state.result ? (
          <div class={`battle-call battle-repel ${repelSaid}`}>{repelSaid === 'repelled' ? 'Boarders repelled! She sheers off.' : 'Too soon! Her boarders are coming over.'}</div>
        ) : null}
        {!state.result && !state.wreck && state.grappling === 0 && (board.active || (apart <= 12 && board.odds >= 0.5)) ? (
          <div class="battle-call battle-board">
            <Key k="G" />
            {board.active ? (
              <span>
                closing to board: your boarders carry her <b>{Math.round(board.odds * 100)}%</b> of the time · G or the helm to stop
              </span>
            ) : (
              <span>
                close to board: your boarders carry her <b>{Math.round(board.odds * 100)}%</b> of the time
              </span>
            )}
          </div>
        ) : null}
        {state.wreck && !state.result ? (
          <div class="battle-call battle-wreck">
            <span>
              She's gone down. Sail over the barrels and the men in the water ({state.wreck.gold} gold, {state.wreck.men} men so far) · Enter to leave the wreck
            </span>
            <span class="k-bar">
              <span style={{ width: `${Math.round(Math.max(0, (state.wreck.until - state.tick / 30) / content.combat.salvage.seconds) * 100)}%` }} />
            </span>
          </div>
        ) : null}
        {!state.result && !state.wreck && apart > b.warnTiles ? (
          <div class="battle-call battle-parting">
            <span>
              {apart > b.escapeTiles ? 'Drawing apart: close in or she is gone' : 'Drawing apart'}: <b>{Math.round(apart)} tiles</b>. Past {b.escapeTiles} she gets away.
            </span>
            <span class="k-bar">
              <span class="low" style={{ width: `${Math.round(Math.min(1, state.parting / b.escapeSeconds) * 100)}%` }} />
            </span>
          </div>
        ) : null}
        {!state.result && state.grappling > 0 ? (
          <div class="battle-call battle-grapple">
            <span>
              {state.boarding
                ? 'Grappled! Your boarders go over when the bar fills.'
                : board.repel > 0 && !state.repel
                  ? 'Grappled! Repel boarders: R as the bar reaches the gold.'
                  : 'Grappled! Her boarders are coming over.'}
            </span>
            <span class="k-bar battle-grapple-bar">
              <span class="low" style={{ width: `${Math.round(Math.min(1, state.grappling / b.grappleSeconds) * 100)}%` }} />
              {/* The repel window: the bar's last stretch, as wide as her crew and spirit make it. */}
              {board.repel > 0 && !state.repel ? <span class="battle-repel-window" style={{ width: `${Math.round((board.repel / b.grappleSeconds) * 100)}%` }} /> : null}
            </span>
          </div>
        ) : null}
      </div>
      {state.result ? null : (
        <div class="k-wood battle-guns">
          <div class="battle-gun">
            <span class="k-sub">Port</span>
            <b class={aim.port === 'ready' ? 'ready' : ''}>{gun('port')}</b>
          </div>
          <div class="battle-ammo">
            {SHOTS.map((s) => (
              <button key={s.id} class={`k-btn small${you.shot === s.id ? ' active' : ''}`} onClick={() => you.chooseShot(s.id)}>
                <Art id={s.icon} class="inline-icon" /> {s.name}
              </button>
            ))}
          </div>
          <div class="battle-gun">
            <span class="k-sub">Starboard</span>
            <b class={aim.starboard === 'ready' ? 'ready' : ''}>{gun('starboard')}</b>
          </div>
          {/* Her round shot won't bite those sides: say so where she chooses her shot. */}
          {you.shot === 'round' && shotHarmOf(content, me.classId, enemy.classId) < BARELY_MARKS ? (
            <div class="battle-gun-hint">{capital(content.combat.styles[content.ships[me.classId]!.style].shot)} shot barely marks her hull. Chain and grape still bite.</div>
          ) : null}
          <button
            class="k-btn small battle-sails"
            title={you.sails === 'full' ? 'Full sail: click for half sail, tighter turns and half the harm to her sails and masts (S)' : 'Half sail: click for full sail (W)'}
            onClick={() => you.setSails(you.sails === 'full' ? 'half' : 'full')}
          >
            <Art id={`ui.icon.${you.sails}_sail`} class="inline-icon" /> {you.sails === 'full' ? 'Full sail' : 'Half sail'}
          </button>
          <button
            class={`k-btn small battle-shake${shake.on ? ' active' : ''}`}
            aria-label="Camera shake"
            title={shake.on ? 'The view shakes at each broadside and blow: click to keep it still' : 'The view keeps still: click to let it shake at each broadside and blow'}
            onClick={shake.toggle}
          >
            {shake.on ? 'Shake' : 'Still'}
          </button>
          <span class="battle-help">
            <Key k="F1" /> keys
          </span>
        </div>
      )}
      {state.result && offer ? (
        <div class="battle-report-screen">
          <Plunder content={content} offer={offer} name={enemyName} report={reportBody(state.result)} onPlunder={onPlunder} />
          {advice ? <div class="battle-advice">{advice}</div> : null}
        </div>
      ) : state.result ? (
        <div class="battle-report-screen">
          <div class="k-wood battle-report">
            {PICTURES[PICTURE[state.result.outcome]] ? <img class="battle-report-picture" src={PICTURES[PICTURE[state.result.outcome]]} alt="" /> : null}
            <div class="battle-report-text">
              {reportBody(state.result)}
              <div class="battle-report-go">
                <button class="k-btn primary" onClick={onContinue}>
                  Continue <Key k="Enter" />
                </button>
              </div>
            </div>
          </div>
          {advice ? <div class="battle-advice">{advice}</div> : null}
        </div>
      ) : null}
      {help?.open ? <Help close={help.close} /> : null}
    </div>
  );
}
