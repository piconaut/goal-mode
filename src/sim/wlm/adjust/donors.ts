import { POLICY_ADJUST } from '../../../content/wlm/tuning';
import { servedBy } from '../holders';
import type { ScpGoalInfo, ScpState } from '../runtime';
import type { AdjustContext } from './context';

/**
 * The worse of a period's management PIs, local and sysplex: what "missing its goal" is read from. APPROX: a period
 * with neither (no completions yet, e.g. a new response-time period) is not known to meet its goal, so it counts as
 * missing it (Infinity): it donates last at its importance, never when more important than the receiver, and a less
 * important receiver does not pass it. A period that structurally has no PI (only server regions in it) is not a goal
 * holder once server periods exist (WT-09, docs/wlm-design.md §5.8); until then it is judged by this rule too.
 */
export function managementWorstPi(localPi: number | null | undefined, sysplexPi: number | null | undefined): number {
  return localPi == null && sysplexPi == null ? Infinity : Math.max(localPi ?? 0, sysplexPi ?? 0);
}

export interface DonorInfo {
  importance: ScpGoalInfo['importance'];
  localPi: number | null;
  sysplexPi: number | null;
  /** Decayed processor use, as stored in ScpAcc (CPU includes IIPCP). */
  acc: Pick<ScpState['acc'], 'cpuEngines' | 'ziipEngines'>;
}

/**
 * Goal periods at or above the receiver using the delayed processor (WLM Services 3.1, PDF p.147 (printed 123);
 * SG24-7621-00, January 2010, PDF p.105 (printed 93)). Happy periods give first, lowest PI first regardless of
 * importance (SG24-6472-03, March 2008, PDF p.59–60 (printed 41–42)); then reverse receiver order
 * (WLM Services 3.1, PDF p.138 (printed 114)). APPROX: happiness uses the worse of local/sysplex PI
 * (`managementWorstPi`), processor use is exponentially smoothed, and the small-consumer threshold and donor limit
 * are FICTIONAL. The pool is holders (docs/wlm-design.md §5.5): `receiver` is the receiver's holder, and a server
 * period's entry is `holderDonorInfo` over the classes it serves (the goal donors of one resource donor,
 * WLM Services 3.1, PDF p.138 (printed 114)).
 * `receiverImportance` is the receiver period's own, which can be less important than its holder's.
 * `info` contains goal holders only; discretionary work is fixed below the managed ladder.
 */
export function donorOrder(
  receiver: string,
  bottleneck: 'CPU' | 'ZIIP',
  dps: Readonly<Record<string, number>>,
  info: Readonly<Record<string, DonorInfo>>,
  tuning: Pick<typeof POLICY_ADJUST, 'accDecay' | 'donorMinEngines' | 'donorsPerReceiver'> = POLICY_ADJUST,
  receiverImportance?: number,
): string[] {
  const r = info[receiver];
  const rdp = dps[receiver];
  if (!r || rdp === undefined) return [];
  const rImp = receiverImportance ?? r.importance;
  return Object.keys(info)
    .map((key) => {
      const g = info[key]!;
      const worst = managementWorstPi(g.localPi, g.sysplexPi);
      const used = bottleneck === 'CPU' ? g.acc.cpuEngines : (g.acc.ziipEngines ?? 0);
      return { key, importance: g.importance, worst, engines: used * (1 - tuning.accDecay) };
    })
    .filter((g) => g.key !== receiver && dps[g.key] !== undefined && dps[g.key]! >= rdp &&
      g.engines >= tuning.donorMinEngines && !(g.worst > 1 && g.importance < rImp))
    .sort((a, b) => {
      const happyA = a.worst < 1;
      const happyB = b.worst < 1;
      return Number(happyB) - Number(happyA) || (!happyA ? b.importance - a.importance : 0) ||
        (a.worst === b.worst ? 0 : a.worst - b.worst) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    })
    .slice(0, tuning.donorsPerReceiver)
    .map((g) => g.key);
}

/** A holder's donor entry from the goal periods it serves: the most important of them, the worst of their PIs (none
 * counts as missing, as `managementWorstPi`) and the sum of their processor use. APPROX: the regions' own overhead
 * stays in the region class's accumulators and is not counted. */
function holderDonorInfo(served: readonly DonorInfo[]): DonorInfo {
  let importance = served[0]!.importance;
  let local: number | null = null;
  let plex: number | null = null;
  let cpu = 0;
  let zi = 0;
  for (const g of served) {
    if (g.importance < importance) importance = g.importance;
    if (g.localPi == null && g.sysplexPi == null) local = Infinity;
    else {
      if (g.localPi != null) local = Math.max(local ?? 0, g.localPi);
      if (g.sysplexPi != null) plex = Math.max(plex ?? 0, g.sysplexPi);
    }
    cpu += g.acc.cpuEngines;
    zi += g.acc.ziipEngines ?? 0;
  }
  return { importance, localPi: local, sysplexPi: plex, acc: { cpuEngines: cpu, ziipEngines: zi } };
}

export function donorInfoFor({ input, info, localPi, accOf, holderKeys, holderInfo, topo, infoKeys }: AdjustContext): Record<string, DonorInfo> {
  // Donors are holders (§5.5): a server period is one donor for all the classes it serves.
  const periodDonor = (k: string): DonorInfo => ({
    importance: info[k]!.importance, localPi: localPi[k] ?? null, sysplexPi: input.sysplexPi[k] ?? null, acc: accOf[k]!.acc,
  });
  const donorInfo: Record<string, DonorInfo> = {};
  for (const h of holderKeys) donorInfo[h] = holderInfo[h] === info[h] ? periodDonor(h) : holderDonorInfo(servedBy(topo, h, infoKeys).map(periodDonor));
  return donorInfo;
}
