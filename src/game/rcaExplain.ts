// The numbers behind a CPU mechanism verdict, in the words a player can check against the reports.
// Computed when the RCA is filed (the RMF intervals of the incident's hours are still kept) and
// stored on the verdict, so an old save shows nothing rather than a guess.

import { CPU_CAPACITY } from '../content/incidents';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { RmfInterval } from '../sim/measure/rmf';
import type { Incident, RunState } from './types';

const pct = (v: number) => `${v.toFixed(0)} %`;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

interface Busy {
  id: string;
  value: number;
}

/** Highest average busy over the incident's intervals, per image and per CPC (general CPs). */
function busiest(idOf: (iv: RmfInterval) => { id: string; value: number | undefined }[], ivs: readonly RmfInterval[]): Busy | null {
  const byId = new Map<string, number[]>();
  for (const iv of ivs) {
    for (const { id, value } of idOf(iv)) {
      if (value === undefined || !Number.isFinite(value)) continue;
      const list = byId.get(id) ?? [];
      list.push(value);
      byId.set(id, list);
    }
  }
  let best: Busy | null = null;
  for (const [id, values] of byId) {
    const value = mean(values);
    if (value !== null && (!best || value > best.value)) best = { id, value };
  }
  return best;
}

/**
 * One line explaining the CPU mechanism verdict, e.g. "CPC CPCA averaged 81 % busy, below the 90 % capacity
 * line: capacity was not the constraint." Only CPU mechanisms get one; anything else returns null.
 */
export function mechanismExplanation(run: RunState, inc: Incident): string | null {
  const mech = inc.truth.mechanism;
  if (mech !== 'CPU_CAPACITY' && mech !== 'CPU_PRIORITY') return null;
  const end = inc.endTick ?? inc.startTick + inc.hours * TICKS_PER_HOUR;
  const ivs = run.sim.rmf.intervals.filter((iv) => iv.endTick > inc.startTick && iv.startTick < end);
  if (ivs.length === 0) return null;
  // The images this work was routed to when it broke; its own report rows name them if the routing is gone.
  const routed = Object.entries(run.sim.routing[inc.workloadId] ?? {}).filter(([, f]) => f > 0).map(([lparId]) => lparId);
  const lpars = new Set(routed.length > 0 ? routed : ivs.flatMap((iv) => iv.wlm.filter((w) => w.lparId !== '*PLEX').map((w) => w.lparId)));
  const cpcOf = new Map(run.sim.config.lpars.map((l) => [l.id, l.cpcId]));
  const cpcs = new Set([...lpars].map((id) => cpcOf.get(id)).filter((id): id is string => id !== undefined));

  const cpc = busiest((iv) => iv.cpcBusy.filter((c) => cpcs.has(c.cpcId) && c.pool === 'CP').map((c) => ({ id: c.cpcId, value: c.physicalBusyPct })), ivs);
  const lpar = busiest((iv) => iv.cpu.filter((c) => lpars.has(c.lparId)).map((c) => ({ id: c.lparId, value: c.logicalBusyPct })), ivs);
  const cpcLine = Math.round(CPU_CAPACITY.cpcBusyFrac * 100);
  const lparLine = Math.round(CPU_CAPACITY.lparBusyFrac * 100);
  const donorLine = Math.round(CPU_CAPACITY.donorFrac * 100);
  const cpcFull = cpc !== null && cpc.value >= cpcLine;
  const lparFull = lpar !== null && lpar.value >= lparLine;

  if (mech === 'CPU_CAPACITY') {
    const where = cpcFull && cpc ? `CPC ${cpc.id} averaged ${pct(cpc.value)} busy (capacity line ${cpcLine} %)` : lpar && lparFull ? `LPAR ${lpar.id} used ${pct(lpar.value)} of the CP it could get (capacity line ${lparLine} %)` : cpc ? `CPC ${cpc.id} averaged ${pct(cpc.value)} busy` : 'the image was full';
    return `${where}, and less important work had under ${donorLine} % of the CP to give: the machine, not the policy, was short.`;
  }
  if (!cpcFull && !lparFull) {
    const where = cpc ? `CPC ${cpc.id} averaged ${pct(cpc.value)} busy` : lpar ? `LPAR ${lpar.id} used ${pct(lpar.value)} of the CP it could get` : 'the image was not full';
    return `${where}, below the ${cpcLine} % capacity line: capacity was not the constraint.`;
  }
  const where = cpcFull && cpc ? `CPC ${cpc.id} averaged ${pct(cpc.value)} busy (capacity line ${cpcLine} %)` : `LPAR ${lpar!.id} used ${pct(lpar!.value)} of the CP it could get (capacity line ${lparLine} %)`;
  return `${where}, but less important work had at least ${donorLine} % of the CP to take: WLM had the CPU to move, so the policy is what held this work back.`;
}
