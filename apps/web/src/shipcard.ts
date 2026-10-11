import { renderShipCard } from '@corsair/render3d';

// A ship class's card portrait (dev server: /shipcard.html?class=ship.pinnace), for tools/art/render_ship_cards.ts.
// Sets `window.__card` once it is drawn.
document.body.append(renderShipCard(new URLSearchParams(location.search).get('class') ?? 'ship.brig', 720, 480));
(window as unknown as { __card: boolean }).__card = true;
