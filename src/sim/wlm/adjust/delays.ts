import { POLICY_ADJUST } from '../../../content/wlm/tuning';
import { srvDelayCapOf, type ScpState } from '../runtime';
import type { WlmDelayShares } from './trace';

/** A managed delay a receiver's plan can target (CPU, ZIIP) or that it is reported not fixable for (docs/wlm-design.md
 * §5.7). Capping and waits (`delayOther`) are not managed delays and are never a bottleneck. */
export type Bottleneck = 'CPU' | 'ZIIP' | 'IO' | 'STORAGE' | 'QUEUE' | 'NONE';
export type FixableBottleneck = 'CPU' | 'ZIIP';

type DelayAcc = Pick<ScpState['acc'], 'delay' | 'delayCpu' | 'delayZiip' | 'delayIo' | 'delayCap' | 'delayStorage' | 'delayQueue' | 'delayIoNoVel'>;

/**
 * The managed delays of a period (docs/wlm-design.md §5.7; SG24-6472-03, March 2008, PDF p.63–64
 * (printed 45–46): processor, paging and swap, MPL,
 * I/O). I/O is the part in velocity. APPROX: the samples of transaction-server regions are included here (the totals
 * have no per-component server split); the needs-help test (`managedDelayFrac`) leaves them out.
 */
function managedDelays(acc: DelayAcc): Record<Exclude<Bottleneck, 'NONE'>, number> {
  return { CPU: acc.delayCpu, ZIIP: acc.delayZiip, IO: Math.max(0, acc.delayIo - (acc.delayIoNoVel ?? 0)), STORAGE: acc.delayStorage, QUEUE: acc.delayQueue ?? 0 };
}

/** The bottlenecks a receiver's plans are built for, in order: CPU and zIIP by delay, largest first, each kept when it
 * is at least `bottleneckMinFrac` of the managed delay, even when I/O, storage or queue delay is larger (§5.7). */
export function fixableBottlenecks(acc: DelayAcc, tuning: Pick<typeof POLICY_ADJUST, 'bottleneckMinFrac'> = POLICY_ADJUST): FixableBottleneck[] {
  const m = managedDelays(acc);
  const total = m.CPU + m.ZIIP + m.IO + m.STORAGE + m.QUEUE;
  if (!(total > 0)) return [];
  const out: FixableBottleneck[] = [];
  for (const b of ['CPU', 'ZIIP'] as const) if (m[b] > 0 && m[b] >= tuning.bottleneckMinFrac * total) out.push(b);
  return m.ZIIP > m.CPU ? out.reverse() : out;
}

/** The largest managed delay: what a period no plan is built for is reported waiting for. Any positive delay counts,
 * however small: a decayed history can hold a period's whole delay below any fixed floor. */
export function largestManagedDelay(acc: DelayAcc): Bottleneck {
  let best: [Bottleneck, number] = ['NONE', 0];
  for (const [b, v] of Object.entries(managedDelays(acc)) as [Bottleneck, number][]) if (v > best[1]) best = [b, v];
  return best[0];
}

/** Share of a period's samples (using, delay and waits) that are waits (`delayOther`): locks, servers, the CF, the QR
 * TCB. Not a delay state (§5.7); it decides only the wording of the no-action note. */
export function waitingFrac(acc: Pick<ScpState['acc'], 'using' | 'delay' | 'delayOther'>): number {
  const samples = acc.using + acc.delay + acc.delayOther;
  return samples > 0 ? acc.delayOther / samples : 0;
}

/** A period's delay shares (`WlmDelayShares`): each component over `using + delay`. */
export function sharesOf(acc: DelayAcc & Pick<ScpState['acc'], 'using' | 'delayOther'>): WlmDelayShares {
  const denom = acc.using + acc.delay;
  const share = (v: number) => (denom > 0 ? v / denom : 0);
  const m = managedDelays(acc);
  return { CPU: share(m.CPU), ZIIP: share(m.ZIIP), IO: share(m.IO), STORAGE: share(m.STORAGE), QUEUE: share(m.QUEUE), CAP: share(acc.delayCap), OTHER: share(acc.delayOther) };
}

/**
 * The share of a period's samples that are delays WLM manages (docs/wlm-design.md §5.7): CPU, zIIP, I/O in velocity,
 * storage and queue delay. Capping delay is in `delay` but reported, not managed. Waits for locks, servers, the CF or
 * the QR TCB (`delayOther`) are not delay states and are not in `delay` at all (`decayInto`), so nothing is taken off
 * for them. A period with none is not assessed (WLM Services 3.1, PDF p.144 (printed 120): "no delay samples"). The population is the one
 * the period's goal PI is taken from (`goalPi`): velocity samples without those of transaction-server regions, which
 * are managed to the goals of the transactions they serve (WLM Planning 3.1, PDF p.122 (printed 102)).
 */
export function managedDelayFrac(
  acc: Pick<ScpState['acc'], 'using' | 'delay' | 'delayCap' | 'usingIoNoVel' | 'delayIoNoVel' | 'srvUsing' | 'srvDelay' | 'srvDelayCap'>,
): number {
  const srvDelay = acc.srvDelay ?? 0;
  const delay = acc.delay - (acc.delayIoNoVel ?? 0) - srvDelay;
  const samples = acc.using - (acc.usingIoNoVel ?? 0) - (acc.srvUsing ?? 0) + delay;
  if (!(samples > 0)) return 0;
  const cap = acc.delayCap - srvDelayCapOf(acc);
  return Math.max(0, delay - cap) / samples;
}
