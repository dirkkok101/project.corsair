import type { Save } from '@corsair/core';

// Saves live in the browser's IndexedDB with file export (PRD section 14). One career slot for now:
// docking autosaves into it and Ctrl+S writes it on demand.

const DB = 'corsair';
const STORE = 'saves';
const SLOT = 'career';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const storeSave = (save: Save) => run('readwrite', (s) => s.put(save, SLOT)).then(() => undefined);

/** The stored career, or undefined if there is none (or storage is unavailable, as in some private windows). */
export const loadStoredSave = () => run<unknown>('readonly', (s) => s.get(SLOT)).catch(() => undefined);

export function exportSave(save: Save, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(save)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Lets the player pick a save file and returns its parsed JSON. */
export function pickSaveFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('no file chosen'));
      file.text().then((text) => resolve(JSON.parse(text)), reject);
    };
    input.click();
  });
}
