// WLM policy adjustment (SG24-7621 §3.12–3.15), run every 10 s per system:
// pick the most important, worst-PI receiver; find its bottleneck; try DP moves
// (receiver up, donors down); accept the first move with receiver value and net value.
// At most one receiver is helped per interval.

import { DP } from '../zos/dispatcher';
import { evaluateLpar, prepareLpar, type LparEvalInput, type ScpTick } from './evaluate';
import { accPi, goalInfo, tickPi, type ScpGoalInfo, type WlmSystemState } from './runtime';
import type { ServiceDefinition } from './types';

export type Bottleneck = 'CPU' | 'ZIIP' | 'IO' | 'CAP' | 'OTHER' | 'NONE';

export function bottleneckOf(t: { delayCpu: number; delayZiip: number; delayIo: number; delayOther: number; delayCap: number }): Bottleneck {
  const opts: [Bottleneck, number][] = [
    ['CPU', t.delayCpu],
    ['ZIIP', t.delayZiip],
    ['IO', t.delayIo],
    ['CAP', t.delayCap],
    ['OTHER', t.delayOther],
  ];
  let best: [Bottleneck, number] = ['NONE', 1e-9];
  for (const o of opts) if (o[1] > best[1]) best = o;
  return best[0];
}

export interface AdjustInput {
  def: ServiceDefinition;
  system: WlmSystemState;
  /** This tick's evaluation input; dpOf is replaced during projection. */
  evalInput: Omit<LparEvalInput, 'dpOf'>;
  current: readonly ScpTick[];
  sysplexPi: Readonly<Record<string, number | null>>;
  clockText: string;
  /** IEAOPT CCIMP on this system. */
  ccImp?: number;
}

export interface AdjustOutput {
  dps: Record<string, number>;
  log: string | null;
}

const RECEIVER_VALUE_FRAC = 0.1;
const DONOR_CREDIT_FLOOR = 0.9;

export function policyAdjust(input: AdjustInput): AdjustOutput {
  const { def, system } = input;
  const dps: Record<string, number> = {};
  for (const s of system.scps) dps[s.scKey] = s.dp;

  const info: Record<string, ScpGoalInfo> = {};
  for (const s of system.scps) {
    const g = goalInfo(def, s.scKey);
    if (g && g.goal.kind !== 'DISC') info[s.scKey] = g;
  }
  const localPi: Record<string, number | null> = {};
  for (const s of system.scps) {
    const g = info[s.scKey];
    localPi[s.scKey] = g ? accPi(g.goal, s.acc) : null;
  }
  const tickOf: Record<string, ScpTick> = {};
  for (const t of input.current) tickOf[t.scKey] = t;
  const instPi = (ticks: readonly ScpTick[]) => {
    const m: Record<string, number | null> = {};
    for (const t of ticks) {
      const g = info[t.scKey];
      m[t.scKey] = g ? tickPi(g.goal, t) : null;
    }
    return m;
  };
  const before = instPi(input.current);

  // Trials only move DPs: the demand stage is shared, and only percentile goals need buckets.
  let projectBase: LparEvalInput | null = null;
  const project = (trial: Record<string, number>) => {
    projectBase ??= {
      ...input.evalInput,
      dpOf: (k) => dps[k] ?? 196,
      scpsOnly: true,
      bucketsFor: new Set(Object.keys(info).filter((k) => info[k]!.goal.kind === 'PCT')),
      prepared: prepareLpar(input.evalInput),
    };
    return instPi(evaluateLpar({ ...projectBase, dpOf: (k) => trial[k] ?? dps[k] ?? 196 }).scps);
  };

  // Long-term CPU protection: less important work never gets an equal or higher DP than a CPU-critical
  // class (MVS Planning: WLM, ch. 14; enqueue promotion is the documented exception, not modelled).
  // CCIMP extends it to first or only periods up to that importance (Init & Tuning p.428). APPROX: no
  // System Recovery Boost in the sim, so CCIMPBOOST never applies.
  const ccImp = input.ccImp ?? 0;
  const violatesCpuCritical = (trial: Record<string, number>) => {
    for (const [k, g] of Object.entries(info)) {
      if (!g.cpuCritical && !(g.period === 0 && g.importance <= ccImp)) continue;
      for (const [k2, g2] of Object.entries(info)) {
        if (g2.importance > g.importance && (trial[k2] ?? 0) >= (trial[k] ?? 0)) return true;
      }
    }
    return false;
  };

  const passes = (receiver: string, trial: Record<string, number>): boolean => {
    if (violatesCpuCritical(trial)) return false;
    const after = project(trial);
    const r0 = before[receiver];
    const r1 = after[receiver];
    if (r0 == null || r1 == null || r1 >= r0) return false;
    if (r0 - r1 < RECEIVER_VALUE_FRAC * (r0 - 1)) return false;
    const rImp = info[receiver]!.importance;
    const gain = Math.max(0, r0 - Math.max(r1, DONOR_CREDIT_FLOOR));
    let equalHarm = 0;
    for (const [k, g] of Object.entries(info)) {
      if (k === receiver) continue;
      const p0 = before[k];
      const p1 = after[k];
      if (p0 == null || p1 == null) continue;
      const harm = Math.max(0, p1 - Math.max(p0, DONOR_CREDIT_FLOOR));
      if (g.importance < rImp && p1 > 1 && harm > 0.02) return false;
      if (g.importance === rImp) {
        // Equal importance: the move must also bring the two PIs closer together (SG24-6472 p.60; Enrico,
        // How WLM Works, slide 52: "less disparity in projected PIs"), or the pair trade places forever.
        if (harm > 0 && Math.abs(r1 - p1) >= Math.abs(r0 - p0)) return false;
        equalHarm += harm;
      }
    }
    return gain > equalHarm;
  };

  const ordered = (piOf: Record<string, number | null>) =>
    Object.keys(info)
      .filter((k) => (piOf[k] ?? 0) > 1 && tickOf[k])
      .sort((a, b) => info[a]!.importance - info[b]!.importance || (piOf[b] ?? 0) - (piOf[a] ?? 0) || (a < b ? -1 : 1));

  const tried = new Set<string>();
  const candidates = [...ordered(input.sysplexPi as Record<string, number | null>), ...ordered(localPi)].filter((k) => {
    if (tried.has(k)) return false;
    tried.add(k);
    return true;
  });

  const notes: string[] = [];
  let projected = 0;
  for (const receiver of candidates) {
    // Projection is the expensive part: assess at most two fixable receivers per interval.
    if (projected >= 2) break;
    const scState = system.scps.find((s) => s.scKey === receiver)!;
    // With I/O priority management off, I/O samples are outside velocity and WLM doesn't manage I/O (WLM Planning p.115).
    const btl = bottleneckOf({ ...scState.acc, delayIo: scState.acc.delayIo - (scState.acc.delayIoNoVel ?? 0) });
    const pi = (input.sysplexPi[receiver] ?? localPi[receiver] ?? 0).toFixed(2);
    if (btl !== 'CPU' && btl !== 'ZIIP') {
      notes.push(`${receiver} PI=${pi} BTLNK=${btl} not WLM-fixable`);
      continue;
    }
    projected++;
    const rdp = dps[receiver]!;
    const rImp = info[receiver]!.importance;
    const trials: { trial: Record<string, number>; text: string }[] = [];

    const levelsAbove = [...new Set(Object.keys(info).map((k) => dps[k]!))]
      .filter((d) => d > rdp)
      .sort((a, b) => a - b)
      .slice(0, 3);
    for (const lvl of levelsAbove) {
      const nd = Math.min(DP.MANAGED_MAX, lvl + 1);
      trials.push({ trial: { ...dps, [receiver]: nd }, text: `${receiver} DP ${hex(rdp)}→${hex(nd)}` });
    }
    if (levelsAbove.length === 0 && rdp < DP.MANAGED_MAX) {
      trials.push({ trial: { ...dps, [receiver]: rdp + 1 }, text: `${receiver} DP ${hex(rdp)}→${hex(rdp + 1)}` });
    }
    // Donors: heavy CPU users at or above the receiver's DP that are less important, or
    // equally important and happy. Least important first (reverse receiver order).
    const donors = Object.keys(info)
      .filter(
        (k) =>
          k !== receiver &&
          dps[k]! >= rdp &&
          (info[k]!.importance > rImp || (info[k]!.importance === rImp && (localPi[k] ?? 0) < 1)) &&
          (tickOf[k]?.cpEngines ?? 0) + (tickOf[k]?.iipcpEngines ?? 0) > 1e-4,
      )
      .sort(
        (a, b) =>
          info[b]!.importance - info[a]!.importance ||
          (tickOf[b]?.cpEngines ?? 0) - (tickOf[a]?.cpEngines ?? 0) ||
          (a < b ? -1 : 1),
      )
      .slice(0, 3);
    for (const d of donors) {
      const nd = Math.max(DP.MANAGED_MIN, rdp - 1);
      trials.push({ trial: { ...dps, [d]: nd }, text: `DONOR ${d} DP ${hex(dps[d]!)}→${hex(nd)}` });
    }

    for (const tr of trials) {
      if (passes(receiver, tr.trial)) {
        return {
          dps: tr.trial,
          log: `${input.clockText} ${system.lparId} RCVR=${receiver} PI=${pi} BTLNK=${btl} ${tr.text}`,
        };
      }
    }
    notes.push(`${receiver} PI=${pi} BTLNK=${btl} no action with net value`);
  }
  return {
    dps,
    log: notes.length > 0 ? `${input.clockText} ${system.lparId} ${notes[0]}` : null,
  };
}

const hex = (n: number) => n.toString(16).toUpperCase();
