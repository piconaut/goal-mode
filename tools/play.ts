// Headless play CLI for agents (PROGRESS M8.9). Each call loads the run file, applies one command, saves it.
// Usage:
//   npm run play -- runs/a.json new 42 [normal|story|hard|ironman]
//   npm run play -- runs/a.json status
//   npm run play -- runs/a.json start | advance 3 | report WLM_SUMMARY [index] | report WLM_DETAIL 5 ONLHI#1
//   npm run play -- runs/a.json draft <optionId|none> | rca <incident> <MECHANISM> <TRIGGER> | buy <toolId>
//   npm run play -- runs/a.json activate | discard | tfp yes|no
//   npm run play -- runs/a.json json '{"cmd":"change","req":{...}}'   (any PlayCommand, e.g. wlm edits)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DifficultyId } from '../src/content/difficulty';
import type { Mechanism, Trigger } from '../src/game/types';
import type { ReportKind } from '../src/worker/protocol';
import { applyPlayCommand, decodePlayFile, encodePlayFile, statusText, type PlayCommand } from './playCore';

const [path, verb, ...rest] = process.argv.slice(2);
if (!path || !verb) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(1);
}

function parse(): PlayCommand | 'status' {
  switch (verb) {
    case 'status': return 'status';
    case 'new': return { cmd: 'new', seed: Number(rest[0] ?? 42), difficulty: (rest[1] ?? 'normal').toUpperCase() as DifficultyId };
    case 'start': return { cmd: 'start' };
    case 'advance': return { cmd: 'advance', hours: Number(rest[0] ?? 1) };
    case 'draft': return { cmd: 'draft', optionId: rest[0] && rest[0] !== 'none' ? rest[0] : null };
    case 'rca': return { cmd: 'rca', incidentId: Number(rest[0]), mechanism: rest[1] as Mechanism, trigger: rest[2] as Trigger };
    case 'buy': return { cmd: 'buy', toolId: rest[0] ?? '' };
    case 'activate': return { cmd: 'activate' };
    case 'discard': return { cmd: 'discard' };
    case 'tfp': return { cmd: 'tfp', accept: rest[0] === 'yes' };
    case 'report': return { cmd: 'report', kind: (rest[0] ?? 'WLM_SUMMARY') as ReportKind, index: rest[1] !== undefined ? Number(rest[1]) : undefined, scKey: rest[2], system: rest[3] };
    case 'json': return JSON.parse(rest.join(' ')) as PlayCommand;
    default: throw new Error(`Unknown verb ${verb}`);
  }
}

const c = parse();
if (c !== 'status' && c.cmd !== 'new' && !existsSync(path)) throw new Error(`${path} does not exist; start with: new <seed>`);
let file = c !== 'status' && c.cmd === 'new' ? null : decodePlayFile(readFileSync(path, 'utf8'));
if (c === 'status') {
  console.log(statusText(file!));
} else {
  const res = applyPlayCommand(file ?? ({ version: 1, log: [] } as never), c);
  file = res.file;
  console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  if (res.ok) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encodePlayFile(file));
    if (c.cmd !== 'report') console.log('\n' + statusText(file));
  }
  process.exitCode = res.ok ? 0 : 2;
}
