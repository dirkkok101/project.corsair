import { dateOf, formatDate, fromSave } from '@corsair/core';
import type { Save } from '@corsair/core';
import type { PlacedSettlement } from '@corsair/data';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { exportSave, pickSaveFile } from './save';

// Title painting (tools/art/import_paintings.ts); the screen falls back to plain dark without it.
const titleArt = Object.values(
  import.meta.glob<string>('../../../art/game/scenes/title.main.png', { eager: true, query: '?url', import: 'default' }),
)[0];

export interface StartOptions {
  /** What the browser holds for the career slot, before any checks. */
  raw: unknown;
  fingerprint: string;
  startDate: string;
  ticksPerDay: number;
  settlements: PlacedSettlement[];
}

/** The start screen, shown when a career is stored: resolves to the save to continue, or undefined for a new career. */
export function chooseCareer(root: HTMLElement, opts: StartOptions): Promise<Save | undefined> {
  return new Promise((resolve) => {
    const done = (save: Save | undefined) => {
      render(null, root);
      resolve(save);
    };
    render(<Start {...opts} done={done} />, root);
  });
}

/** A readable save, or why the stored one can't be opened. */
function read(raw: unknown, fingerprint: string): { save: Save } | { reason: string } {
  try {
    return { save: fromSave(raw, fingerprint).save };
  } catch (e) {
    return { reason: (e as Error).message };
  }
}

function Start({ raw, fingerprint, startDate, ticksPerDay, settlements, done }: StartOptions & { done: (save: Save | undefined) => void }) {
  const [career, setCareer] = useState(() => ({ raw, ...read(raw, fingerprint) }));
  const [error, setError] = useState<string>();

  const load = () =>
    pickSaveFile()
      .then((file) => {
        const next = read(file, fingerprint);
        if ('reason' in next) throw new Error(next.reason);
        setCareer({ raw: file, ...next });
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message));

  // An unreadable save is kept, not thrown away: the player can still copy it to a file before
  // starting over, since a new career overwrites the slot on its first save.
  const save = 'save' in career ? career.save : undefined;
  // The player's ship: the one without an AI captain (AI ship ids sort before it).
  const ship = save && Object.values(save.state.ships).find((s) => !s.ai);
  const where = ship?.docked ? settlements.find((s) => s.id === ship.docked)?.name : undefined;
  const date = save ? formatDate(dateOf(startDate, Math.floor(save.state.tick / ticksPerDay))) : undefined;
  const fileName = `corsair-${date ? date.replace(/\s+/g, '-') : 'unreadable'}.json`;

  return (
    <div class="start" style={titleArt ? { backgroundImage: `url(${titleArt})` } : undefined}>
      {/* The painting leaves its top third open sky for the title; the career panel sits on the sea. */}
      <h1 class="start-title">Project Corsair</h1>
      <div class="start-panel">
        <div class="start-career">
          {save ? (
            <>
              <div>{date}</div>
              <div class="start-sub">
                {where ? `In port at ${where}` : 'At sea'} · {(save.state.captain?.gold ?? 0).toLocaleString()} gold
              </div>
              {save.content !== fingerprint ? (
                <div class="start-warn">This save was made with different game rules; it may not play the same.</div>
              ) : null}
            </>
          ) : (
            <>
              <div>Your saved career can't be opened by this version.</div>
              <div class="start-warn">{'reason' in career ? career.reason : ''}</div>
              <div class="start-sub">Save it to a file before starting over, so it isn't lost.</div>
            </>
          )}
        </div>
        <div class="start-actions">
          <button class="primary" disabled={!save} onClick={() => save && done(save)}>
            Continue
          </button>
          <button onClick={() => done(undefined)}>New career</button>
        </div>
        <div class="start-files">
          <button onClick={() => exportSave(career.raw, fileName)}>Save to file</button>
          <button onClick={load}>Load from file</button>
        </div>
        {error ? <div class="start-warn">{error}</div> : null}
        <div class="start-note">A new career replaces this one the first time you save (dock, or Ctrl+S).</div>
      </div>
    </div>
  );
}
