// Headless runner: simulate N days and print summaries. Used for balancing.
// Usage: npm run sim -- --days 1 --seed 42 [--hourly] [--log]

import { SCENARIOS } from '../src/content/scenarios';
import { initState } from '../src/sim/core/init';
import { instanceClock, step } from '../src/sim/core/step';
import { clockAt } from '../src/sim/core/clock';
import { TICKS_PER_DAY } from '../src/sim/core/units';
import { goalInfo, tickPi } from '../src/sim/wlm/runtime';
import { velocityOf } from '../src/sim/wlm/goals';
import { estimateMonth } from '../src/sim/cost/mlc';
import { renderCfActivity, renderDasdSummary, renderPartitionData, renderWlmDetail, renderWlmSummary } from '../src/sim/measure/reports';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : dflt;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const scenario = SCENARIOS[arg('scenario', 'midwest')]!;
const days = Number(arg('days', '1'));
const seed = Number(arg('seed', '42'));
const hourly = flag('hourly');
const showLog = flag('log');

const reportHour = arg('report', '');
const detail = arg('detail', '');
let state = initState(seed, scenario);
// --dc LPAR=MSU[,LPAR=MSU] sets defined capacities (quick capping experiments).
for (const kv of arg('dc', '').split(',').filter(Boolean)) {
  const [id, v] = kv.split('=');
  const l = state.config.lpars.find((x) => x.id === id);
  if (l) l.definedCapacityMsu = Number(v);
}
const t0 = performance.now();

for (let d = 0; d < days; d++) {
  const wl: Record<string, { c: number; ok: number; f: number; rt: number }> = {};
  const busy: Record<string, { sum: number; peak: number }> = {};
  const hours: Record<number, { busy: Record<string, number>; pi: Record<string, number[]>; n: number; io: number; cf: string; running: number; lock: number }> = {};
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    state = step(state, [], scenario);
    const hour = Math.floor(clockAt(state.tick - 1).hourOfDay);
    const h = (hours[hour] ??= { busy: {}, pi: {}, n: 0, io: 0, cf: '', running: 0, lock: 0 });
    h.n++;
    h.io += state.env.dasd ? state.env.dasd.classes.RANDOM.rtSec * 1000 : 0;
    h.running += state.batch.jobs.filter((j) => j.status === 'RUNNING').length;
    h.lock += state.env.lockIndex;
    h.cf = state.env.cf.map((c) => `${c.lparId}:${(c.busyFrac * 100).toFixed(0)}%/${(c.serviceSec * 1e6).toFixed(0)}us/a${(c.asyncFrac * 100).toFixed(0)}%`).join(' ');
    for (const w of state.last.workloads) {
      const a = (wl[w.id] ??= { c: 0, ok: 0, f: 0, rt: 0 });
      a.c += w.completions;
      a.ok += w.withinSla;
      a.f += w.failed;
      a.rt += w.rtSumSec;
    }
    for (const l of state.lpars) {
      const cp = l.pools.find((p) => p.pool === 'CP');
      if (!cp) continue;
      const cfg = state.config.lpars.find((x) => x.id === l.id)!;
      const lcp = cfg.pools.find((p) => p.pool === 'CP')!.logical;
      const b = cp.deliveredEngines / lcp;
      const a = (busy[l.id] ??= { sum: 0, peak: 0 });
      a.sum += b;
      a.peak = Math.max(a.peak, b);
      h.busy[l.id] = (h.busy[l.id] ?? 0) + cp.deliveredEngines;
    }
    for (const lt of state.last.lpars) {
      for (const s of lt.scps) {
        const g = goalInfo(state.wlm.definition, s.scKey);
        if (!g || g.goal.kind === 'DISC') continue;
        const pi = tickPi(g.goal, s);
        if (pi !== null) (h.pi[`${lt.lparId}.${s.scKey}`] ??= []).push(pi);
      }
    }
  }
  console.log(`\n=== Day ${d + 1} ===`);
  console.log('Workload      completions   SLA%    avgRT(ms)  failed');
  for (const [id, a] of Object.entries(wl)) {
    const w = scenario.workloads.find((x) => x.id === id)!;
    const sla = w.sla.kind === 'NONE' || a.c === 0 ? '   -  ' : ((100 * a.ok) / a.c).toFixed(2).padStart(6);
    console.log(
      `${id.padEnd(12)} ${a.c.toFixed(0).padStart(12)}  ${sla}  ${(a.c > 0 ? (1000 * a.rt) / a.c : 0).toFixed(1).padStart(9)}  ${a.f.toFixed(0).padStart(7)}`,
    );
  }
  console.log('LPAR   avgBusy  peakBusy (of logical CPs)');
  for (const [id, a] of Object.entries(busy)) {
    console.log(`${id.padEnd(6)} ${((100 * a.sum) / TICKS_PER_DAY).toFixed(1).padStart(7)}%  ${(100 * a.peak).toFixed(1).padStart(7)}%`);
  }
  const night = state.batch.nights[state.batch.nights.length - 1];
  if (night) {
    console.log(
      `Batch night D${night.day + 1}: ${night.done}/${night.jobs} jobs, critical ${night.criticalDone}/${night.criticalJobs}, ` +
        `critical end ${night.criticalEndSec !== null ? instanceClock(night.criticalEndSec) : 'UNFINISHED'}${night.missedDeadline ? '  *** DEADLINE MISSED ***' : ''}`,
    );
  }
  const r4 = state.capping.lpars.map((r) => `${r.id}=${r.r4ha.toFixed(0)}${r.capped ? '(CAPPED)' : ''}`).join(' ');
  const peaks = state.cost.peaks.map((p) => `${p.product}=${p.peakMsu.toFixed(0)}`).join(' ');
  console.log(`R4HA now: ${r4}   month peaks MSU: ${peaks}   MLC est $${Math.round(estimateMonth(state.cost, scenario.products)).toLocaleString()}`);
  const lastCf = state.env.cf.map((c) => `${c.lparId} busy ${(c.busyFrac * 100).toFixed(0)}% sync ${(c.syncSec * 1e6).toFixed(0)}us async ${(c.asyncFrac * 100).toFixed(0)}%`).join(' | ');
  console.log(`CF (05:59): ${lastCf}`);
  if (hourly) {
    console.log('\nHour  CPC CP busy (engines delivered per LPAR)   worst PIs');
    const order = [...Array(24).keys()].map((i) => (i + 6) % 24);
    for (const hr of order) {
      const h = hours[hr];
      if (!h) continue;
      const b = Object.entries(h.busy).map(([id, s]) => `${id}=${(s / h.n).toFixed(2)}`).join(' ');
      const worst = Object.entries(h.pi)
        .map(([k, xs]) => [k, xs.reduce((a, x) => a + x, 0) / xs.length] as const)
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(' ');
      console.log(`${String(hr).padStart(2, '0')}:00 ${b}  io=${(h.io / h.n).toFixed(2)}ms jobs=${(h.running / h.n).toFixed(1)} lock=${(h.lock / h.n).toFixed(1)}  ${worst}`);
    }
  }
}

if (reportHour) {
  const want = Number(reportHour);
  const iv = [...state.rmf.intervals].reverse().find((x) => Math.floor(clockAt(x.endTick).hourOfDay) === want);
  if (iv) {
    console.log('\n' + renderWlmSummary(iv));
    if (detail) console.log('\n' + renderWlmDetail(iv, detail));
    console.log('\n' + renderPartitionData(iv));
    console.log('\n' + renderCfActivity(iv));
    console.log('\n' + renderDasdSummary(iv));
  }
}
for (const b of state.cost.bills) {
  console.log(`\nMLC bill month ${b.month + 1}: $${Math.round(b.total).toLocaleString()}  ` + b.lines.map((l) => `${l.product} ${l.peakMsu.toFixed(0)} MSU $${Math.round(l.cost).toLocaleString()}`).join(' | '));
}

if (showLog) {
  console.log('\nWLM activity (last 40):');
  for (const l of state.wlm.log.slice(-40)) console.log('  ' + l);
}
console.log('\nFinal DPs:');
for (const s of state.wlm.systems) {
  const parts = s.scps
    .filter((p) => p.scKey !== 'SYSTEM#1' && p.scKey !== 'SYSSTC#1')
    .map((p) => {
      const v = velocityOf(p.acc.using, p.acc.delay);
      return `${p.scKey}:${p.dp.toString(16).toUpperCase()}${v !== null ? `(v${v.toFixed(0)})` : ''}`;
    });
  console.log(`  ${s.lparId}: ${parts.join(' ')}`);
}
console.log(`\n${days} day(s) in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
