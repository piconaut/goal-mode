import { SLOT_QUEUE } from '../../content/subsys';
import { erlangC } from '../zos/erlang';

export interface SlotQueueResult {
  /** Transactions still queued for a slot at the end of the tick. */
  queued: number;
  /** Mean wait for a slot, seconds per transaction. */
  waitSec: number;
  /** Fraction of this tick's arrivals that timed out in the queue. */
  failFrac: number;
  /** Arrivals this tick that had to wait for a slot (count). Cumulative over the hour, this is the QUEDBAT figure:
   *  the number of work items that waited for a DBAT (Db2 13 Command Reference p.303). */
  waited: number;
}

/**
 * A pool of `limit` task slots (CICS MXT, Db2 MAXDBAT) held for `holdSec` each. Throughput is bounded by
 * limit / holdSec (Little's law); arrivals beyond it queue without bound until they time out. Db2 queues
 * further processing until an active DBAT ends (Db2 13 Installation p.212); a too-low MXT causes excessive
 * queuing delays (CICS Performance p.89). Below saturation the wait is M/M/c (Erlang C).
 */
export function slotQueueStep(prevQueued: number, rate: number, holdSec: number, limit: number, timeoutSec: number, tickSec: number): SlotQueueResult {
  const slots = Math.max(1, Math.floor(limit));
  if (holdSec <= 0) return { queued: 0, waitSec: 0, failFrac: 0, waited: 0 };
  const mu = slots / holdSec;
  const arrivals = rate * tickSec;
  let queued = Math.max(0, prevQueued + (rate - mu) * tickSec);
  const a = rate * holdSec;
  let erlangWait = 0;
  let waitProb = 0;
  if (a < slots && !(slots >= SLOT_QUEUE.erlangSkipMinSlots && a < SLOT_QUEUE.erlangSkipBelowFrac * slots)) {
    const c = erlangC(slots, a);
    erlangWait = (c * holdSec) / (slots - a);
    waitProb = c;
  }
  let waitSec = erlangWait + queued / mu;
  let failFrac = 0;
  if (waitSec > timeoutSec) {
    const keep = Math.max(0, (timeoutSec - erlangWait) * mu);
    const failed = queued - keep;
    queued = keep;
    waitSec = timeoutSec;
    failFrac = rate > 0 ? Math.min(1, failed / (rate * tickSec)) : 0;
  }
  // Count the arrivals that waited: with a backlog or a saturated pool every arrival waits; below saturation it is
  // the Erlang-C wait probability (mirroring the skip above, where no wait is modelled).
  const waited = arrivals * (prevQueued > 1e-9 || a >= slots ? 1 : waitProb);
  return { queued, waitSec, failFrac, waited };
}
