import type { Voyage } from '@corsair/core';
import type { PortService } from '@corsair/systems-economy';
import { ART } from './ui-art';
import { Bust, curly, Key } from './ui/kit';

// The First Voyage as the player sees it (docs/design/first-voyage.md): the quartermaster's lines, the orders card,
// and the staged port. The sim owns the voyage (Captain.voyage); this only presents it.

/** The quartermaster, the voyage's one voice. */
export const NED = { bust: 'bust.oldsalt', who: 'Ned Tully, quartermaster' };

/** One of her orders: what to do, a few words more, and whether it is done. */
export interface Order {
  text: string;
  sub?: string;
  done: boolean;
}

const AFTER: Voyage['step'][] = ['harbour', 'helm', 'salvage', 'prize', 'home', 'governor', 'done'];
const past = (v: Voyage, step: Voyage['step']) => AFTER.indexOf(v.step) > AFTER.indexOf(step);

/** Her orders: the governor's three, with the pirate to take put in once she is sighted off the cay; then, home with her prize, the port's three. */
export function voyageOrders(v: Voyage, home: string): Order[] {
  const did = (l: string) => (v.lessons ?? []).includes(l) || past(v, 'home');
  if (v.step === 'governor') return [{ text: 'See the governor', sub: "he's heard of your prize", done: false }];
  if (v.ashore)
    return [
      { text: 'Sell the sugar', sub: 'the merchant', done: did('sold') },
      { text: 'Mount a full battery', sub: 'the shipwright', done: did('battery') },
      { text: 'Share out the plunder', sub: 'the tavern', done: did('shared') },
    ];
  return [
    { text: `Sail out to ${v.cay.name}`, sub: `a short sail ${v.cay.bearing} · the smoke on the horizon`, done: past(v, 'helm') },
    { text: 'See what the storm left', done: past(v, 'salvage') },
    ...(past(v, 'salvage') ? [{ text: `Take the pirate${v.pirate ? ` ${v.pirate}` : ''}`, sub: "she's no great guns", done: past(v, 'prize') }] : []),
    { text: `Bring it home to ${home}`, done: past(v, 'home') },
  ];
}

/** The orders as a numbered list, each struck through once done. */
export function OrdersList({ orders }: { orders: Order[] }) {
  return (
    <ol class="orders">
      {orders.map((o, i) => (
        <li key={o.text} class={o.done ? 'done' : ''}>
          <span class="orders-n">{i + 1}</span>
          <span>
            <span class="orders-text">{o.text}</span>
            {o.sub ? <span class="orders-sub"> · {o.sub}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The orders card on the harbour and the sea: the order in hand lit, the rest dim, with how far for the one in hand. */
export function OrdersCard({ orders, far }: { orders: Order[]; far?: string }) {
  const now = orders.findIndex((o) => !o.done);
  return (
    <div class="k-wood voyage-orders">
      <span class="voyage-label">
        Orders · {Math.min(now < 0 ? orders.length : now + 1, orders.length)} of {orders.length}
      </span>
      {orders.map((o, i) => (
        <div key={o.text} class={`voyage-order${i === now ? ' now' : ''}${o.done ? ' done' : ''}`}>
          <span class="voyage-num">{i + 1}</span>
          <span>{o.text}</span>
          {i === now && far ? <span class="voyage-far">{far}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Why a building stands shuttered at this step, in a line. */
export function shutWhy(v: Voyage, service: PortService): string {
  const early = AFTER.indexOf(v.step) < AFTER.indexOf('home');
  if (service === 'governor') return early ? 'Sees captains who bring him news. Come back with a prize.' : "He's heard of your prize. He'll see you when your ship is fit.";
  if (service === 'merchant') return 'Nothing in your hold to sell yet.';
  if (service === 'tavern') return "The crew drink when there's plunder to share.";
  return 'Guns cost more than your purse holds today.';
}

/** What the quartermaster says in the harbour, by the step. */
export function harbourLine(v: Voyage): string | undefined {
  if (v.step === 'harbour') return `"Wind's fair for the cay, Captain. Say the word and we cast off."`;
  if (v.step === 'governor') return `"The governor's heard of your prize, Captain. He'll see you now."`;
  if (!v.ashore) return undefined;
  const did = new Set(v.lessons ?? []);
  if (!did.has('sold')) return `"Sell the sugar first, Captain, and the guns are yours. The lads will want their share before we sail."`;
  if (!did.has('battery')) return `"Now the guns, Captain: a full battery, and pirates think twice."`;
  return `"The lads want their share, Captain: the tavern, and a round on you."`;
}

/** What a building is for, home with her prize: its chore in a few words, and whether it is done. */
export function homeNeed(v: Voyage, service: PortService, need: { sugar: number; guns: number; gunGold: number; chest: number }): { text: string; done: boolean } | undefined {
  if (!v.ashore || v.step !== 'home') return undefined;
  const did = new Set(v.lessons ?? []);
  if (service === 'merchant') return did.has('sold') ? { text: 'Sold', done: true } : { text: `${need.sugar} sugar to sell`, done: false };
  if (service === 'shipwright')
    return did.has('battery') ? { text: 'Battery full', done: true } : { text: `${need.guns} guns to mount: ${(need.guns * need.gunGold).toLocaleString('en-GB')}`, done: false };
  if (service === 'tavern') return did.has('shared') ? { text: 'Shared out', done: true } : { text: `${need.chest.toLocaleString('en-GB')} to share`, done: false };
  return undefined;
}

/** The quartermaster's line, with his bust: on the harbour, and at sea when he has something to say. */
export function NedSays({ line, label }: { line: string; label?: string }) {
  return (
    <div class="k-wood voyage-ned">
      <Bust id={NED.bust} label={NED.who} />
      <div class="voyage-ned-body">
        {label ? <span class="voyage-label">{label}</span> : <span class="voyage-who">{NED.who}</span>}
        <span class="voyage-say">{curly(line)}</span>
      </div>
    </div>
  );
}

/** The lessons of the helm, in order: what each is called, and the key and words that teach it. */
const LESSONS = [
  { id: 'steer', name: 'Steer', key: 'A D', text: 'Steer her toward the smoke' },
  { id: 'sail', name: 'More sail', key: 'W', text: "More sail: she'll go faster" },
  { id: 'wind', name: 'The wind', key: '', text: '' },
] as const;

/**
 * At sea on the way to the cay: the lesson in hand (one prompt, its key and a few words), the row of lessons with the
 * ones done ticked, and the quartermaster's word when she points too close to the wind. `windShown`: the wind's
 * lesson has been shown; `irons`: she points into the wind now.
 */
export function HelmLessons({ v, irons, windShown }: { v: Voyage; irons: boolean; windShown: boolean }) {
  const learned = new Set(v.lessons ?? []);
  if (windShown && !irons) learned.add('wind');
  const next = LESSONS.find((l) => !learned.has(l.id) && l.id !== 'wind');
  return (
    <>
      {irons ? <NedSays label="Too close to the wind" line={`"Too close to the wind, Captain: she'll stall. Bear away a point."`} /> : null}
      {next || irons ? (
        <div class="voyage-lesson">
          {next && !irons ? (
            <div class="voyage-prompt">
              {next.key.split(' ').map((k) => (
                <Key key={k} k={k} />
              ))}
              <span>{next.text}</span>
            </div>
          ) : null}
          <div class="voyage-pips">
            {LESSONS.map((l) => (
              <span key={l.id} class={`voyage-pip${learned.has(l.id) ? ' done' : (next?.id ?? (irons ? 'wind' : '')) === l.id ? ' now' : ''}`}>
                {l.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The cay's name over its smoke on the sea, where the renderer projects it (undefined off screen). */
export function CayMark({ name, at }: { name: string; at?: { px: number; py: number } }) {
  if (!at) return null;
  return (
    <div class="voyage-cay" style={{ left: `${at.px}px`, top: `${at.py}px` }}>
      {ART['ui.icon.course'] ? <img src={ART['ui.icon.course']} alt="" draggable={false} /> : null}
      {name} · smoke
    </div>
  );
}
