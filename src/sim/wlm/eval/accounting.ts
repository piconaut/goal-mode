// Accounting stage: the per-period ticks RMF reports, plus report classes when the
// policy assigns any.

import { excludeMovedIo, tagCicsSlice } from '../reporting';
import { addToBuckets } from '../goals';
import { baseKey } from './prepare';
import { emptyScpTick, type LparEvalInput, type PreparedLpar, type ReportClassTick, type ScpTick, type SliceResult, type SliceSpec } from './types';

export function periodTicks(
  input: LparEvalInput,
  prepared: PreparedLpar,
  results: readonly SliceResult[],
  scpsOnly: boolean,
  bucketsFor: ReadonlySet<string> | undefined,
  aggDp: readonly number[],
): { scps: ScpTick[]; rcs: ReportClassTick[] } {
  const { slices } = input;
  const n = slices.length;
  const { sliceAgg, order } = prepared;
  const reg = input.regions;
  // One tick per period: transaction-server regions are reported with their own class (WLM Planning p.113).
  const scps: ScpTick[] = [];
  const scpOfAgg = new Array<number>(order.length);
  const scpIdx: Record<string, number> = {};
  for (let a = 0; a < order.length; a++) {
    const k = baseKey(order[a]!);
    let j = scpIdx[k];
    if (j === undefined) {
      j = scps.length;
      scpIdx[k] = j;
      scps.push(emptyScpTick(k, aggDp[a]!));
    }
    scpOfAgg[a] = j;
  }
  const rcMap: Record<string, ReportClassTick> = {};
  const rcs: ReportClassTick[] = [];
  const cics = scpsOnly ? undefined : reg?.targets;
  const managedToTxn = reg?.managedToTxn ?? false;
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const r = results[i]!;
    const cicsTxn = cics !== undefined && reg!.transactionKeys!.has(s.key);
    if (s.reportClass && !scpsOnly) {
      let rt = rcMap[s.reportClass];
      if (!rt) {
        rt = { ...emptyScpTick(s.reportClass, 0), members: [] };
        rcMap[s.reportClass] = rt;
        rcs.push(rt);
      }
      if (!rt.members.includes(s.scKey)) rt.members.push(s.scKey);
      addSliceTo(rt, s, r, true);
      if (cicsTxn) tagCicsSlice(rt, s, r, cics.regionKeys, true, managedToTxn);
    }
    const t = scps[scpOfAgg[sliceAgg[i]!]!]!;
    const untracked = reg !== undefined && reg.rtTracked === false && s.kind === 'TXN' && reg.keys.includes(s.scKey);
    addSliceTo(t, s, r, bucketsFor === undefined || bucketsFor.has(s.scKey), !untracked);
    if (cicsTxn) tagCicsSlice(t, s, r, cics.regionKeys, !untracked, managedToTxn);
    if (order[sliceAgg[i]!] !== s.scKey) {
      // Not managed to its own class's goal: its samples stay out of the class's PI (WLM Planning p.122).
      t.srvUsing = (t.srvUsing ?? 0) + r.usingCpu + r.usingZiip + (input.ioPriority === false ? 0 : r.usingIo);
      t.srvDelay = (t.srvDelay ?? 0) + r.delayCpu + r.delayZiip + (input.ioPriority === false ? 0 : r.delayIo) + r.delayStorage + r.delayCap;
    }
  }
  // With I/O priority management off, I/O using and delay samples are still reported but "not included" in
  // the velocity formula (WLM Planning p.70, p.115).
  if (input.ioPriority === false) {
    for (const t of scps) excludeIoFromVelocity(t);
    for (const t of rcs) excludeIoFromVelocity(t);
  }
  return { scps, rcs };
}

function excludeIoFromVelocity(t: ScpTick): void {
  t.usingIoNoVel = t.usingIo;
  t.delayIoNoVel = t.delayIo;
  excludeMovedIo(t);
}

function addSliceTo(t: ScpTick, s: SliceSpec, r: SliceResult, buckets: boolean, rt = true): void {
  t.cpEngines += r.cpGranted;
  t.ziipEngines += r.ziipGranted;
  t.iipcpEngines += r.iipcpGranted;
  t.usingCpu += r.usingCpu;
  t.usingZiip += r.usingZiip;
  t.usingIo += r.usingIo;
  t.delayCpu += r.delayCpu;
  t.delayZiip += r.delayZiip;
  t.delayIo += r.delayIo;
  t.delayOther += r.delayOther;
  t.delayStorage += r.delayStorage;
  t.delayCap += r.delayCap;
  if (!rt) return;
  t.completions += r.completions;
  t.failed += r.failed;
  t.rtSumSec += r.completions * r.rtMeanSec;
  if (buckets && s.goalRtSec !== null) addToBuckets(t.buckets, s.goalRtSec, r.completions, r.rtMeanSec, s.rtSigma);
}
