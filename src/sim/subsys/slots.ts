import { SLOT_QUEUE } from '../../content/subsys';
import { erlangC } from '../zos/erlang';

export interface SlotQueueResult {
  /** Transactions still queued for a slot at the end of the tick. */
  queued: number;
  /** Mean wait for a slot, seconds per transaction. */
  waitSec: number;
  /** Fraction of this tick's arrivals that timed out in the queue. */
  failFrac: number;
}

/**
 * A pool of `limit` task slots (CICS MXT, Db2 MAXDBAT) held for `holdSec` each. Throughput is bounded by
 * limit / holdSec (Little's law); arrivals beyond it queue without bound until they time out. Db2 queues
 * further processing until an active DBAT ends (Db2 13 Installation p.212); a too-low MXT causes excessive
 * queuing delays (CICS Performance p.89). Below saturation the wait is M/M/c (Erlang C).
 */
export function slotQueueStep(prevQueued: number, rate: number, holdSec: number, limit: number, timeoutSec: number, tickSec: number): SlotQueueResult {
  const slots = Math.max(1, Math.floor(limit));
  if (holdSec <= 0) return { queued: 0, waitSec: 0, failFrac: 0 };
  const mu = slots / holdSec;
  let queued = Math.max(0, prevQueued + (rate - mu) * tickSec);
  const a = rate * holdSec;
  let erlangWait = 0;
  if (a < slots && !(slots >= SLOT_QUEUE.erlangSkipMinSlots && a < SLOT_QUEUE.erlangSkipBelowFrac * slots)) {
    erlangWait = (erlangC(slots, a) * holdSec) / (slots - a);
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
  return { queued, waitSec, failFrac };
}
