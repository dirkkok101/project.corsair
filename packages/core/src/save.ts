import { hashState } from './hash';
import type { WorldState } from './state';

// A save is the plain-data state snapshot plus what it was made with (PRD sections 14 and 15).
// The seed rides along for replays and bug reports; the RNG streams themselves live in the state.

/** Bump when the shape of WorldState changes in a way old saves can't be read as. */
export const SAVE_FORMAT = 1;

export interface Save {
  format: number;
  /** Fingerprint of the content packs the save was made with; a mismatch warns but still loads. */
  content: string;
  seed: number;
  /** Wall-clock time of the save, for the start screen. */
  savedAt: number;
  state: WorldState;
}

/** A short fingerprint of the loaded content, standing in for per-pack versions. */
export function contentFingerprint(content: unknown): string {
  return hashState(content);
}

export function toSave(state: WorldState, seed: number, content: string, savedAt: number): Save {
  // A JSON round trip drops undefined fields, so a saved state reads back exactly as it hashes.
  return { format: SAVE_FORMAT, content, seed, savedAt, state: JSON.parse(JSON.stringify(state)) as WorldState };
}

export function fromSave(raw: unknown, content: string): { save: Save; contentMismatch: boolean } {
  const save = raw as Partial<Save> | null;
  if (!save || typeof save !== 'object' || !save.state || typeof save.seed !== 'number') throw new Error('not a Corsair save');
  if (save.format !== SAVE_FORMAT) throw new Error(`save format ${String(save.format)} is not supported (expected ${SAVE_FORMAT})`);
  return { save: save as Save, contentMismatch: save.content !== content };
}
