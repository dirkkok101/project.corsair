import type { Voyage } from '@corsair/core';

// The First Voyage as the player sees it (docs/design/first-voyage.md): the quartermaster's lines, the orders card,
// and the staged port. The sim owns the voyage (Captain.voyage); this only presents it.

/** One of her orders: what to do, a few words more, and whether it is done. */
export interface Order {
  text: string;
  sub?: string;
  done: boolean;
}

const AFTER: Voyage['step'][] = ['harbour', 'helm', 'salvage', 'prize', 'home', 'governor', 'done'];
const past = (v: Voyage, step: Voyage['step']) => AFTER.indexOf(v.step) > AFTER.indexOf(step);

/** The first chapter's orders, as the governor's letter gives them. */
export function voyageOrders(v: Voyage, home: string): Order[] {
  return [
    { text: `Sail out to ${v.cay.name}`, sub: `a short sail ${v.cay.bearing} · the smoke on the horizon`, done: past(v, 'helm') },
    { text: 'See what the storm left', done: past(v, 'salvage') },
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
