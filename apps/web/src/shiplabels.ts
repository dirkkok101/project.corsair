import { inPort } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { shipTitle } from './hail';

// "Spanish frigate" under every AI ship near the player (a famous pirate by his name), so nations read at a
// glance alongside the flags; the prizes she tows as a count. DOM text over the 3D view, placed where the
// 3D camera shows each ship; hidden in port and in battle.
const NEAR_TILES = 14;
const BELOW_PX = 22;

export function createShipLabels(parent: HTMLElement) {
  const layer = parent.appendChild(document.createElement('div'));
  layer.className = 'ship-labels';
  const nodes = new Map<string, HTMLDivElement>();

  return {
    /** `project` gives a sea point's place on the screen (CSS pixels); `shown` false hides them all. */
    update(state: WorldState, playerId: string, project: (x: number, y: number) => { px: number; py: number } | undefined, shown: boolean) {
      layer.hidden = !shown;
      const me = state.ships[playerId];
      const seen = new Set<string>();
      for (const ship of shown ? Object.values(state.ships) : []) {
        if (!ship.ai || inPort(ship) || !me || Math.hypot(ship.x - me.x, ship.y - me.y) > NEAR_TILES) continue;
        const at = project(ship.x, ship.y);
        if (!at) continue;
        seen.add(ship.id);
        let el = nodes.get(ship.id);
        if (!el) {
          el = layer.appendChild(document.createElement('div'));
          nodes.set(ship.id, el);
        }
        el.className = `ship-label label-${ship.ai.nation}`;
        const towing = ship.ai.prizes?.length ?? 0;
        const name = ship.ai.famous ? `${ship.ai.name}'s ${shipTitle(ship).replace(/^(a|an|the) /i, '').replace(/^pirate /, '')}` : shipTitle(ship);
        // First letter up ("Pirate sloop"); names keep their own case.
        const shown = name.replace(/^./, (c) => c.toUpperCase());
        el.textContent = towing ? `${shown} +${towing}` : shown;
        el.style.transform = `translate(${Math.round(at.px)}px, ${Math.round(at.py + BELOW_PX)}px) translateX(-50%)`;
      }
      for (const [id, el] of nodes) {
        if (seen.has(id)) continue;
        el.remove();
        nodes.delete(id);
      }
    },
  };
}
