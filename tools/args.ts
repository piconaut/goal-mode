// Argument helpers for the tools: one parser, so a flag means the same thing in every command (CL-24). The play CLI
// keeps its own scanner because its flags consume values in place (`--at D2 10:40`, `--pace 2s`).
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--name <value>` from `process.argv`, or `dflt` when the flag is absent, last, or followed by another flag. */
export function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : dflt;
}

/** `--name` was passed (with or without a value). */
export const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** A numeric `--name <value>`, or `dflt` when the flag is absent; a malformed value is NaN. */
export const num = (name: string, dflt: number): number => Number(arg(name, String(dflt)));

/** `--name` removed from `argv`; a boolean flag never consumes the token after it. */
export const takeFlag = (argv: string[], name: string): boolean => {
  let found = false;
  for (let i = argv.length - 1; i >= 0; i--) if (argv[i] === `--${name}`) { argv.splice(i, 1); found = true; }
  return found;
};

/** A `--name <value>` remover over `argv` (a following `--flag` is not a value); boolean flags use `takeFlag`. */
export const taker = (argv: string[]) => (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  const hasValue = v !== undefined && !v.startsWith('--');
  argv.splice(i, hasValue ? 2 : 1);
  return hasValue ? v : '';
};

/** True when the module at `url` is this process's entry point, not imported by a test or another tool. */
export function isMain(url: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
