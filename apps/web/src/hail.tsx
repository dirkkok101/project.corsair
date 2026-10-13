import type { ComponentChildren } from 'preact';
import type { Ship, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';
import { foodDays, newsText } from '@corsair/systems-economy';
import { Key, Speech } from './ui/kit';
import { Art, shipKind } from './ui-art';

export const NATION_ADJECTIVE: Record<string, string> = {
  spain: 'Spanish',
  england: 'English',
  france: 'French',
  netherlands: 'Dutch',
  pirate: 'pirate',
};

/** "Dutch fluyt": who a ship is, as the lookout would call it. */
/** Her crew's grade as the eye reads it from her deck ("a veteran crew"); nothing for an ordinary one. */
export function crewLook(ship: Ship): string {
  const grade = ship.ai?.crew;
  return grade && grade !== 'regular' ? `a ${grade} crew` : '';
}

export function shipTitle(ship: Ship): string {
  const cls = ship.classId.replace(/^ship\./, '').replace(/_/g, ' ');
  return `${NATION_ADJECTIVE[ship.ai?.nation ?? ''] ?? ''} ${cls}`.trim();
}

export interface HailProps {
  state: WorldState;
  content: ContentPack;
  settlements: PlacedSettlement[];
  ship: Ship;
  /** News ids the hail brought that the captain hadn't heard. */
  news: string[];
  close: () => void;
  /** Open fire: starts a sea battle. */
  attack: () => void;
  /** The nation whose letter of marque makes this attack lawful, if any. */
  lawful?: string;
  /** Buy up to this much of her spare food; and the room in the hold for it. */
  buyFood: (units: number) => void;
  room: number;
}

/** Who speaks for a ship hailed: her captain's bust by her role. */
const BUST: Record<string, string> = { merchant: 'bust.captain.merchant', patrol: 'bust.captain.navy', pirate: 'bust.captain.pirate' };
const COUNTRY: Record<string, string> = { spain: 'Spain', england: 'England', france: 'France', netherlands: 'the Netherlands' };

/**
 * Speaking a ship at sea (storyboard 4.3, PRD section 4): her captain on a speech card, with her flag, class and crew
 * as tags; what she carries and where she is bound; food from her stores; attacking her, with what it means; her news.
 */
export function Hail({ state, content, settlements, ship, news, close, attack, lawful, buyFood, room }: HailProps) {
  const ai = ship.ai!;
  const name = (id: string) => settlements.find((s) => s.id === id)?.name ?? id;
  const goods = Object.keys(ship.cargo).map((g) => content.goods.find((x) => x.id === g)?.name.toLowerCase() ?? g);
  const wealth = ai.famous ? (state.famous?.[ai.famous]?.wealth ?? content.pirates.captains.find((c) => c.id === ai.famous)?.wealth ?? 0) : 0;
  // What her captain says, and what the eye and the talk add.
  const line =
    ai.role === 'merchant'
      ? `"We're bound for ${name(ai.to)}${goods.length ? ` with ${goods.join(' and ')}` : ', sailing light'}, Captain. Fair winds to you."`
      : ai.role === 'patrol'
        ? `"On patrol for ${COUNTRY[ai.nation] ?? 'the Crown'}, bound for ${name(ai.to)}. Mind how you go, Captain."`
        : ai.famous
          ? `"You know who I am, Captain. Most do."`
          : `"What's your business? Keep your distance."`;
  const errand = ai.famous
    ? `${ai.name} himself: worth about ${wealth.toLocaleString()} gold, by the talk in the taverns. Beat him and half of it is yours.`
    : ai.role === 'pirate'
      ? 'A hard-looking crew. She keeps a wary distance and answers short.'
      : ai.role === 'patrol'
        ? 'Her gunports are closed.'
        : '';
  const prizes = ai.prizes ?? [];
  const mine = prizes.filter((p) => p.takenFrom === 'player');
  const kind = (classId: string) => classId.replace(/^ship\./, '').replace(/_/g, ' ');
  const towing = prizes.length
    ? `She has ${prizes.length === 1 ? 'a prize' : `${prizes.length} prizes`} in tow${
        mine.length ? `: ${mine.map((p) => `your ${kind(p.classId)} ${p.name}`).join(' and ')}${mine.length < prizes.length ? ' among them' : ''}` : ''
      }. Take her and ${prizes.length === 1 ? 'she is' : 'they are'} free.`
    : '';
  const items = news.map((id) => state.news?.find((n) => n.id === id)).filter((n) => n !== undefined);
  const consequence =
    ai.nation === 'pirate'
      ? 'a pirate: fair game, and any governor pays a bounty for her'
      : lawful
        ? `lawful under your ${NATION_ADJECTIVE[lawful]} letter of marque: a bounty from its governors`
        : `angers the ${NATION_ADJECTIVE[ai.nation]}: no letter of marque covers her`;
  return (
    <div class="hail">
      <div class="k-wood hail-card">
        <div class="hail-tags">
          <span class={`k-tag${ai.nation === 'pirate' ? '' : ' war'}`}>{NATION_ADJECTIVE[ai.nation] ?? ai.nation}</span>
          <span class="k-tag">
            {shipKind(ship.classId)} · {ai.famous ? 'famous pirate' : ai.role === 'patrol' ? 'man-of-war' : ai.role}
          </span>
          {crewLook(ship) ? <span class="k-tag">{crewLook(ship)}</span> : null}
          {(ship.upgrades ?? []).map((u) => (
            <span key={u} class="k-tag">
              {content.upgrades[u]?.name.toLowerCase() ?? u}
            </span>
          ))}
          <span class="hail-near k-sub">within hailing distance</span>
        </div>
        <Speech bust={BUST[ai.role] ?? 'bust.captain.merchant'} who={ai.name} line={line}>
          {errand ? <div class="k-sub">{errand}</div> : null}
          {towing ? <div class={`k-sub${mine.length ? ' hail-yours' : ''}`}>{towing}</div> : null}
        </Speech>
        <div class="book-rule light" />
        <div class="hail-rows">
          <Provisions content={content} state={state} ship={ship} buyFood={buyFood} room={room} />
          <div class="hail-row hail-attack">
            <Art id="ui.icon.round_shot" class="inline-icon" />
            <div class="hail-what">
              Attack her · <span class="k-sub">{consequence}</span>
            </div>
            <button class="k-btn primary attack" onClick={attack}>
              Attack
            </button>
          </div>
          {items.map((n) => (
            <div key={n.id} class="hail-row hail-news">
              <span class="k-tag news">news</span>
              <div class="hail-what">{newsText(content, n, name(n.settlementId))}</div>
            </div>
          ))}
          <div class="hail-row">
            <span class="hail-what k-sub">
              {items.length ? `${items.length === 1 ? 'Her news goes' : `${items.length} pieces of news go`} to your log.` : "She has no news you haven't heard."}
            </span>
            <button class="k-btn" onClick={close}>
              Sail on <Key k="Esc" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Food from her spare stores (dear, as far from market), for a captain running short at sea: what she can spare,
 * the price, and one click for as much as the hold and purse allow. A pirate, or a ship of a nation that hunts the
 * captain, says why she won't.
 */
function Provisions({ content, state, ship, buyFood, room }: { content: ContentPack; state: WorldState; ship: Ship; buyFood: (units: number) => void; room: number }) {
  const sp = content.economy.seaProvisions;
  const ai = ship.ai!;
  const standing = state.captain?.standing?.[ai.nation as keyof NonNullable<NonNullable<WorldState['captain']>['standing']>] ?? 0;
  const row = (text: string, button?: ComponentChildren) => (
    <div class="hail-row hail-food">
      <Art id="ui.icon.food" class="inline-icon" />
      <div class="hail-what">{text}</div>
      {button}
    </div>
  );
  if (ai.nation === 'pirate') return row('She has no food to sell you: pirates keep what they have.');
  if (standing <= sp.refuseBelow) return row(`Her captain won't trade with you: the ${NATION_ADJECTIVE[ai.nation]} want you hanged.`);
  const price = Math.ceil((content.goods.find((g) => g.id === 'food')?.basePrice ?? 2) * sp.markup);
  const left = sp.spare - (state.captain?.provisionsFrom?.[ship.id] ?? 0);
  if (left <= 0) return row('She has no more food to spare.');
  const gold = state.captain?.gold ?? 0;
  const mine = Object.values(state.ships).find((s) => !s.ai);
  const can = Math.min(left, room, Math.floor(gold / price));
  const why = room <= 0 ? 'Your hold is full.' : gold < price ? 'Not enough gold.' : undefined;
  return row(
    `Buy food from her stores: up to ${left}, at ${price} gold each (dear: far from market). You have ${gold.toLocaleString()} gold${
      mine ? `, ${Math.floor(foodDays(content, mine))} days of food aboard` : ''
    } and room for ${Math.max(0, room)}.`,
    <button class="k-btn" disabled={can <= 0} title={why} onClick={() => buyFood(can)}>
      Buy {Math.max(0, can)} food · {Math.max(0, can) * price} gold
    </button>,
  );
}
