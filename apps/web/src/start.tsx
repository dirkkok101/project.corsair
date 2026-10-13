import { dateOf, formatDate, fromSave } from '@corsair/core';
import type { Save } from '@corsair/core';
import type { DifficultyLevel, PlacedSettlement } from '@corsair/data';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { exportSave, pickSaveFile } from './save';

// Title painting (tools/art/import_paintings.ts); the screen falls back to plain dark without it.
const titleArt = Object.values(
  import.meta.glob<string>('../../../art/game/scenes/title.main.png', { eager: true, query: '?url', import: 'default' }),
)[0];

// The five seas a career can choose (difficulty.1 the calmest), by the levels' order.
const SEAS = Object.entries(import.meta.glob<string>('../../../art/game/scenes/difficulty.*.png', { eager: true, query: '?url', import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

/** A flag a new career can sail under (storyboard 1.3a): its home port and island, what it is good for, its wars now. */
export interface Flag {
  nation: string;
  name: string;
  port: string;
  island: string;
  about: string;
  /** "At war with Spain", or "At peace with all" (peace true). */
  wars: string;
  peace: boolean;
  /** The home port's harbour painting, small. */
  art?: string;
}

export interface StartOptions {
  /** What the browser holds for the career slot, before any checks; undefined when nothing is stored. */
  raw: unknown;
  /** The difficulty levels a new career can pick (easiest first), and the one picked unless the player changes it. */
  levels: DifficultyLevel[];
  defaultLevel: string;
  /** The flags a new career can choose, and the one picked unless the player changes it. */
  flags: Flag[];
  defaultFlag: string;
  fingerprint: string;
  startDate: string;
  ticksPerDay: number;
  settlements: PlacedSettlement[];
}

export type Choice = { save: Save } | { difficulty: string; nation: string };

/** The start screen: resolves to the save to continue, or a new career under the flag and at the difficulty picked. */
export function chooseCareer(root: HTMLElement, opts: StartOptions): Promise<Choice> {
  // Its own element: rendered into `root` itself, Preact would take over the fading loading screen's element,
  // and the title would go when that is removed.
  const host = root.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const done = (choice: Choice) => {
      render(null, host);
      host.remove();
      resolve(choice);
    };
    render(<Start {...opts} done={done} />, host);
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

function Start({ raw, fingerprint, startDate, ticksPerDay, settlements, levels, defaultLevel, flags, defaultFlag, done }: StartOptions & { done: (choice: Choice) => void }) {
  const [career, setCareer] = useState(() => ({ raw, ...read(raw, fingerprint) }));
  const [error, setError] = useState<string>();
  // Nothing stored: straight to the new career's difficulty.
  const [picking, setPicking] = useState(raw === undefined);
  const [level, setLevel] = useState(defaultLevel);
  // A new career is two short steps: the flag, then the sea.
  const [step, setStep] = useState<'flag' | 'sea'>('flag');
  const [nation, setNation] = useState(defaultFlag);
  const flag = flags.find((f) => f.nation === nation) ?? flags[0]!;

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

  const picked = levels.find((l) => l.id === level) ?? levels[0]!;
  if (picking && step === 'flag')
    return (
      <div class="start start-pick" style={titleArt ? { backgroundImage: `url(${titleArt})` } : undefined}>
        <div class="start-head">
          <div class="moment-kicker">
            A new career <span class="k-tag gold">1 of 2</span>
          </div>
          <h2 class="start-h2">Under whose flag?</h2>
        </div>
        {/* Four cards alike in size, their parts in the same rows; the one picked is ringed, not moved. */}
        <div class="flag-cards">
          {flags.map((f) => (
            <button key={f.nation} class={`k-wood flag-card${f.nation === nation ? ' picked' : ''}`} aria-pressed={f.nation === nation} onClick={() => setNation(f.nation)}>
              <span class={`flag-swatch flag-${f.nation}`} aria-hidden="true">
                {f.nation === 'france' ? <span class="flag-lilies">⚜ ⚜ ⚜</span> : null}
              </span>
              <span class="flag-name">{f.name}</span>
              <span class="flag-home">
                <span class="flag-thumb" style={f.art ? { backgroundImage: `url(${f.art})` } : undefined} />
                <span>
                  <b>{f.port}</b>, {f.island}
                </span>
              </span>
              <span class="flag-about">{f.about}</span>
              <span class={`flag-wars${f.peace ? ' peace' : ''}`}>{f.wars}</span>
            </button>
          ))}
        </div>
        <div class="start-foot">
          <div class="start-actions">
            {raw !== undefined ? (
              <button class="k-btn" onClick={() => setPicking(false)}>
                Back
              </button>
            ) : null}
            <button class="k-btn primary start-go" onClick={() => setStep('sea')}>
              Next: how hard a sea
            </button>
          </div>
          <div class="start-note">Your flag's governors know you; its enemies' ships may hunt you.</div>
        </div>
      </div>
    );
  if (picking)
    return (
      <div class="start start-pick" style={titleArt ? { backgroundImage: `url(${titleArt})` } : undefined}>
        <div class="start-head">
          <div class="moment-kicker">
            A new career <span class="k-tag gold">2 of 2</span>
          </div>
          <h2 class="start-h2">How hard a sea?</h2>
          <span class="k-tag flag-chip">
            Under {flag.name}'s flag · {flag.port}
          </span>
        </div>
        <div class="level-cards">
          {levels.map((l, i) => (
            <button key={l.id} class={`k-wood level-card${l.id === level ? ' picked' : ''}`} onClick={() => setLevel(l.id)}>
              <span class="level-art" style={SEAS[i] ? { backgroundImage: `url(${SEAS[i]})` } : undefined} />
              <span class="level-body">
                <span class="level-name">{l.name}</span>
                <span class="level-about">{l.about}</span>
                <span class="k-sub level-score">Score × {l.score}</span>
              </span>
            </button>
          ))}
        </div>
        <div class="start-foot">
          <div class="start-actions">
            <button class="k-btn" onClick={() => setStep('flag')}>
              Back
            </button>
            <button class="k-btn primary start-go" onClick={() => done({ difficulty: picked.id, nation })}>
              Set sail
            </button>
          </div>
          <div class="start-note">Your own ship sails the same at every level: only your opponents and the battle change.</div>
        </div>
      </div>
    );

  return (
    <div class="start" style={titleArt ? { backgroundImage: `url(${titleArt})` } : undefined}>
      {/* The painting leaves its top third open sky for the title; the two big buttons sit on the sea. */}
      <h1 class="start-title">Project Corsair</h1>
      <div class="start-menu">
        <button class="k-btn primary start-continue" disabled={!save} onClick={() => save && done({ save })}>
          <span class="start-big">Continue</span>
          {save ? (
            <span class="start-small">
              {save.state.captain?.retired
                ? `${date} · Retired: ${save.state.captain.retired.fate}, score ${save.state.captain.retired.score}`
                : `${date} · ${where ? `in port at ${where}` : 'at sea'} · ${(save.state.captain?.gold ?? 0).toLocaleString()} gold`}
            </span>
          ) : (
            <span class="start-small">Your saved career can't be opened by this version.</span>
          )}
        </button>
        {save && save.content !== fingerprint ? <div class="start-warn">This save was made with different game rules; it may not play the same.</div> : null}
        {!save ? (
          <div class="start-warn">
            {'reason' in career ? career.reason : ''} Save it to a file before starting over, so it isn't lost.
          </div>
        ) : null}
        <button class="k-btn start-new" onClick={() => setPicking(true)}>
          <span class="start-big">New career</span>
        </button>
        <div class="start-files">
          <button class="k-btn small" onClick={() => exportSave(career.raw, fileName)}>
            Save to file
          </button>
          <button class="k-btn small" onClick={load}>
            Load from file
          </button>
        </div>
        {error ? <div class="start-warn">{error}</div> : null}
      </div>
      <div class="start-note start-corner">A new career replaces this one the first time you save (dock, or Ctrl+S).</div>
    </div>
  );
}
