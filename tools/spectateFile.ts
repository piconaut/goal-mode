// Write a run file for spectator mode atomically (temp file + rename), so the UI's poll never reads half a file.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { encodeRunJson } from '../src/game/runFile';

export function writeSpectateFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, encodeRunJson(value));
  renameSync(tmp, path);
}
