// Run files as text (headless play CLI, spectator mode). JSON has no Infinity/NaN and the sim uses Infinity
// for "uncapped", so non-finite numbers are tagged to keep the state bit-identical.

/** The save format this build writes. A file of any other version is refused rather than repaired (user decision
 * 2026-11-16: a save need not load across releases). */
export const SAVE_VERSION = 3 as const;

/** What a file of another version gets: one message, instead of a partial load that breaks later. */
export const OLD_SAVE_MESSAGE = 'This run was saved by an older build of GOAL MODE; start a new run.';

/** Throws `OLD_SAVE_MESSAGE` unless the value is a save this build wrote. */
export function assertSaveVersion(value: { version?: number } | null | undefined): void {
  if (value?.version !== SAVE_VERSION) throw new Error(OLD_SAVE_MESSAGE);
}

export function encodeRunJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? { $num: String(v) } : v));
}

export function decodeRunJson<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && '$num' in v && Object.keys(v).length === 1 ? Number((v as { $num: string }).$num) : v,
  ) as T;
}

/**
 * A run file as exported or pasted. Two damaged forms are repaired: the text pasted with its surrounding
 * backticks, and a file whose every backslash was doubled on its way to disk (seen on a browser export:
 * `\\"` where the game wrote `\"`), which is invalid JSON. Halving the backslashes restores it exactly.
 */
export function decodeRunFileText<T>(text: string): T {
  const t = text.trim().replace(/^`([\s\S]*)`$/, '$1');
  try {
    return decodeRunJson<T>(t);
  } catch (e) {
    if (!t.includes('\\\\')) throw e;
    try {
      return decodeRunJson<T>(t.replace(/\\\\/g, '\\'));
    } catch {
      throw e;
    }
  }
}
