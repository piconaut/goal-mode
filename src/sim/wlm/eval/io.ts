// I/O service as WLM sees it, and the DP-ordered IOSQ split when I/O priority
// management is on.

import type { IoClass } from '../../io/dasd';
import type { IoService, SliceSpec } from './types';

export const ioUsingSec = (io: IoService) => io.connSec ?? io.rtSec - io.delaySec;

/** WLM I/O priority on the z/OS IOSQ: requests are queued by dispatching priority. Non-preemptive
 * priority M/M/1 split, W_k = W0 / ((1 − σ_{k−1})(1 − σ_k)), renormalised so the I/O-weighted mean
 * IOSQ is unchanged (work is reordered, not removed). APPROX: one queue per I/O class per image.
 * `sliceDp` is each slice's period DP. */
export function iosqByPriority(slices: readonly SliceSpec[], sliceDp: readonly number[], io: Record<IoClass, IoService>): Partial<Record<IoClass, IoService[]>> | null {
  let out: Partial<Record<IoClass, IoService[]>> | null = null;
  const n = slices.length;
  for (const cls of ['RANDOM', 'SEQ'] as const) {
    const svcIo = io[cls];
    const iosq = svcIo.iosqSec ?? 0;
    if (iosq <= 1e-9) continue;
    const rate = new Array<number>(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const s = slices[i]!;
      rate[i] = s.ioClass === cls ? s.rate * s.ioPerTxn + s.ioRate : 0;
      total += rate[i]!;
    }
    if (total <= 0) continue;
    // Distinct DPs with I/O, rate summed in slice order.
    const dps: number[] = [];
    const byDp: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!(rate[i]! > 0)) continue;
      const dp = sliceDp[i]!;
      const j = dps.indexOf(dp);
      if (j < 0) {
        dps.push(dp);
        byDp.push(rate[i]!);
      } else byDp[j] = byDp[j]! + rate[i]!;
    }
    if (dps.length < 2) continue;
    const levels = dps.map((_, j) => j).sort((a, b) => dps[b]! - dps[a]!);
    const svc = Math.max(1e-6, svcIo.rtSec - iosq);
    const rho = Math.min(0.95, iosq / (iosq + svc));
    const w0 = rho * svc;
    const waitByDp = new Array<number>(dps.length);
    let sigma = 0;
    let mean = 0;
    for (const j of levels) {
      const prev = sigma;
      sigma += (rho * byDp[j]!) / total;
      waitByDp[j] = w0 / ((1 - prev) * (1 - sigma));
      mean += (byDp[j]! / total) * waitByDp[j]!;
    }
    const scale = mean > 0 ? iosq / mean : 1;
    // One service object per distinct DP, shared by the slices at that DP (they are only read).
    const byLevel = new Array<IoService | undefined>(dps.length);
    const list = new Array<IoService>(n);
    for (let i = 0; i < n; i++) {
      if (slices[i]!.ioClass !== cls) {
        list[i] = svcIo;
        continue;
      }
      const j = dps.indexOf(sliceDp[i]!);
      if (j < 0) {
        list[i] = svcIo;
        continue;
      }
      let o = byLevel[j];
      if (o === undefined) {
        const w = waitByDp[j]! * scale;
        o = Number.isFinite(w) ? { rtSec: svcIo.rtSec - iosq + w, delaySec: svcIo.delaySec - iosq + w, iosqSec: w, connSec: svcIo.connSec } : svcIo;
        byLevel[j] = o;
      }
      list[i] = o;
    }
    (out ??= {})[cls] = list;
  }
  return out;
}
