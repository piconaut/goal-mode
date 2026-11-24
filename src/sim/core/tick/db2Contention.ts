import { paceDb2Reader, readClaims, type Db2PeriodWork } from '../../subsys/db2Contention';
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
  carry: readonly Db2PeriodWork[];
}

const NO_PERIOD_WORK: readonly Db2PeriodWork[] = [];
const EMPTY_PERIOD: Db2PeriodWork = { cpRefSec: 0, ziipRefSec: 0 };

// This runs once per participating image. Use the member's existing DBAT queue's admissions, allocated
// proportionally to the offered queue mix. Existing claims carry CPU demand in their service-class periods.
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
  let carry = old?.workByPeriod ?? NO_PERIOD_WORK;
  if (carry.length > slices.length) {
    // Policy changes can remove periods. Put the removed periods' work in the last remaining period.
    const lastIndex = slices.length - 1;
    const shortened = carry.slice(0, lastIndex);
    let cpRefSec = 0;
    let ziipRefSec = 0;
    for (let i = lastIndex; i < carry.length; i++) {
      cpRefSec += carry[i]!.cpRefSec;
      ziipRefSec += carry[i]!.ziipRefSec;
    }
    shortened.push({ cpRefSec, ziipRefSec });
    carry = shortened;
  }
  for (let i = 0; i < carry.length; i++) {
    slices[i]!.cpEngines += carry[i]!.cpRefSec / (TICK_SEC * img.cpSpeed);
    slices[i]!.ziipEngines += carry[i]!.ziipRefSec / (TICK_SEC * img.ziipSpeed);
  }
  (t.readerDispatch ??= {})[img.lpar.id] = {
    member, slices, intake, freshCpRefSec: freshCp * TICK_SEC * img.cpSpeed,
    freshZiipRefSec: freshZiip * TICK_SEC * img.ziipSpeed, dbatFailed, dbatQueued, carry,
  };
}

export function finishDb2Reader(
  t: TickCtx, img: ImagePlan, reader: ReaderDispatch, slices: readonly SliceSpec[], results: readonly SliceResult[],
): void {
  const d = t.db2Contention!;
  let cpRefSec = 0;
  let ziipRefSec = 0;
  let oldCpGrant = 0;
  let oldZiipGrant = 0;
  let cappedRefSec = 0;
  let remaining: Db2PeriodWork[] | undefined;
  const cpScale = TICK_SEC * img.cpSpeed;
  const ziipScale = TICK_SEC * img.ziipSpeed;
  // Slices for a workload are adjacent and in period order.
  const start = slices.indexOf(reader.slices[0]!);
  const end = start + reader.slices.length;
  for (let i = start; i < end; i++) {
    const s = slices[i]!;
    const r = results[i]!;
    const cpGrant = r.cpGranted * cpScale;
    // The dispatcher debits IIPCP from eligible demand in the same engine-seconds as native zIIP service.
    const ziipGrant = (r.ziipGranted + r.iipcpGranted) * ziipScale;
    cpRefSec += cpGrant;
    ziipRefSec += ziipGrant;
    cappedRefSec += r.delayCap * cpScale;
    const period = i - start;
    const carry = reader.carry[period];
    if (carry) {
      oldCpGrant += Math.min(carry.cpRefSec, cpGrant);
      oldZiipGrant += Math.min(carry.ziipRefSec, ziipGrant);
    }
    const cpLeft = Math.max(0, s.cpEngines * cpScale - cpGrant);
    const ziipLeft = Math.max(0, s.ziipEngines * ziipScale - ziipGrant);
    if (cpLeft > 1e-12 || ziipLeft > 1e-12) {
      (remaining ??= Array.from({ length: reader.slices.length }, () => EMPTY_PERIOD))[period] = {
        cpRefSec: cpLeft, ziipRefSec: ziipLeft,
      };
    }
  }
  const old = d.before?.readers[reader.member];
  const demand = (old?.cpRefSec ?? 0) + (old?.ziipRefSec ?? 0) + reader.freshCpRefSec + reader.freshZiipRefSec;
  const workload = t.workloadById[d.profile.reader]!;
  const result = paceDb2Reader(old, reader.intake, reader.freshCpRefSec, reader.freshZiipRefSec,
    cpRefSec, ziipRefSec, oldCpGrant, oldZiipGrant, demand > 0 ? Math.min(1, cappedRefSec / demand) : 0, workload.timeoutSec);
  // Stamp actual commits before the usual WLM and workload accounting consume the same slice results.
  for (let i = start; i < end; i++) {
    const s = slices[i]!;
    const r = results[i]!;
    const period = i - start;
    const carry = reader.carry[period];
    let ageCompletions = 0;
    if (carry && (result.completedOld > 0 || result.aborted > 0)) {
      const paidCp = Math.min(carry.cpRefSec, r.cpGranted * cpScale);
      const paidZiip = Math.min(carry.ziipRefSec, (r.ziipGranted + r.iipcpGranted) * ziipScale);
      ageCompletions = (oldCpGrant + oldZiipGrant > 0)
        ? result.completedOld * (paidCp + paidZiip) / (oldCpGrant + oldZiipGrant) : 0;
      const left = remaining?.[period];
      if (result.aborted > 0 && left) {
        remaining![period] = {
          cpRefSec: Math.max(0, left.cpRefSec - (carry.cpRefSec - paidCp)),
          ziipRefSec: Math.max(0, left.ziipRefSec - (carry.ziipRefSec - paidZiip)),
        };
      }
    }
    r.completions = ageCompletions + (reader.intake.starting > 0 ? result.completedFresh * s.rate * TICK_SEC / reader.intake.starting : 0);
    r.failed = i === end - 1 ? reader.intake.failed + reader.dbatFailed + result.aborted : 0;
    if (ageCompletions > 0) {
      const additionalSec = Math.max(0, (old?.ageSec ?? 0) - r.rtMeanSec) * ageCompletions / r.completions;
      r.rtMeanSec += additionalSec;
      r.userRtSec += additionalSec;
      if (r.parts) r.parts.backlogWait += additionalSec;
    }
    r.withinSla = s.slaRtSec === null ? 0 : r.completions * lognormCdf(s.slaRtSec, r.userRtSec, s.rtSigma);
  }
  if (result.reader.count > 1e-9 || result.reader.pending > 1e-9 || reader.dbatQueued > 1e-9) {
    d.readers[reader.member] = { ...result.reader, dbatQueued: reader.dbatQueued, workByPeriod: remaining ?? NO_PERIOD_WORK };
  }
}
