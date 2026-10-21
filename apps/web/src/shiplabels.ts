import { inPort } from '@corsair/core';
import type { WorldState } from '@corsair/core';
import { NATION_ADJECTIVE } from './hail';
import { shipKind } from './ui-art';

// Under every AI ship near the player, on a short line from her: her nation as a tag, her name, and what she is
// ("fluyt, merchant"), so who she is and whether she is worth a chase read at a glance; the prizes she tows as a
// count. DOM over the 3D view, placed where the 3D camera shows each ship; hidden in port and in battle.
export const NEAR_TILES = 14;
const BELOW_PX = 18;

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
        const role = ship.ai.famous ? 'famous pirate' : ship.ai.role === 'patrol' ? 'man-of-war' : ship.ai.role;
        const tag = NATION_ADJECTIVE[ship.ai.nation] ?? ship.ai.nation;
        const text = `${tag}|${ship.ai.name}|${shipKind(ship.classId)}, ${role}${towing ? ` +${towing}` : ''}`;
        // Rebuilt only when it changes: this runs every frame.
        if (el.dataset.text !== text) {
          el.dataset.text = text;
          el.replaceChildren();
          const box = el.appendChild(document.createElement('span'));
          box.className = 'ship-label-box';
          const t = box.appendChild(document.createElement('span'));
          t.className = 'ship-label-tag';
          t.textContent = tag.replace(/^./, (c) => c.toUpperCase());
          box.appendChild(document.createElement('b')).textContent = ship.ai.name;
          box.append(` · ${shipKind(ship.classId)}, ${role}${towing ? ` +${towing}` : ''}`);
        }
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
