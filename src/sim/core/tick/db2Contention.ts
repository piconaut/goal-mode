import { paceDb2Reader, readClaims } from '../../subsys/db2Contention';
import type { SliceResult, SliceSpec } from '../../wlm/eval/types';
import { lognormCdf } from '../math';
import { TICK_SEC } from '../units';
import type { TickCtx } from './ctx';
import type { ImagePlan } from './plan';

export interface ReaderDispatch {
  member: string;
  slices: readonly SliceSpec[];
  intake: ReturnType<typeof readClaims>;
  freshCpRefSec: number;
  freshZiipRefSec: number;
  dbatFailed: number;
  dbatQueued: number;
}

// This runs once per participating image. Use the member's existing DBAT queue's admissions, allocated
// proportionally to the offered queue mix. Existing claims carry CPU demand in the reader's last period.
export function prepareDb2Reader(
  t: TickCtx, img: ImagePlan, slices: readonly SliceSpec[],
  offeredToDbat: number, totalAdmitted: number, totalQueued: number, accessFrac: number,
): void {
  const d = t.db2Contention!;
  const member = img.db2!.ssid;
  let rate = 0;
  for (const s of slices) rate += s.rate;
  const old = d.before?.readers[member];
  if (!old && rate <= 0) return;
  const offered = rate * TICK_SEC + (old?.dbatQueued ?? 0);
  const dbatMix = offeredToDbat > 0 ? Math.min(1, offered / offeredToDbat) : 0;
  const admitted = Math.min(offered, totalAdmitted * dbatMix);
  const dbatQueued = Math.min(offered - admitted, totalQueued * dbatMix);
  const intake = readClaims(d, member, admitted * accessFrac, t.prev.tick);
  const dbatFailed = Math.max(0, offered - admitted - dbatQueued) + admitted * (1 - accessFrac);
  const share = rate > 0 ? intake.starting / (rate * TICK_SEC) : 0;
  let freshCp = 0;
  let freshZiip = 0;
  for (const s of slices) {
    s.rate *= share;
    s.cpEngines *= share;
    s.ziipEngines *= share;
    s.failFrac = 0; // Connection and admission losses are counted separately.
    s.timeoutSec = Infinity; // Existing admitted readers time out in the cohort, after holding their claims.
    if (intake.waitSec > 0) s.extraParts!.drainLock = intake.waitSec;
    s.extraOtherSec += intake.waitSec;
    freshCp += s.cpEngines;
    freshZiip += s.ziipEngines;
  }
  const last = slices.at(-1);
  if (last && rate === 0 && intake.starting > 0) {
    last.rate = intake.starting / TICK_SEC;
    freshCp = last.cpEngines = last.rate * last.cpuSecPerTxn;
    freshZiip = last.ziipEngines = last.rate * last.ziipSecPerTxn;
  }
  if (last && old) {
    last.cpEngines += old.cpRefSec / (TICK_SEC * img.cpSpeed);
    last.ziipEngines += old.ziipRefSec / (TICK_SEC * img.ziipSpeed);
  }
  (t.readerDispatch ??= {})[img.lpar.id] = {
    member, slices, intake, freshCpRefSec: freshCp * TICK_SEC * img.cpSpeed,
    freshZiipRefSec: freshZiip * TICK_SEC * img.ziipSpeed, dbatFailed, dbatQueued,
  };
}

export function finishDb2Reader(
  t: TickCtx, img: ImagePlan, reader: ReaderDispatch, slices: readonly SliceSpec[], results: readonly SliceResult[],
): void {
  const d = t.db2Contention!;
  let cpRefSec = 0;
  let ziipRefSec = 0;
  let cappedRefSec = 0;
  // Slices for a workload are adjacent and in period order.
  const start = slices.indexOf(reader.slices[0]!);
  const end = start + reader.slices.length;
  for (let i = start; i < end; i++) {
    const r = results[i]!;
    cpRefSec += r.cpGranted * TICK_SEC * img.cpSpeed;
    // The dispatcher debits IIPCP from eligible demand in the same engine-seconds as native zIIP service.
    ziipRefSec += (r.ziipGranted + r.iipcpGranted) * TICK_SEC * img.ziipSpeed;
    cappedRefSec += r.delayCap * TICK_SEC * img.cpSpeed;
  }
  const old = d.before?.readers[reader.member];
  const demand = (old?.cpRefSec ?? 0) + (old?.ziipRefSec ?? 0) + reader.freshCpRefSec + reader.freshZiipRefSec;
  const workload = t.workloadById[d.profile.reader]!;
  const result = paceDb2Reader(old, reader.intake, reader.freshCpRefSec, reader.freshZiipRefSec,
    cpRefSec, ziipRefSec, demand > 0 ? Math.min(1, cappedRefSec / demand) : 0, workload.timeoutSec);
  if (result.reader.count > 1e-9 || result.reader.pending > 1e-9 || reader.dbatQueued > 1e-9) {
    d.readers[reader.member] = { ...result.reader, dbatQueued: reader.dbatQueued };
  }
  // Stamp actual commits before the usual WLM and workload accounting consume the same slice results.
  // Carryover belongs to the last period, where its CPU was demanded.
  for (let i = start; i < end; i++) {
    const s = slices[i]!;
    const r = results[i]!;
    const last = i === end - 1;
    const ageCompletions = last ? result.completedOld : 0;
    r.completions = ageCompletions + (reader.intake.starting > 0 ? result.completedFresh * s.rate * TICK_SEC / reader.intake.starting : 0);
    r.failed = last ? reader.intake.failed + reader.dbatFailed + result.aborted : 0;
    if (ageCompletions > 0) {
      const additionalSec = Math.max(0, (old?.ageSec ?? 0) - r.rtMeanSec) * ageCompletions / r.completions;
      r.rtMeanSec += additionalSec;
      r.userRtSec += additionalSec;
      if (r.parts) r.parts.backlogWait += additionalSec;
    }
    r.withinSla = s.slaRtSec === null ? 0 : r.completions * lognormCdf(s.slaRtSec, r.userRtSec, s.rtSigma);
  }
}
