import type { GameEvent, System, WorldState } from '@corsair/core';
import type { ContentPack, PlacedSettlement } from '@corsair/data';

/** Whether the captain knows of a port: every nation's port, the havens that always stand, and the coves she has found. */
export function havenKnown(content: ContentPack, state: Pick<WorldState, 'captain'>, s: Pick<PlacedSettlement, 'id' | 'nation'>): boolean {
  return s.nation !== 'pirate' || content.havens.keep.includes(s.id) || Boolean(state.captain?.knownHavens?.includes(s.id));
}

/**
 * Finding the pirate havens (hidden until found, havens.json): the captain learns of a cove when she sights it, docks
 * there, hails a pirate bound to or from it, takes a pirate who sailed from it, or hears tavern news from it.
 */
export function createHavensSystem(content: ContentPack, settlements: PlacedSettlement[]): System {
  const havens = settlements.filter((s) => s.nation === 'pirate');
  const isHaven = (id?: string) => havens.some((h) => h.id === id);
  return {
    name: 'havens',
    tick: (state) => ({ state, events: [] }),
    observe(state: WorldState, events: readonly GameEvent[]) {
      if (!state.captain) return state;
      const found = new Set<string>();
      const me = Object.values(state.ships).find((s) => !s.ai);
      // In sight of her mast-head.
      if (me) for (const h of havens) if (Math.hypot(h.x - me.x, h.y - me.y) <= content.traffic.sightTiles) found.add(h.id);
      for (const e of events) {
        if (e.type === 'Docked') found.add(e.entityIds[1]!);
        // A pirate hailed says where she sails from and to.
        if (e.type === 'Hailed') {
          const her = state.ships[e.entityIds[1]!];
          if (her?.ai) for (const id of [her.ai.from, her.ai.to]) found.add(id);
        }
        // A pirate taken gives up her haven.
        if (e.type === 'BattleOver' && e.payload.nation === 'pirate') {
          const her = state.prize?.ship ?? state.ships[e.entityIds[1]!];
          if (her?.ai) found.add(her.ai.from);
        }
        // Tavern news from a cove.
        if (e.type === 'NewsHeard') {
          for (const id of (e.payload.ids as string[]) ?? []) found.add(state.news?.find((n) => n.id === id)?.settlementId ?? '');
        }
      }
      const known = state.captain.knownHavens ?? [];
      const fresh = [...found].filter((id) => isHaven(id) && !known.includes(id) && !havenKnown(content, state, { id, nation: 'pirate' }));
      if (!fresh.length) return state;
      return { ...state, captain: { ...state.captain, knownHavens: [...known, ...fresh] } };
    },
  };
}
