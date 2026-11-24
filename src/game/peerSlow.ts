// Peer-slow resources (RT-35, docs/rca-design.md §4.1, §4.6): a CF or an LCU far slower than its peers is a
// standing misconfiguration, which growth against the resource's own history cannot see. The recipe's discriminator
// and the truth's accepted-set source read the same rows and the same line, so they cannot drift.

import { PEER_SLOW_RATIO } from '../content/sla';
import type { RmfInterval } from '../sim/measure/rmf';

/** A CF Activity row's fields the peer rule reads (per CF, same interval). */
export interface CfPeerRow {
  lparId: string;
  reqPerSec: number;
  syncUs: number;
  asyncPct: number;
}

/** A DASD Activity row's fields the peer rule reads (per LCU, same interval). */
export interface LcuPeerRow {
  id: string;
  iops: number;
  discMs: number;
  rtMs: number;
}

/** The RMF rows a truth's peer-slow source reads, and the CFs the work's hosts connect to. */
export interface PeerRows {
  cf: CfPeerRow[];
  lcus: LcuPeerRow[];
  connectedCf: string[];
}

/** The interval's CF/DASD rows for the peer rule (RT-35), filtered to the CFs the work's hosts connect to. */
export function peersOf(iv: Pick<RmfInterval, 'cf' | 'lcus' | 'cfSystems'>, hostLpars: readonly string[]): PeerRows {
  return {
    cf: iv.cf.map((c) => ({ lparId: c.lparId, reqPerSec: c.reqPerSec, syncUs: c.syncUs, asyncPct: c.asyncPct })),
    lcus: iv.lcus.map((l) => ({ id: l.id, iops: l.iops, discMs: l.discMs, rtMs: l.rtMs })),
    connectedCf: [...new Set((iv.cfSystems ?? []).filter((x) => hostLpars.includes(x.system)).map((x) => x.cfLparId))],
  };
}

/** The reading a peer-slow comparison was made against, frozen on the pin like `baseline`. */
export interface PeerReading {
  value: number;
  /** `CF01`, or `the LCU median`. */
  of: string;
}

export type CfPeerMetric = 'syncUs' | 'asyncPct';
export type LcuPeerMetric = 'discMs' | 'rtMs';

const median = (xs: readonly number[]): number | undefined => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The best CF of the sysplex for one metric: the lowest sync service time, or the lowest async conversion. A CF
 *  with no requests has no reading; a zero cannot be a ratio's denominator, so it has none either. */
export function cfPeer(cf: readonly CfPeerRow[], metric: CfPeerMetric): PeerReading | undefined {
  let best: CfPeerRow | undefined;
  for (const c of cf) {
    if (c.reqPerSec <= 0 || !Number.isFinite(c[metric]) || c[metric] <= 0) continue;
    if (!best || c[metric] < best[metric] || (c[metric] === best[metric] && c.lparId < best.lparId)) best = c;
  }
  return best ? { value: best[metric], of: best.lparId } : undefined;
}

/** The all-LCU median of DISC or response time, over LCUs with activity and a positive reading. */
export function lcuPeer(lcus: readonly LcuPeerRow[], metric: LcuPeerMetric): PeerReading | undefined {
  const value = median(lcus.filter((l) => l.iops > 0 && Number.isFinite(l[metric]) && l[metric] > 0).map((l) => l[metric]));
  return value !== undefined && value > 0 ? { value, of: 'the LCU median' } : undefined;
}

/** The slowest of the work's CFs that is at least `PEER_SLOW_RATIO` × the best CF, if any. `connected` is the CFs
 *  the work's hosts connect to (Subchannel Activity); without it every CF counts. Sync service time is tried before
 *  async conversion, so the reason names the reading a reader would look at first. */
export function slowCf(
  cf: readonly CfPeerRow[],
  connected?: readonly string[],
): { row: CfPeerRow; metric: CfPeerMetric; peer: PeerReading; ratio: number } | undefined {
  const use = connected && connected.length > 0 ? cf.filter((c) => connected.includes(c.lparId)) : cf;
  for (const metric of ['syncUs', 'asyncPct'] as const) {
    const peer = cfPeer(cf, metric);
    if (!peer) continue;
    let slow: CfPeerRow | undefined;
    for (const c of use) {
      if (c.reqPerSec <= 0 || !Number.isFinite(c[metric]) || c[metric] <= 0) continue;
      if (!slow || c[metric] > slow[metric] || (c[metric] === slow[metric] && c.lparId < slow.lparId)) slow = c;
    }
    if (!slow) continue;
    const ratio = slow[metric] / peer.value;
    if (ratio >= PEER_SLOW_RATIO) return { row: slow, metric, peer, ratio };
  }
  return undefined;
}

/** The slowest LCU at least `PEER_SLOW_RATIO` × the all-LCU median, if any. DISC is tried before response time, as
 *  with `slowCf`. */
export function slowLcu(lcus: readonly LcuPeerRow[]): { row: LcuPeerRow; metric: LcuPeerMetric; peer: PeerReading; ratio: number } | undefined {
  for (const metric of ['discMs', 'rtMs'] as const) {
    const peer = lcuPeer(lcus, metric);
    if (!peer) continue;
    let slow: LcuPeerRow | undefined;
    for (const l of lcus) {
      if (l.iops <= 0 || !Number.isFinite(l[metric]) || l[metric] <= 0) continue;
      if (!slow || l[metric] > slow[metric] || (l[metric] === slow[metric] && l.id < slow.id)) slow = l;
    }
    if (!slow) continue;
    const ratio = slow[metric] / peer.value;
    if (ratio >= PEER_SLOW_RATIO) return { row: slow, metric, peer, ratio };
  }
  return undefined;
}
