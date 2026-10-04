import type { Command, Sim } from '@corsair/core';

export interface LoopControl {
  paused: boolean;
}

/** PRD section 16 debug API, the browser subset this slice needs. Lives here until @corsair/devtools exists. */
export function createDebugApi(sim: Sim, loop: LoopControl) {
  return {
    state: {
      get(path = ''): unknown {
        let node: unknown = sim.state;
        for (const key of path.split('.').filter(Boolean)) {
          node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
        }
        return structuredClone(node);
      },
      hash: () => sim.hash(),
    },
    sim: {
      step(ticks = 1) {
        sim.step(ticks);
        return sim.state.tick;
      },
      pause() {
        loop.paused = true;
      },
      resume() {
        loop.paused = false;
      },
    },
    cmd: {
      send(command: Command) {
        sim.send(command);
      },
    },
    log: {
      query(filter: { type?: string; since?: number } = {}) {
        return sim
          .events()
          .filter((e) => (!filter.type || e.type === filter.type) && (filter.since === undefined || e.tick >= filter.since))
          .map((e) => structuredClone(e));
      },
    },
    replay: {
      inputs: () => structuredClone(sim.inputs()),
    },
  };
}

declare global {
  interface Window {
    __corsair: ReturnType<typeof createDebugApi>;
  }
}
