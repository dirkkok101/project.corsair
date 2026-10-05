import { hashState } from './hash';
import type { Command, GameEvent, WorldState } from './state';

export const TICKS_PER_SECOND = 30;

export type EmittedEvent = Omit<GameEvent, 'tick' | 'system'>;

export interface SystemResult {
  state: WorldState;
  events: EmittedEvent[];
}

export interface System {
  name: string;
  /** Returns a result when this system owns the command, undefined otherwise. */
  command?(state: WorldState, command: Command): SystemResult | undefined;
  tick(state: WorldState, dt: number): SystemResult;
}

export interface InputRecord {
  tick: number;
  command: Command;
  /** Applied with the clock stopped (in port) at `tick`, rather than at the start of tick `tick`. */
  immediate?: true;
}

export interface Sim {
  readonly state: WorldState;
  send(command: Command): void;
  step(ticks?: number): void;
  /** Apply queued commands without advancing the clock (world time stops in port, PRD section 2). */
  applyCommands(): void;
  hash(): string;
  /** Recent events, oldest first (ring buffer). */
  events(): readonly GameEvent[];
  /** Every command with the tick it was applied on: seed + this log replays the run. */
  inputs(): readonly InputRecord[];
}

const EVENT_LOG_SIZE = 50_000;

export function createSim(initial: WorldState, systems: System[]): Sim {
  let state = initial;
  const queue: Command[] = [];
  const log: GameEvent[] = [];
  const inputs: InputRecord[] = [];
  const dt = 1 / TICKS_PER_SECOND;

  const record = (tick: number, system: string, events: EmittedEvent[]) => {
    for (const e of events) log.push({ ...e, tick, system });
    if (log.length > EVENT_LOG_SIZE) log.splice(0, log.length - EVENT_LOG_SIZE);
  };

  const dispatch = (tick: number, command: Command) => {
    for (const system of systems) {
      const result = system.command?.(state, command);
      if (!result) continue;
      state = result.state;
      record(tick, system.name, result.events);
      return;
    }
    record(tick, 'core', [{ type: 'CommandRejected', entityIds: [], payload: { command } }]);
  };

  return {
    get state() {
      return state;
    },
    send(command) {
      queue.push(command);
    },
    applyCommands() {
      for (const command of queue.splice(0)) {
        inputs.push({ tick: state.tick, command, immediate: true });
        dispatch(state.tick, command);
      }
    },
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        const tick = state.tick + 1;
        // Commands apply at the start of the tick, before any system runs, so replays line up.
        for (const command of queue.splice(0)) {
          inputs.push({ tick, command });
          dispatch(tick, command);
        }
        for (const system of systems) {
          const result = system.tick(state, dt);
          state = result.state;
          record(tick, system.name, result.events);
        }
        state = { ...state, tick };
      }
    },
    hash: () => hashState(state),
    events: () => log,
    inputs: () => inputs,
  };
}
