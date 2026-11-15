// Card footprints (RT-14, docs/rca-design.md §4.4(1)): the shared resource a card loads and where it loads it. A card
// qualifies for an incident when the incident's mechanism is one its resource causes and the hurt work is in its
// direct set (the card's `affects`: the workloads whose own demand or path it changes) or collateral to it (the work's
// hosts, or its servers' hosts, meet the reach). A game rule for attribution; the sim does not read it.

import type { Mechanism } from '../game/types';

export type FootprintResource =
  | 'CP' // general CP demand on the reach's images
  | 'CPC' // a CPC's capacity (a power cap)
  | 'ZIIP' // zIIP-eligible work pushed onto CPs
  | 'CF' // a coupling facility, its links or structures
  | 'DASD' // the DASD subsystem or one LCU
  | 'DB2_LOCKS' // Db2 (IRLM) lock contention
  | 'CICS_QR' // a region's QR TCB
  | 'CICS_STORAGE' // a region's storage, so its task slots
  | 'REGION_FAILURES' // transactions failing in a region
  | 'BATCH_JOBS' // a critical job failing
  | 'NEW_WORK'; // a workload that was not there before

/** Where the resource is loaded. Resolved to images (and, for regions, `JOB@LPAR` entries) while the card runs. */
export type FootprintReach =
  | 'sysplex'
  | 'capacityCpcs' // the CPCs a capacity drop lowered
  | { hostsOf: string[] } // the images these workloads are routed to
  | { jobs: string[] } // the images these address spaces run on
  | { images: string[] }
  | { regions: string[] }; // these CICS regions: collateral when the work's servers include one

const CPU_SIDE: Mechanism[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY'];

/** The mechanisms each resource can cause; a card's `mechanisms` derive from its resource. */
export const RESOURCE_MECHANISMS: Record<FootprintResource, readonly Mechanism[]> = {
  // A CP hog also starves the regions' task dispatching, so MXT queues can grow behind it.
  CP: [...CPU_SIDE, 'THREAD_LIMIT'],
  CPC: CPU_SIDE,
  ZIIP: CPU_SIDE,
  CF: ['CF_SERVICE', 'LOCK_CONTENTION', 'DEPENDENCY', 'CPU_CAPACITY', 'CPU_PRIORITY'],
  DASD: ['IO'],
  DB2_LOCKS: ['LOCK_CONTENTION'],
  CICS_QR: ['QR_TCB', 'THREAD_LIMIT'],
  CICS_STORAGE: ['THREAD_LIMIT'],
  REGION_FAILURES: ['ROUTING'],
  BATCH_JOBS: ['JOB_FAILURE'],
  NEW_WORK: [...CPU_SIDE, 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT', 'ROUTING', 'IO', 'STORAGE'],
};

/** The mechanisms a card causes (none for a card with no footprint: it hurts no work). */
export function cardMechanisms(def: { resource?: FootprintResource }): Mechanism[] | undefined {
  return def.resource ? [...RESOURCE_MECHANISMS[def.resource]] : undefined;
}
