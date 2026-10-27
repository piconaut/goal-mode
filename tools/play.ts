// Headless play CLI for agents (PROGRESS M8.9). Each call loads the run file, applies one command, saves it.
// Usage:
//   npm run play -- runs/a.json new 42 [normal|story|hard|ironman] [midwest|revenue|harbourline]
//   npm run play -- runs/a.json status | catalog | mon3 [system] [--json] | smf DB2|CICS|BATCH|SMF113 [hour|D8 12] [--json]
//   npm run play -- runs/a.json start | advance 3 | report WLM_SUMMARY [id] | report WLM_DETAIL 312 ONLHI#1   (interval ids from status)
//   npm run play -- runs/a.json draft <optionId|none> | rca <incident> <MECHANISM> <TRIGGER> | buy <toolId>
//   npm run play -- runs/a.json rca <incident> <MECHANISM> <TRIGGER> --evidence 1,3
//   npm run play -- runs/a.json ask <TOPIC> [workloadId] | project <id> <hours> | unpin <id> | cancel <change id>
//   npm run play -- runs/a.json pin WLMGL <interval id> <system> <scKey> <metric> | pin MON3 <system> <scKey> <metric>
//   npm run play -- runs/a.json pin CPC <lparId> PRSM_DELAY|CAPPED [interval id: Partition Data; none = Monitor III now] | pin DB2|CICS <hour, e.g. 10 or "D3 10"> <workloadId> <metric>
//   npm run play -- runs/a.json pin BATCH <D2|2> JOB_CPU|JOB_IO|JOB_LOCK|JOB_DB2|JOB_SWAP|JOB_INIT|JOB_ABEND   (night of day D2 as labelled in smf BATCH; SMF 30)
//   npm run play -- runs/a.json activate | discard | tfp yes|no | rcadvice [workloadId]
//   npm run play -- runs/a.json note "why I'm doing this"   (shown in the spectator banner)
//   npm run play -- runs/a.json advance 3 --pace 2s   (one hour at a time, saving and pausing between, for spectators)
//   npm run play -- runs/a.json json '{"cmd":"change","req":{...}}'   (any PlayCommand, e.g. wlm edits)

import { existsSync, readFileSync } from 'node:fs';
import type { DifficultyId } from '../src/content/difficulty';
import type { Mechanism, Trigger } from '../src/game/types';
import type { PinRequest } from '../src/game/evidence';
import type { EvidenceMetric } from '../src/content/evidence';
import type { InquiryKind } from '../src/content/inquiries';
import type { ReportKind, SmfKind } from '../src/worker/protocol';
import { writeSpectateFile } from './spectateFile';
import { applyPlayCommand, catalogText, decodePlayFile, mon3Text, statusText, type PlayCommand } from './playCore';

// Piping into head closes stdout early; that is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const argv = process.argv.slice(2);
const paceAt = argv.indexOf('--pace');
const paceMs = paceAt >= 0 ? parseFloat(argv.splice(paceAt, 2)[1] ?? '2') * 1000 : 0;
const jsonAt = argv.indexOf('--json');
const json = jsonAt >= 2 && argv[1] !== 'json' ? argv.splice(jsonAt, 1).length > 0 : false;
const [path, verb, ...rest] = argv;
if (!path || !verb) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(1);
}

function pinCommand(a: string[]): PlayCommand {
  const req = pinRequest(a);
  return req.source === 'WLMGL' || (req.source === 'CPC' && req.index !== undefined) ? { cmd: 'pin', req, intervalId: req.index } : { cmd: 'pin', req };
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

type ReadOnly = 'status' | 'catalog' | 'mon3';
function parse(): PlayCommand | ReadOnly {
  switch (verb) {
    case 'status': return 'status';
    case 'catalog': return 'catalog';
    case 'mon3': return 'mon3';
    case 'smf': return { cmd: 'smf', kind: (rest[0] ?? 'DB2').toUpperCase() as SmfKind, ...(rest.length > 1 ? { hour: rest.slice(1).join(' ') } : {}), ...(json ? { json } : {}) };
    case 'new': return { cmd: 'new', seed: Number(rest[0] ?? 42), difficulty: (rest[1] ?? 'normal').toUpperCase() as DifficultyId, ...(rest[2] ? { scenario: rest[2] } : {}) };
    case 'start': return { cmd: 'start' };
    case 'advance': return { cmd: 'advance', hours: Number(rest[0] ?? 1) };
    case 'note': return { cmd: 'note', text: rest.join(' ') };
    case 'draft': return { cmd: 'draft', optionId: rest[0] && rest[0] !== 'none' ? rest[0] : null };
    case 'rca': {
      const ev = rest.indexOf('--evidence');
      return { cmd: 'rca', incidentId: Number(rest[0]), mechanism: rest[1] as Mechanism, trigger: rest[2] as Trigger, evidenceIds: ev >= 0 ? (rest[ev + 1] ?? '').split(',').filter(Boolean).map(Number) : [] };
    }
    case 'ask': return { cmd: 'ask', topic: (rest[0] ?? '').toUpperCase() as InquiryKind, workloadId: rest[1] ?? null };
    case 'project': return { cmd: 'project', id: rest[0] ?? '', hours: Number(rest[1] ?? 1) };
    case 'unpin': return { cmd: 'unpin', id: Number(rest[0]) };
    case 'cancel': return { cmd: 'cancel', changeId: Number(rest[0]) };
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

const c = parse();
const isNew = typeof c === 'object' && c.cmd === 'new';
if (!isNew && !existsSync(path)) throw new Error(`${path} does not exist; start with: new <seed>`);
let file = isNew ? null : decodePlayFile(readFileSync(path, 'utf8'));
if (typeof c === 'string') {
  console.log(c === 'status' ? statusText(file!) : c === 'catalog' ? catalogText(file!) : mon3Text(file!, { system: rest[0], json }));
} else {
  // --pace: advance one hour at a time, saving after each so a spectator sees every step (same end state).
  const steps: PlayCommand[] = paceMs > 0 && c.cmd === 'advance' ? Array.from({ length: Math.max(1, Math.min(24, Math.floor(c.hours))) }, () => ({ cmd: 'advance', hours: 1 })) : [c];
  let res = { file: file ?? ({ version: 1, log: [] } as never), ok: true, text: '' };
  for (const [i, step] of steps.entries()) {
    if (i > 0 && (res.file.run.phase !== 'LIVE' || !res.ok)) break;
    if (i > 0) await new Promise((r) => setTimeout(r, paceMs));
    res = applyPlayCommand(res.file, step);
    if (res.ok) writeSpectateFile(path, res.file);
    if (steps.length > 1) console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  }
  file = res.file;
  if (steps.length === 1) console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  if (res.ok && c.cmd !== 'report' && c.cmd !== 'smf' && c.cmd !== 'note') console.log('\n' + statusText(file));
  process.exitCode = res.ok ? 0 : 2;
}
