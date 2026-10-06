import type { WorldState } from '@corsair/core';
import { shipTitle } from './hail';

// "Spanish frigate" under every AI ship near the player, so nations read at a glance alongside the
// flags. DOM text over the canvas, like the town labels, and hidden in port and battle the same way.
const NEAR_TILES = 12;
const BELOW_PX = 20; // under the hull, in view pixels

export function createShipLabels(parent: HTMLElement, tileSize: number) {
  const layer = parent.appendChild(document.createElement('div'));
  layer.className = 'labels ship-labels';
  const nodes = new Map<string, HTMLDivElement>();

  return {
    /** `camera` is the top-left of the view in world pixels; `scale` is CSS pixels per art pixel. */
    update(state: WorldState, playerId: string, camera: { x: number; y: number }, scale: number) {
      const me = state.ships[playerId];
      const seen = new Set<string>();
      for (const ship of Object.values(state.ships)) {
        if (!ship.ai || !me || Math.hypot(ship.x - me.x, ship.y - me.y) > NEAR_TILES) continue;
        seen.add(ship.id);
        let el = nodes.get(ship.id);
        if (!el) {
          el = layer.appendChild(document.createElement('div'));
          nodes.set(ship.id, el);
        }
        el.className = `label ship-label label-${ship.ai.nation}`;
        el.textContent = shipTitle(ship);
        const vx = ship.x * tileSize - camera.x;
        const vy = ship.y * tileSize + BELOW_PX - camera.y;
        el.style.transform = `translate(${vx * scale}px, ${vy * scale}px) translateX(-50%)`;
      }
      for (const [id, el] of nodes) {
        if (seen.has(id)) continue;
        el.remove();
        nodes.delete(id);
      }
    },
  };
}
