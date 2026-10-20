import { useState } from 'react';

/** A per-viewer UI preference kept in localStorage (falls back to the default if storage is blocked). */
export function useStored<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setVal(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // Storage blocked: the choice just isn't remembered.
    }
  };
  return [val, set];
}
