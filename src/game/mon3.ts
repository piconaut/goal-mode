// RMF Monitor III style live views (SPEC §8 tier 1), built from WLM's smoothed per-period
// accumulators. ACC_DECAY 0.85 per 10 s tick weights roughly the last minute or two, close to
// Monitor III's default 100 s range (APPROX: exponential rather than a fixed window).

import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { goalText, velocityOf } from '../sim/wlm/goals';
import { ACC_DECAY, accPi, goalInfo, sumAcc, type ScpAcc } from '../sim/wlm/runtime';
import { allWorkloads } from './workloads';
import type { RunState } from './types';

/** Steady-state normaliser: a decayed sum × (1 − d) is the per-tick average. */
const NORM = 1 - ACC_DECAY;

export interface Mon3Row {
  system: string;
  scKey: string;
  goal: string;
  importance: number | null;
  /** Execution velocity, 0..100 (null when nothing was sampled). */
  velocity: number | null;
  pi: number | null;
  endedPerSec: number;
  avgRtMs: number | null;
  /** CPU (CP + zIIP work on CP) in engines, i.e. APPL% / 100. */
  cpuEngines: number;
  /** Fraction of samples delayed, and its split. */
  delayFrac: number;
  delay: { cpu: number; ziip: number; io: number; cap: number; other: number };
  primaryDelay: string | null;
}

export interface Mon3System {
  system: string;
  cpBusyPct: number;
  ziipBusyPct: number | null;
  msu: number;
  capped: boolean;
  /** Average PI of goal-bearing periods weighted by importance (a SYSINFO-style summary). */
  worstPi: number | null;
}

export interface Mon3Cpc {
  lparId: string;
  kind: 'ZOS' | 'CF';
  weight: number;
  logical: number;
  polarity: string;
  busyPct: number;
  prsmDelayPct: number;
  overheadPct: number;
  cappedPct: number;
}

export interface Mon3Enclave {
  workloadId: string;
  scKey: string;
  endedPerSec: number;
  avgRtMs: number | null;
  pi: number | null;
  cpEngines: number;
  ziipEngines: number;
  iipcpEngines: number;
}

export interface Mon3Exception {
  severity: 'warn' | 'crit';
  where: string;
  text: string;
}

export interface Mon3View {
  rangeSec: number;
  systems: Mon3System[];
  rows: Mon3Row[];
  cpc: Mon3Cpc[];
  logicalToPhysical: number;
  enclaves: Mon3Enclave[];
  exceptions: Mon3Exception[];
}

const DELAY_NAMES: [keyof Mon3Row['delay'], string][] = [
  ['cpu', 'CPU'],
  ['ziip', 'zIIP'],
  ['io', 'I/O'],
  ['cap', 'CAP'],
  ['other', 'other/UNK (servers, subsystems)'],
];

function row(run: RunState, system: string, scKey: string, a: ScpAcc): Mon3Row {
  const def = run.sim.wlm.definition;
  const g = goalInfo(def, scKey);
  const per = g ? def.classes.find((c) => c.id === g.serviceClass)?.periods[g.period] : undefined;
  const samples = a.using + a.delay + a.delayOther;
  const frac = (x: number) => (samples > 0 ? x / samples : 0);
  const delay = { cpu: frac(a.delayCpu), ziip: frac(a.delayZiip), io: frac(a.delayIo), cap: frac(a.delayCap), other: frac(a.delayOther) };
  const top = DELAY_NAMES.reduce<[string, number] | null>((best, [k, label]) => (delay[k] > 0.02 && (!best || delay[k] > best[1]) ? [label, delay[k]] : best), null);
  const v = velocityOf(a.using, a.delay);
  return {
    system,
    scKey,
    goal: per ? goalText(per) : g ? 'DISCRETIONARY' : 'system',
    importance: g && g.goal.kind !== 'DISC' ? g.importance : null,
    velocity: v,
    pi: g ? accPi(g.goal, a) : null,
    endedPerSec: (a.completions * NORM) / TICK_SEC,
    avgRtMs: a.completions > 0 ? (1000 * a.rtSumSec) / a.completions : null,
    cpuEngines: a.cpuEngines * NORM,
    delayFrac: delay.cpu + delay.ziip + delay.io + delay.cap + delay.other,
    delay,
    primaryDelay: top?.[0] ?? null,
  };
}

export function buildMon3(run: RunState, scenario: Scenario): Mon3View {
  const sim = run.sim;
  const rows: Mon3Row[] = [];
  for (const s of sim.wlm.systems) for (const p of s.scps) rows.push(row(run, s.lparId, p.scKey, p.acc));
  // Sysplex rows, like Monitor III's sysplex-wide SYSSUM.
  const keys = [...new Set(rows.map((r) => r.scKey))].sort();
  for (const k of keys) rows.push(row(run, '*PLEX', k, sumAcc(sim.wlm.systems.flatMap((s) => s.scps.filter((p) => p.scKey === k).map((p) => p.acc)))));

  const cpcEngines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  let totalLogical = 0;
  const cpc: Mon3Cpc[] = sim.config.lpars.map((l) => {
    const poolId = l.kind === 'CF' ? 'ICF' : 'CP';
    const cfg = l.pools.find((p) => p.pool === poolId);
    const rt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === poolId);
    if (l.kind === 'ZOS' && cfg && !cfg.dedicated) totalLogical += cfg.logical;
    return {
      lparId: l.id,
      kind: l.kind,
      weight: cfg?.weight ?? 0,
      logical: cfg?.logical ?? 0,
      polarity: rt && l.hiperDispatch ? `${rt.vh}VH ${rt.vm}VM ${rt.vl}VL` : cfg?.dedicated ? 'DED' : 'SHARED',
      busyPct: rt && cfg && cfg.logical > 0 ? (100 * rt.deliveredEngines) / cfg.logical : 0,
      prsmDelayPct: 100 * (rt?.prsmDelayFrac ?? 0),
      overheadPct: 100 * (rt?.overheadFrac ?? 0),
      cappedPct: 100 * (rt?.cappedFrac ?? 0),
    };
  });

  const systems: Mon3System[] = sim.config.lpars
    .filter((l) => l.kind === 'ZOS')
    .map((l) => {
      const rt = sim.lpars.find((x) => x.id === l.id);
      const cp = rt?.pools.find((p) => p.pool === 'CP');
      const zi = rt?.pools.find((p) => p.pool === 'ZIIP');
      const cfgCp = l.pools.find((p) => p.pool === 'CP');
      const cfgZi = l.pools.find((p) => p.pool === 'ZIIP');
      const pis = rows.filter((r) => r.system === l.id && r.importance !== null && r.pi !== null).map((r) => r.pi!);
      return {
        system: l.id,
        cpBusyPct: cp && cfgCp && cfgCp.logical > 0 ? (100 * cp.deliveredEngines) / cfgCp.logical : 0,
        ziipBusyPct: zi && cfgZi && cfgZi.logical > 0 ? (100 * zi.deliveredEngines) / cfgZi.logical : null,
        msu: rt?.msuRate ?? 0,
        capped: sim.capping.lpars.find((x) => x.id === l.id)?.capped ?? false,
        worstPi: pis.length ? Math.max(...pis) : null,
      };
    });

  // ENCLAVE: DDF work is managed as enclaves; show where each DDF workload lands and its zIIP use.
  const def = sim.wlm.definition;
  const enclaves: Mon3Enclave[] = [];
  for (const w of allWorkloads(scenario, run)) {
    if (w.subsystem !== 'DDF') continue;
    const sc = classify(def, w.work).serviceClass;
    for (const r of rows.filter((x) => x.system === '*PLEX' && x.scKey.startsWith(`${sc}#`))) {
      const last = sim.last.lpars.flatMap((l) => l.scps.filter((p) => p.scKey === r.scKey));
      enclaves.push({
        workloadId: w.id,
        scKey: r.scKey,
        endedPerSec: r.endedPerSec,
        avgRtMs: r.avgRtMs,
        pi: r.pi,
        cpEngines: last.reduce((a, p) => a + p.cpEngines, 0),
        ziipEngines: last.reduce((a, p) => a + p.ziipEngines, 0),
        iipcpEngines: last.reduce((a, p) => a + p.iipcpEngines, 0),
      });
    }
  }

  return {
    rangeSec: Math.round(TICK_SEC / NORM),
    systems,
    rows,
    cpc,
    logicalToPhysical: cpcEngines > 0 ? totalLogical / cpcEngines : 0,
    enclaves,
    exceptions: exceptions(run, rows, systems, cpc, totalLogical, cpcEngines),
  };
}

// FICTIONAL thresholds, in the spirit of a WFEX exception set a site would configure.
const WFEX = { piWarn: 1.5, piCrit: 2, prsmDelayPct: 10, outsideFrac: 0.2, qrFrac: 0.2, ltoP: 2 };

function exceptions(run: RunState, rows: Mon3Row[], systems: Mon3System[], cpc: Mon3Cpc[], totalLogical: number, cpcEngines: number): Mon3Exception[] {
  const out: Mon3Exception[] = [];
  for (const r of rows) {
    if (r.system === '*PLEX' || r.importance === null || r.pi === null || r.pi < WFEX.piWarn) continue;
    out.push({ severity: r.pi >= WFEX.piCrit ? 'crit' : 'warn', where: `${r.system} ${r.scKey}`, text: `PI ${r.pi.toFixed(2)} (imp ${r.importance})${r.primaryDelay ? `, mostly ${r.primaryDelay} delay` : ''}` });
  }
  for (const s of systems) if (s.capped) out.push({ severity: 'crit', where: s.system, text: 'Soft capped: R4HA above defined/group capacity' });
  for (const c of cpc) if (c.kind === 'ZOS' && c.prsmDelayPct > WFEX.prsmDelayPct) out.push({ severity: 'warn', where: c.lparId, text: `PR/SM dispatch delay ${c.prsmDelayPct.toFixed(0)}% (short engines)` });
  if (cpcEngines > 0 && totalLogical / cpcEngines > WFEX.ltoP) out.push({ severity: 'warn', where: 'CPC', text: `Logical:physical ${totalLogical}:${cpcEngines} above 2:1` });
  for (const w of run.sim.last.workloads) {
    if (w.completions <= 0) continue;
    const rt = w.rtSumSec / w.completions;
    if (rt <= 0) continue;
    const outside = (w.parts.outside ?? 0) / w.completions;
    const qr = (w.parts.qr ?? 0) / w.completions;
    if (outside / rt > WFEX.outsideFrac) out.push({ severity: 'crit', where: w.id, text: `${((100 * outside) / rt).toFixed(0)}% of response time queued for a thread or task slot (MXT/MAXDBAT)` });
    if (qr / rt > WFEX.qrFrac) out.push({ severity: 'warn', where: w.id, text: `${((100 * qr) / rt).toFixed(0)}% of response time waiting for the CICS QR TCB` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.where.localeCompare(b.where) : a.severity === 'crit' ? -1 : 1));
}

const BTLNK_TEXT: Record<string, string> = {
  CPU: 'waiting for a general CP',
  ZIIP: 'waiting for a zIIP',
  IO: 'waiting for I/O',
  CAP: 'held back by capping',
  OTHER: 'waiting on a server or subsystem',
};

/** Plain-English reading of one WLM activity-log line ("why did ONLHI move?"). */
export function explainWlmLog(line: string): string {
  const head = /(\S+) RCVR=(\S+) PI=([\d.]+) BTLNK=(\S+) (.*)$/.exec(line);
  if (head) {
    const [, sys, rcvr, pi, btl, action] = head as unknown as [string, string, string, string, string, string];
    const why = `On ${sys}, ${rcvr} was the most important period missing its goal (PI ${pi}, mostly ${BTLNK_TEXT[btl] ?? btl}).`;
    const donor = /^DONOR (\S+) DP (\w+)→(\w+)/.exec(action);
    if (donor) return `${why} WLM lowered donor ${donor[1]} from DP ${donor[2]} to ${donor[3]} so the receiver gets the CPU first.`;
    const up = /DP (\w+)→(\w+)/.exec(action);
    if (up) return `${why} WLM raised its dispatch priority from ${up[1]} to ${up[2]}; the projection said the receiver gains more than donors lose.`;
    return why;
  }
  const notFix = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) not WLM-fixable/.exec(line);
  if (notFix)
    return `On ${notFix[1]}, ${notFix[2]} misses its goal (PI ${notFix[3]}) but is mostly ${BTLNK_TEXT[notFix[4]!] ?? notFix[4]}: dispatching priority can't fix that, so WLM skips it. Look at the delay's real cause.`;
  const noNet = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) no action with net value/.exec(line);
  if (noNet) return `On ${noNet[1]}, ${noNet[2]} misses its goal (PI ${noNet[3]}) but every move WLM projected would hurt donors more than it helps. There isn't enough capacity to go round at this importance.`;
  return line;
}
