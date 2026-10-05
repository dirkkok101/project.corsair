import { dateOf, formatDate, fromSave } from '@corsair/core';
import type { Save } from '@corsair/core';
import type { PlacedSettlement } from '@corsair/data';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { exportSave, pickSaveFile } from './save';

export interface StartOptions {
  /** The stored career, as read from the browser. */
  stored: Save;
  fingerprint: string;
  startDate: string;
  ticksPerDay: number;
  settlements: PlacedSettlement[];
}

/** The start screen, shown when a career is saved: resolves to the save to continue, or undefined for a new career. */
export function chooseCareer(root: HTMLElement, opts: StartOptions): Promise<Save | undefined> {
  return new Promise((resolve) => {
    const done = (save: Save | undefined) => {
      render(null, root);
      resolve(save);
    };
    render(<Start {...opts} done={done} />, root);
  });
}

function Start({ stored, fingerprint, startDate, ticksPerDay, settlements, done }: StartOptions & { done: (save: Save | undefined) => void }) {
  const [save, setSave] = useState(stored);
  const [error, setError] = useState<string>();
  const state = save.state;
  const ship = Object.values(state.ships)[0];
  const where = ship?.docked ? settlements.find((s) => s.id === ship.docked)?.name : undefined;
  const date = formatDate(dateOf(startDate, Math.floor(state.tick / ticksPerDay)));
  const mismatch = save.content !== fingerprint;

  const load = () =>
    pickSaveFile()
      .then((raw) => {
        setSave(fromSave(raw, fingerprint).save);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));

  return (
    <div class="start">
      <div class="start-panel">
        <h1>Project Corsair</h1>
        <div class="start-career">
          <div>{date}</div>
          <div class="start-sub">
            {where ? `In port at ${where}` : 'At sea'} · {(state.captain?.gold ?? 0).toLocaleString()} gold
          </div>
          {mismatch ? <div class="start-warn">This save was made with different game data; it may not play the same.</div> : null}
        </div>
        <div class="start-actions">
          <button class="primary" onClick={() => done(save)}>
            Continue
          </button>
          <button onClick={() => done(undefined)}>New career</button>
        </div>
        <div class="start-files">
          <button onClick={() => exportSave(save, `corsair-${date.replace(/\s+/g, '-')}.json`)}>Save to file</button>
          <button onClick={load}>Load from file</button>
        </div>
        {error ? <div class="start-warn">{error}</div> : null}
        <div class="start-note">A new career replaces this one the first time you save (dock, or Ctrl+S).</div>
      </div>
    </div>
  );
}
