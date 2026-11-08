import type { Mechanism, Trigger } from '../game/types';

// Plain-language RCA vocabulary (SPEC §10): what each mechanism and trigger option means, shown in the
// RCA form. These describe the category, not which answer is right for an incident.

export const MECHANISM_HELP: Record<Mechanism, string> = {
  CPU_CAPACITY:
    'Not enough general-purpose CPU where the work ran: the CPC or the image was full, so more capacity was needed rather than a policy change.',
  CPU_PRIORITY:
    'The policy gave this work too little importance or dispatching priority against the work it shared an image with.',
  CAPPING: 'A cap held the image back from the CPU it wanted: defined capacity, an absolute cap or a soft cap.',
  DEPENDENCY: 'The work waited on a server it depends on, typically a Db2 address space that was slow or starved.',
  LOCK_CONTENTION: 'The work waited on a lock held by other work, typically batch holding Db2 locks during the day.',
  CF_SERVICE: 'Coupling facility requests were slow, so the structure or the link to it was the bottleneck.',
  QR_TCB: 'Non-threadsafe CICS work serialised on a region\'s single QR TCB, so transactions queued inside the region.',
  THREAD_LIMIT: 'Work queued for a thread or task slot before it could start: MXT in CICS, MAXDBAT in Db2, an initiator for batch.',
  ROUTING: 'Work was sent to a target that handled it badly (a failing region, the wrong image or link), not slowed where it ran.',
  IO: 'DASD response was slower than usual, so the work waited on I/O.',
  STORAGE: 'The image was short of storage and paged, so the work waited for storage.',
  JOB_FAILURE: 'Critical work stopped rather than running late: a job abended, for example an S0C7 or a failed Db2 connect.',
};

export const TRIGGER_HELP: Record<Trigger, string> = {
  DEMAND_SURGE: 'More work arrived than usual: a burst, campaign or market event, not a change to the system.',
  ACCESS_PATH_REGRESSION: 'A change made the same work cost more, typically a Db2 access path that regressed after a REBIND.',
  RUNAWAY_WORK: 'One piece of work ran out of control: a loop, a runaway query or a runaway address space.',
  BATCH_OVERLAP: 'Batch and online work collided, for example night batch holding locks or CPU while online work needed them.',
  POLICY: 'The WLM policy as configured caused it: classification, goals, importance, capping or scheduling, not a fault.',
  HARDWARE_FAULT: 'Hardware failed or degraded: an engine, a coupling facility, a link or a DASD volume.',
  NEW_WORKLOAD: 'Newly added work appeared on the system and was not planned for.',
  GROWTH: 'Steady growth in existing work crossed what the system could serve.',
  APPLICATION_ERROR: 'A software defect: a program leaked storage, failed transactions or otherwise misbehaved.',
};
