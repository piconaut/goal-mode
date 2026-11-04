// Run files as text (headless play CLI, spectator mode). JSON has no Infinity/NaN and the sim uses Infinity
// for "uncapped", so non-finite numbers are tagged to keep the state bit-identical.

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
