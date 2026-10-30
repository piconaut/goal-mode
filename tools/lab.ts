// Realism lab: controlled A/B runs from JSON specs, one row per RMF interval.
// Usage: npm run lab -- <control.json> [<treatment.json> ...]
//
// Spec (all optional except scenario):
//   extends     path of another spec to start from (relative to this file); fields here override it
//   scenario    midwest | harbourline | revenue        seed (42)   difficulty (STORY)   days (1)
//   changes     [{ at?: "HH:MM", cmds?: Command[], edits?: WlmEdit[], config?: [{ lpar|system|cpc, set }] }]
//               `at` defaults to the day start (06:00). edits are applied to the active policy and activated.
//               config: [{ in: "systems", id: "PROD1", set: { blwltrpctFrac: 0.2 } }] patches a state.config entry
//               (matched on id, lparId or name; without id, `in` names a scalar field) for settings no command reaches;
//               { in: "capacityGroups", add: { id: "GRP1", cpcId: "CPC1", limitMsu: 500 } } appends an entry instead.
//   hours       [9, 10]: only print intervals ending in these hours
//   wlm         ["ONLHI#1", ...] service class periods; systems: ["*PLEX"] (or LPAR ids)
//   cpu         ["PROD1", ...] Partition Data rows        lcu: ["10", ...]       cf: true   cfStructures: [names]
//   dps         LPAR id: print every managed period's DP at the interval end
//   fields      override the printed fields per section, e.g. { "wlm": ["pi", "execVelocity", "delayPct.cpu"] }
//   dump        ["10:00"]: print full reports for intervals ending then; dumpWhat: ["WLM", "PART", "CF", "DASD", "DET:ONLHI#1"]
//   paths       state paths to print on every row, e.g. ["capping.groups.0.r4ha"]
//   wlmLog      true, or a regex: print the WLM policy adjustment log lines for the printed hours (the state keeps
//               only the last 400 lines; the lab collects them as they are written)
//   final       state paths to print after the run, e.g. ["capping.lpars"]
//   dumpWhat    also "MON3": the Monitor III DELAY rows (and SYSINFO) for `systems[0]` (or every system)
// With several specs the rows are printed side by side per interval (A, B, ...), so an A/B differs only in its spec.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SCENARIOS } from '../src/content/scenarios';
import type { DifficultyId } from '../src/content/difficulty';
import { initState } from '../src/sim/core/init';
import { step } from '../src/sim/core/step';
import { clockAt } from '../src/sim/core/clock';
import { TICKS_PER_DAY } from '../src/sim/core/units';
import type { Command } from '../src/sim/core/commands';
import type { SimState } from '../src/sim/core/types';
import type { RmfInterval } from '../src/sim/measure/rmf';
import { renderCfActivity, renderDasdSummary, renderPartitionData, renderWlmDetail, renderWlmSummary } from '../src/sim/measure/reports';
import { scenarioFor } from '../src/game/difficulty';
import { applyWlmEdit, type WlmEdit } from '../src/game/wlmEdit';
import { buildMon3 } from '../src/game/mon3';
import type { RunState } from '../src/game/types';
import type { Scenario } from '../src/sim/core/scenario';

interface Change {
  at?: string;
  cmds?: Command[];
  edits?: WlmEdit[];
  config?: { in: string; id?: string; set?: Record<string, unknown>; add?: Record<string, unknown> }[];
}
interface Spec {
  extends?: string;
  scenario: string;
  seed?: number;
  difficulty?: DifficultyId;
  days?: number;
  changes?: Change[];
  hours?: number[];
  wlm?: string[];
  systems?: string[];
  cpu?: string[];
  lcu?: string[];
  cf?: boolean;
  cfStructures?: string[];
  dps?: string;
  fields?: Partial<Record<'wlm' | 'cpu' | 'lcu' | 'cf' | 'cfStructures', string[]>>;
  dump?: string[];
  dumpWhat?: string[];
  paths?: string[];
  wlmLog?: boolean | string;
  final?: string[];
}

const DEFAULT_FIELDS: Record<'wlm' | 'cpu' | 'lcu' | 'cf' | 'cfStructures', string[]> = {
  wlm: ['pi', 'execVelocity', 'avgRtSec', 'endPerSec', 'delayPct.cpu', 'delayPct.io', 'delayPct.cap', 'delayPct.other', 'delayPct.queue', 'dp'],
  cpu: ['msuAvg', 'r4ha', 'logicalBusyPct', 'mvsBusyPct', 'wlmCappingPct', 'prsmDelayPct', 'physicalEngines', 'polarity'],
  lcu: ['aliases', 'iops', 'iosqMs', 'rtMs'],
  cf: ['busyPct', 'reqPerSec', 'syncUs', 'asyncPct', 'serviceUs'],
  cfStructures: ['cfLparId', 'reqPerSec', 'syncPct', 'syncUs', 'serviceUs'],
};

function loadSpec(path: string): Spec {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Spec;
  if (!raw.extends) return raw;
  const base = loadSpec(resolve(dirname(path), raw.extends));
  return { ...base, ...raw, extends: undefined };
}

const get = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v != null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);

function fmt(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  return v == null ? '-' : String(v);
}
const pick = (o: unknown, fields: string[]) => fields.map((f) => `${f.split('.').pop()}=${fmt(get(o, f))}`).join(' ');

const hhmm = (tick: number) => {
  const m = Math.round(clockAt(tick).hourOfDay * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function changeTick(at: string | undefined): number {
  if (!at) return 0;
  for (let t = 0; t < TICKS_PER_DAY; t++) if (hhmm(t) === at) return t;
  throw new Error(`change time ${at} is outside the played day`);
}

function applyChange(st: SimState, c: Change): Command[] {
  for (const p of c.config ?? []) {
    const list = (st.config as unknown as Record<string, unknown>)[p.in];
    if (p.add) {
      if (!Array.isArray(list)) throw new Error(`config add needs a list: ${p.in}`);
      list.push(structuredClone(p.add));
      continue;
    }
    const target = Array.isArray(list)
      ? (list as Record<string, unknown>[]).find((x) => [x.id, x.lparId, x.name].includes(p.id))
      : p.in in st.config ? (st.config as unknown as Record<string, unknown>) : undefined;
    if (!target) throw new Error(`config target not found: ${JSON.stringify(p)}`);
    Object.assign(target, p.set ?? {});
  }
  const cmds = [...(c.cmds ?? [])];
  if (c.edits?.length) {
    let def = structuredClone(st.wlm.definition);
    for (const e of c.edits) {
      const r = applyWlmEdit(def, e);
      if (typeof r === 'string') throw new Error(`WLM edit refused: ${r}`);
      def = r;
    }
    cmds.push({ kind: 'ACTIVATE_POLICY', definition: def });
  }
  return cmds;
}

function intervalRow(spec: Spec, iv: RmfInterval, st: SimState): string {
  const f = { ...DEFAULT_FIELDS, ...spec.fields };
  const parts: string[] = [];
  for (const k of spec.wlm ?? [])
    for (const sys of spec.systems ?? ['*PLEX']) {
      const r = iv.wlm.find((x) => x.lparId === sys && x.scKey === k);
      if (r) parts.push(`${sys === '*PLEX' ? '' : sys + '/'}${k} ${pick(r, f.wlm)}`);
    }
  for (const id of spec.cpu ?? []) {
    const r = iv.cpu.find((x) => x.lparId === id);
    if (r) parts.push(`${id} ${pick(r, f.cpu)}`);
  }
  for (const id of spec.lcu ?? []) {
    const r = iv.lcus.find((x) => x.id === id);
    if (r) parts.push(`LCU${id} ${pick(r, f.lcu)}`);
  }
  if (spec.cf) for (const r of iv.cf) parts.push(`${r.lparId} ${pick(r, f.cf)}`);
  for (const n of spec.cfStructures ?? []) for (const r of iv.cfStructures.filter((x) => x.name === n)) parts.push(`${n} ${pick(r, f.cfStructures)}`);
  if (spec.dps) {
    const sy = st.wlm.systems.find((x) => x.lparId === spec.dps);
    if (sy) parts.push('DP ' + sy.scps.filter((p) => !/^SYS/.test(p.scKey)).map((p) => `${p.scKey}:${p.dp.toString(16).toUpperCase()}`).join(' '));
  }
  for (const p of spec.paths ?? []) parts.push(`${p}=${fmtDeep(get(st, p))}`);
  return parts.join(' | ');
}

const fmtDeep = (v: unknown): string => (v != null && typeof v === 'object' ? JSON.stringify(v, (_, x) => (typeof x === 'number' && !Number.isInteger(x) ? Number(fmt(x)) : x)) : fmt(v));

// Monitor III DELAY/SYSINFO from the game's view model (it reads only the sim state).
function mon3Dump(st: SimState, scenario: Scenario, sys: string | undefined): string[] {
  const m = buildMon3({ sim: st } as RunState, scenario);
  const out: string[] = [];
  for (const s of m.systems.filter((x) => !sys || sys === '*PLEX' || x.system === sys)) out.push(`SYSINFO ${JSON.stringify(s)}`);
  for (const r of m.rows.filter((x) => !sys || x.system === sys)) {
    const d = r.delay;
    out.push(
      `${r.system} ${r.scKey} imp=${r.importance ?? '-'} pi=${fmt(r.pi)} WFL=${fmt(r.velocity)} USG=${fmt(r.usingFrac)} DLY=${fmt(r.delayFrac)} UKN=${fmt(r.unknownFrac)} ` +
        `PRC=${fmt(d.cpu + d.ziip)} (cp=${fmt(d.cpu)} iip=${fmt(d.ziip)}) DEV=${fmt(d.io)} STR=${fmt(d.stor)} cap=${fmt(d.cap)} reason=${r.primaryReason ?? '-'}`,
    );
  }
  return out;
}

interface Run {
  rows: Map<string, string>;
  dumps: string[];
  log: string[];
  final: string[];
}

function run(spec: Spec): Run {
  const base = SCENARIOS[spec.scenario];
  if (!base) throw new Error(`unknown scenario ${spec.scenario} (have ${Object.keys(SCENARIOS).join(', ')})`);
  const scenario = scenarioFor(base, spec.difficulty ?? 'STORY');
  let st = initState(spec.seed ?? 42, scenario);
  const due = new Map<number, Change[]>();
  for (const c of spec.changes ?? []) {
    const t = changeTick(c.at);
    due.set(t, [...(due.get(t) ?? []), c]);
  }
  const out: Run = { rows: new Map(), dumps: [], log: [], final: [] };
  const seen = new Set<number>();
  const logRe = typeof spec.wlmLog === 'string' ? new RegExp(spec.wlmLog) : null;
  for (let t = 0; t < TICKS_PER_DAY * (spec.days ?? 1); t++) {
    const cmds = (due.get(t) ?? []).flatMap((c) => applyChange(st, c));
    const prevLog = st.wlm.log;
    st = step(st, cmds, scenario);
    if (spec.wlmLog && st.wlm.log !== prevLog) {
      // Lines are only appended (old ones shift out at the cap): the new ones follow the previous last line.
      const last = prevLog[prevLog.length - 1];
      const from = last === undefined ? 0 : st.wlm.log.lastIndexOf(last) + 1;
      for (const l of st.wlm.log.slice(from)) {
        const hour = Number(/ (\d\d):\d\d:\d\d /.exec(l)?.[1] ?? hhmm(t).slice(0, 2));
        if ((!spec.hours || spec.hours.includes(hour)) && (!logRe || logRe.test(l))) out.log.push(l);
      }
    }
    const iv = st.rmf.intervals[st.rmf.intervals.length - 1];
    if (!iv || seen.has(iv.endTick)) continue;
    seen.add(iv.endTick);
    const day = clockAt(iv.endTick - 1).day + 1;
    const lab = hhmm(iv.endTick);
    const hour = Number(lab.slice(0, 2));
    const key = `d${day} ${lab}`;
    if (!spec.hours || spec.hours.includes(hour)) out.rows.set(key, intervalRow(spec, iv, st));
    if (spec.dump?.includes(lab)) {
      const sys = spec.systems?.[0] ?? '*PLEX';
      for (const d of spec.dumpWhat ?? ['WLM']) {
        out.dumps.push(`--- ${key} ${d} ---`);
        if (d === 'WLM') out.dumps.push(renderWlmSummary(iv, sys));
        else if (d === 'PART') out.dumps.push(renderPartitionData(iv));
        else if (d === 'CF') out.dumps.push(renderCfActivity(iv));
        else if (d === 'DASD') out.dumps.push(renderDasdSummary(iv));
        else if (d.startsWith('DET:')) out.dumps.push(renderWlmDetail(iv, d.slice(4), sys));
        else if (d === 'MON3') out.dumps.push(...mon3Dump(st, scenario, spec.systems?.[0]));
      }
    }
  }
  for (const p of spec.final ?? []) out.final.push(`${p} = ${JSON.stringify(get(st, p) ?? null)}`);
  return out;
}

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (paths.length === 0) {
  console.error('usage: npm run lab -- <control.json> [<treatment.json> ...]');
  process.exit(2);
}
const labels = paths.map((_, i) => String.fromCharCode(65 + i));
const runs = paths.map((p) => run(loadSpec(p)));
paths.forEach((p, i) => console.log(`${labels[i]} = ${p}`));
for (const key of runs[0]!.rows.keys()) {
  if (runs.length === 1) console.log(`${key} | ${runs[0]!.rows.get(key)}`);
  else {
    console.log(key);
    runs.forEach((r, i) => console.log(`  ${labels[i]} | ${r.rows.get(key) ?? '(no row)'}`));
  }
}
runs.forEach((r, i) => {
  if (r.dumps.length || r.final.length || r.log.length) console.log(`\n=== ${labels[i]} ===`);
  for (const d of r.dumps) console.log(d);
  if (r.log.length) console.log(`--- WLM log (${r.log.length} lines) ---\n${r.log.join('\n')}`);
  for (const f of r.final) console.log(f);
});
