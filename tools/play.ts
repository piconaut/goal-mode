// Headless play CLI for agents (PROGRESS M8.9). Each call loads the run file, applies one command, saves it.
// Usage:
//   npm run play -- runs/a.json new 42 [normal|story|hard|ironman] [midwest|revenue|harbourline]
//   npm run play -- runs/a.json status | catalog | policy [pending] | mon3 [system] [--at D2 10:40] [--json] | smf DB2|CICS|BATCH|SMF113 [hour|D8 12] [--json]
//   npm run play -- runs/a.json start | advance 3 | report WLM_SUMMARY [id] | report WLM_DETAIL 312 ONLHI#1   (interval ids from status)
//   npm run play -- runs/a.json draft <optionId|none> | rca <incident> <MECHANISM> <TRIGGER> | buy <toolId>
//   npm run play -- runs/a.json rca INC<n> <MECHANISM> <TRIGGER> --evidence PIN<n>,PIN<n>   (bare numbers work too)
//   npm run play -- runs/a.json ask <TOPIC> [workloadId] | project <id> <hours> | unpin PIN<n> | cancel CHG<n> | restart <JOB>
//   npm run play -- runs/a.json pin WLMGL <interval id> <system> <scKey> <metric> | pin MON3 <system> <scKey> <metric> [--at D2 10:40]
//   npm run play -- runs/a.json pin CPC <lparId> PRSM_DELAY|CAPPED [interval id: Partition Data; none = Monitor III now or --at] | pin DB2|CICS <hour, e.g. 10 or "D3 10"> <workloadId> <metric>
//   npm run play -- runs/a.json pin BATCH <D2|2> JOB_CPU|JOB_IO|JOB_LOCK|JOB_DB2|JOB_SWAP|JOB_INIT|JOB_ABEND   (night of day D2 as labelled in smf BATCH; SMF 30)
//   npm run play -- runs/a.json activate | discard | tfp yes|no | rcadvice [workloadId]
//   npm run play -- runs/a.json note "why I'm doing this"   (shown in the spectator banner)
//   npm run play -- runs/a.json advance 3 --pace 2s   (one hour at a time, saving and pausing between, for spectators)
//   npm run play -- runs/a.json json '{"cmd":"change","req":{...}}'   (any PlayCommand, e.g. wlm edits)
// Monitor III history (for --at) is kept in runs/a.mon3.json beside the run file.

import { parseIdText } from '../src/game/ids';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DIFFICULTIES, type DifficultyId } from '../src/content/difficulty';
import { SCENARIOS } from '../src/content/scenarios';
import type { Mechanism, Trigger } from '../src/game/types';
import type { PinRequest } from '../src/game/evidence';
import type { EvidenceMetric } from '../src/content/evidence';
import type { InquiryKind } from '../src/content/inquiries';
import type { ReportKind, SmfKind } from '../src/worker/protocol';
import { writeSpectateFile } from './spectateFile';
import { decodeRunJson } from '../src/game/runFile';
import type { Mon3PinHistory } from '../src/game/mon3PinHistory';
import { applyPlayCommand, catalogText, decodePlayFile, mon3Text, policyText, statusText, type PlayCommand } from './playCore';

// Piping into head closes stdout early; that is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const argv = process.argv.slice(2);
const paceAt = argv.indexOf('--pace');
const paceMs = paceAt >= 0 ? parseFloat(argv.splice(paceAt, 2)[1] ?? '2') * 1000 : 0;
// --at D2 10:40 (or 'D2 10:40', or D2 Tue 10:40): the tokens up to the one holding the time.
const atAt = argv.indexOf('--at');
let at: string | undefined;
if (atAt >= 0) {
  let n = 1;
  while (atAt + n < argv.length && !argv[atAt + n]!.includes(':') && n < 3) n++;
  at = argv.splice(atAt, n + 1).slice(1).join(' ');
}
const jsonAt = argv.indexOf('--json');
const json = jsonAt >= 2 && argv[1] !== 'json' ? argv.splice(jsonAt, 1).length > 0 : false;
const [path, verb, ...rest] = argv;
if (!path || !verb) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(1);
}

function pinCommand(a: string[]): PlayCommand {
  const req = pinRequest(a);
  return req.source === 'WLMGL' || (req.source === 'CPC' && req.index !== undefined) ? { cmd: 'pin', req, intervalId: req.index } : { cmd: 'pin', req, ...(at !== undefined ? { at } : {}) };
}

function pinRequest(a: string[]): PinRequest {
  const src = (a[0] ?? '').toUpperCase();
  if (src === 'WLMGL') return { source: 'WLMGL', index: Number(a[1]), system: a[2] ?? '*PLEX', scKey: a[3] ?? '', metric: a[4] as EvidenceMetric };
  if (src === 'MON3') return { source: 'MON3', system: a[1] ?? '', scKey: a[2] ?? '', metric: a[3] as EvidenceMetric };
  if (src === 'CPC') return { source: 'CPC', lparId: a[1] ?? '', metric: (a[2] ?? 'PRSM_DELAY') as 'PRSM_DELAY' | 'CAPPED', ...(a[3] !== undefined ? { index: Number(a[3]) } : {}) };
  if (src === 'DB2' || src === 'CICS') return { source: src, hour: a[1] ?? '', workloadId: a[2] ?? '', metric: a[3] as EvidenceMetric };
  if (src === 'BATCH') return { source: 'BATCH', day: Number(String(a[1] ?? '').replace(/^D/i, '')) - 1, metric: a[2] as EvidenceMetric };
  throw new Error('pin source: WLMGL | MON3 | CPC | DB2 | CICS | BATCH');
}

type ReadOnly = 'status' | 'catalog' | 'mon3' | 'policy';
function parse(): PlayCommand | ReadOnly {
  switch (verb) {
    case 'status': return 'status';
    case 'catalog': return 'catalog';
    case 'mon3': return 'mon3';
    case 'policy': return 'policy';
    case 'smf': return { cmd: 'smf', kind: (rest[0] ?? 'DB2').toUpperCase() as SmfKind, ...(rest.length > 1 ? { hour: rest.slice(1).join(' ') } : {}), ...(json ? { json } : {}) };
    case 'new': {
      const seed = Number(rest[0] ?? 42), difficulty = (rest[1] ?? 'normal').toUpperCase(), scenario = rest[2];
      const usage = 'usage: new <seed> [normal|story|hard|ironman] [midwest|revenue|harbourline]';
      if (!Number.isInteger(seed)) throw new Error(`Seed must be a whole number, got "${rest[0]}"; ${usage}`);
      if (!(difficulty in DIFFICULTIES)) throw new Error(`Unknown difficulty "${rest[1]}"; ${usage}`);
      if (scenario && !(scenario in SCENARIOS)) throw new Error(`Unknown scenario "${scenario}"; ${usage}`);
      return { cmd: 'new', seed, difficulty: difficulty as DifficultyId, ...(scenario ? { scenario } : {}) };
    }
    case 'start': return { cmd: 'start' };
    case 'advance': return { cmd: 'advance', hours: Number(rest[0] ?? 1) };
    case 'note': return { cmd: 'note', text: rest.join(' ') };
    case 'draft': return { cmd: 'draft', optionId: rest[0] && rest[0] !== 'none' ? rest[0] : null };
    case 'rca': {
      const ev = rest.indexOf('--evidence');
      return { cmd: 'rca', incidentId: parseIdText('incident', rest[0] ?? ''), mechanism: rest[1] as Mechanism, trigger: rest[2] as Trigger, evidenceIds: ev >= 0 ? (rest[ev + 1] ?? '').split(',').filter(Boolean).map((x) => parseIdText('pin', x)) : [] };
    }
    case 'ask': return { cmd: 'ask', topic: (rest[0] ?? '').toUpperCase() as InquiryKind, workloadId: rest[1] ?? null };
    case 'project': return { cmd: 'project', id: rest[0] ?? '', hours: Number(rest[1] ?? 1) };
    case 'unpin': return { cmd: 'unpin', id: parseIdText('pin', rest[0] ?? '') };
    case 'restart': return { cmd: 'restart', name: rest[0] ?? '' };
    case 'cancel': return { cmd: 'cancel', changeId: parseIdText('change', rest[0] ?? '') };
    case 'pin': return pinCommand(rest);
    case 'buy': return { cmd: 'buy', toolId: rest[0] ?? '' };
    case 'activate': return { cmd: 'activate' };
    case 'rcadvice': return { cmd: 'rcadvice', workloadId: rest[0] ?? null };
    case 'discard': return { cmd: 'discard' };
    case 'tfp': return { cmd: 'tfp', accept: rest[0] === 'yes' };
    case 'report': return { cmd: 'report', kind: (rest[0] ?? 'WLM_SUMMARY') as ReportKind, id: rest[1] !== undefined ? Number(rest[1]) : undefined, scKey: rest[2], system: rest[3] };
    case 'json': return JSON.parse(rest.join(' ')) as PlayCommand;
    default: throw new Error(`Unknown verb ${verb}`);
  }
}

let c: PlayCommand | ReadOnly;
try {
  c = parse();
} catch (e) {
  console.log((e as Error).message);
  process.exit(2);
}
const isNew = typeof c === 'object' && c.cmd === 'new';
if (!isNew && !existsSync(path)) throw new Error(`${path} does not exist; start with: new <seed>`);
const mon3Path = path.replace(/\.json$/, '') + '.mon3.json';
let file = isNew ? null : decodePlayFile(readFileSync(path, 'utf8'));
const mon3Loaded = file && existsSync(mon3Path) ? decodeRunJson<Mon3PinHistory>(readFileSync(mon3Path, 'utf8')) : undefined;
if (file && mon3Loaded) file = { ...file, mon3: mon3Loaded };
if (typeof c === 'string') {
  console.log(c === 'status' ? statusText(file!) : c === 'catalog' ? catalogText(file!) : c === 'policy' ? policyText(file!, rest[0] === 'pending') : mon3Text(file!, { system: rest[0], json, at }));
} else {
  // --pace: advance one hour at a time, saving after each so a spectator sees every step (same end state).
  const steps: PlayCommand[] = paceMs > 0 && c.cmd === 'advance' ? Array.from({ length: Math.max(1, Math.min(24, Math.floor(c.hours))) }, () => ({ cmd: 'advance', hours: 1 })) : [c];
  let res = { file: file ?? ({ version: 1, log: [] } as never), ok: true, text: '' };
  for (const [i, step] of steps.entries()) {
    if (i > 0 && (res.file.run.phase !== 'LIVE' || !res.ok || res.text.includes('\nSTOPPED:'))) break;
    if (i > 0) await new Promise((r) => setTimeout(r, paceMs));
    const prev = res.file.mon3;
    res = applyPlayCommand(res.file, step);
    if (res.ok) {
      // The run file stays small for the spectator's poll; the history goes beside it, only when it changed.
      const { mon3, ...runFile } = res.file;
      writeSpectateFile(path, runFile);
      if (mon3 && mon3 !== prev) writeSpectateFile(mon3Path, mon3);
      else if (!mon3 && step.cmd === 'new') rmSync(mon3Path, { force: true });
    }
    if (steps.length > 1) console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  }
  file = res.file;
  if (steps.length === 1) console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  if (res.ok && c.cmd !== 'report' && c.cmd !== 'smf' && c.cmd !== 'note' && c.cmd !== 'pin' && c.cmd !== 'unpin') console.log('\n' + statusText(file));
  process.exitCode = res.ok ? 0 : 2;
}
