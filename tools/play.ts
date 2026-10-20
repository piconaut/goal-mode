// Headless play CLI for agents (PROGRESS M8.9). Each call loads the run file, applies one command, saves it.
// Usage:
//   npm run play -- runs/a.json new 42 [normal|story|hard|ironman]
//   npm run play -- runs/a.json status | catalog | mon3 | smf DB2|CICS|BATCH|SMF113 [hour]
//   npm run play -- runs/a.json start | advance 3 | report WLM_SUMMARY [index] | report WLM_DETAIL 5 ONLHI#1
//   npm run play -- runs/a.json draft <optionId|none> | rca <incident> <MECHANISM> <TRIGGER> | buy <toolId>
//   npm run play -- runs/a.json rca <incident> <MECHANISM> <TRIGGER> --evidence 1,3
//   npm run play -- runs/a.json ask <TOPIC> [workloadId] | project <id> <hours> | unpin <id>
//   npm run play -- runs/a.json pin WLMGL <interval> <system> <scKey> <metric> | pin MON3 <system> <scKey> <metric>
//   npm run play -- runs/a.json pin CPC <lparId> PRSM_DELAY|CAPPED | pin DB2|CICS <hour> <workloadId> <metric>
//   npm run play -- runs/a.json activate | discard | tfp yes|no | rcadvice [workloadId]
//   npm run play -- runs/a.json json '{"cmd":"change","req":{...}}'   (any PlayCommand, e.g. wlm edits)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DifficultyId } from '../src/content/difficulty';
import type { Mechanism, Trigger } from '../src/game/types';
import type { PinRequest } from '../src/game/evidence';
import type { EvidenceMetric } from '../src/content/evidence';
import type { InquiryKind } from '../src/content/inquiries';
import type { ReportKind, SmfKind } from '../src/worker/protocol';
import { applyPlayCommand, catalogText, decodePlayFile, encodePlayFile, mon3Text, statusText, type PlayCommand } from './playCore';

const [path, verb, ...rest] = process.argv.slice(2);
if (!path || !verb) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
  process.exit(1);
}

function pinRequest(a: string[]): PinRequest {
  const src = (a[0] ?? '').toUpperCase();
  if (src === 'WLMGL') return { source: 'WLMGL', index: Number(a[1]), system: a[2] ?? '*PLEX', scKey: a[3] ?? '', metric: a[4] as EvidenceMetric };
  if (src === 'MON3') return { source: 'MON3', system: a[1] ?? '', scKey: a[2] ?? '', metric: a[3] as EvidenceMetric };
  if (src === 'CPC') return { source: 'CPC', lparId: a[1] ?? '', metric: (a[2] ?? 'PRSM_DELAY') as 'PRSM_DELAY' | 'CAPPED' };
  if (src === 'DB2' || src === 'CICS') return { source: src, hour: a[1] ?? '', workloadId: a[2] ?? '', metric: a[3] as EvidenceMetric };
  throw new Error('pin source: WLMGL | MON3 | CPC | DB2 | CICS');
}

type ReadOnly = 'status' | 'catalog' | 'mon3';
function parse(): PlayCommand | ReadOnly {
  switch (verb) {
    case 'status': return 'status';
    case 'catalog': return 'catalog';
    case 'mon3': return 'mon3';
    case 'smf': return { cmd: 'smf', kind: (rest[0] ?? 'DB2').toUpperCase() as SmfKind, hour: rest[1] };
    case 'new': return { cmd: 'new', seed: Number(rest[0] ?? 42), difficulty: (rest[1] ?? 'normal').toUpperCase() as DifficultyId };
    case 'start': return { cmd: 'start' };
    case 'advance': return { cmd: 'advance', hours: Number(rest[0] ?? 1) };
    case 'draft': return { cmd: 'draft', optionId: rest[0] && rest[0] !== 'none' ? rest[0] : null };
    case 'rca': {
      const ev = rest.indexOf('--evidence');
      return { cmd: 'rca', incidentId: Number(rest[0]), mechanism: rest[1] as Mechanism, trigger: rest[2] as Trigger, evidenceIds: ev >= 0 ? (rest[ev + 1] ?? '').split(',').filter(Boolean).map(Number) : [] };
    }
    case 'ask': return { cmd: 'ask', topic: (rest[0] ?? '').toUpperCase() as InquiryKind, workloadId: rest[1] ?? null };
    case 'project': return { cmd: 'project', id: rest[0] ?? '', hours: Number(rest[1] ?? 1) };
    case 'unpin': return { cmd: 'unpin', id: Number(rest[0]) };
    case 'pin': return { cmd: 'pin', req: pinRequest(rest) };
    case 'buy': return { cmd: 'buy', toolId: rest[0] ?? '' };
    case 'activate': return { cmd: 'activate' };
    case 'rcadvice': return { cmd: 'rcadvice', workloadId: rest[0] ?? null };
    case 'discard': return { cmd: 'discard' };
    case 'tfp': return { cmd: 'tfp', accept: rest[0] === 'yes' };
    case 'report': return { cmd: 'report', kind: (rest[0] ?? 'WLM_SUMMARY') as ReportKind, index: rest[1] !== undefined ? Number(rest[1]) : undefined, scKey: rest[2], system: rest[3] };
    case 'json': return JSON.parse(rest.join(' ')) as PlayCommand;
    default: throw new Error(`Unknown verb ${verb}`);
  }
}

const c = parse();
const isNew = typeof c === 'object' && c.cmd === 'new';
if (!isNew && !existsSync(path)) throw new Error(`${path} does not exist; start with: new <seed>`);
let file = isNew ? null : decodePlayFile(readFileSync(path, 'utf8'));
if (typeof c === 'string') {
  console.log(c === 'status' ? statusText(file!) : c === 'catalog' ? catalogText(file!) : mon3Text(file!));
} else {
  const res = applyPlayCommand(file ?? ({ version: 1, log: [] } as never), c);
  file = res.file;
  console.log(res.ok ? res.text : `REFUSED: ${res.text}`);
  if (res.ok) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encodePlayFile(file));
    if (c.cmd !== 'report' && c.cmd !== 'smf') console.log('\n' + statusText(file));
  }
  process.exitCode = res.ok ? 0 : 2;
}
