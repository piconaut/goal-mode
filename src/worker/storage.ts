// Save/load the run in IndexedDB (available inside workers). Every call is guarded: a
// private window or blocked storage just means no save.

import type { RunState } from '../game/types';
import type { Command } from '../sim/core/commands';
import type { ServiceDefinition } from '../sim/wlm/types';

const DB = 'goal-mode';
const STORE = 'runs';
const KEY = 'current';
const DESK_KEY = 'desk';

/** Work in progress at the Change Desk that isn't part of the run yet. */
export interface DeskState {
  pendingPolicy: ServiceDefinition | null;
  basket: Command[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRun(run: RunState, desk?: DeskState): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(run, KEY);
      if (desk) tx.objectStore(STORE).put(desk, DESK_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadRun(): Promise<RunState | null> {
  try {
    const db = await open();
    return await new Promise<RunState | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as RunState | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function loadDesk(): Promise<DeskState | null> {
  try {
    const db = await open();
    return await new Promise<DeskState | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(DESK_KEY);
      req.onsuccess = () => resolve((req.result as DeskState | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
