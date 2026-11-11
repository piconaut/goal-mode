// Lookup plan: configuration-derived lookups the tick stages would otherwise redo with `.find()` and string building
// every tick. Pure and rebuilt from scratch whenever one of its key objects is replaced. Commands never edit config,
// the WLM definition, routing or the run's extra content in place (they clone), so object identity is the whole
// invalidation (tests/sim/plan.test.ts).
//
// Only configuration goes in here. Per-tick state (DPs, backlogs, period states, region state, `skipUntilTick` and
// the like) must stay out: it changes without any key object changing, so a plan would serve it stale.

import { cpSpeed, msuPerCp, suPerCpuSecOf, ziipSpeed } from '../../hw/cpc';
import type { ServiceDefinition } from '../../wlm/types';
import type { AddressSpaceDef, WorkloadDef } from '../../workload/types';
import type { Scenario } from '../scenario';
import type { SliceSpec } from '../../wlm/evaluate';
import type { CfConfig } from '../../cf/cf';
import type { CapacityGroupConfig, CicsRegionConfig, CpcConfig, Db2MemberConfig, JobClassConfig, LparConfig, LparPoolConfig, WorldConfig, ZosSystemConfig } from '../types';
import { cicsRegions } from './helpers';

/** One z/OS image. Everything here is read from `config`, `workloads` or `addressSpaces`. */
export interface ImagePlan {
  lpar: LparConfig;
  /** Position among the z/OS images (config order): `prev.wlm.systems`, `last.lpars` and `t.systems` follow it. */
  zosIdx: number;
  /** Position in `t.lpars`, which PR/SM fills CPC by CPC (config.cpcs order, then config.lpars order); -1 if none. */
  rtIdx: number;
  cpc: CpcConfig;
  /** The image's IEAOPT settings (config.systems), if any. */
  system: ZosSystemConfig | undefined;
  /** First CP and zIIP pool definitions (the same entries `l.pools.find()` returns). */
  cpPool: LparPoolConfig | undefined;
  ziipPool: LparPoolConfig | undefined;
  /** Any zIIP pool with online logical processors. */
  hasZiips: boolean;
  /** A zIIP is defined to the image, online or reserved: RMF reports IIPCP (Init & Tuning p.431, p.434). */
  iipcpReported: boolean;
  db2: Db2MemberConfig | undefined;
  /** CICS regions configured on this image (config.cics order). */
  aors: CicsRegionConfig[];
  cpSpeed: number;
  ziipSpeed: number;
  msuPerCp: number;
  suPerCpuSec: number;
  /** CICS address spaces (any `CICS.` role) on this image. */
  cicsRegionCount: number;
  /** `${workloadId}@${lparId}` per workload id (env and mods records use these keys). */
  wlKey: Record<string, string>;
  /** Task-slot queue keys `${lparId}:MXT` and `${lparId}:DBAT`. */
  mxtKey: string;
  dbatKey: string;
  /**
   * `cicsRegions` for the image, filled on first use (`regionsOf`). It reads only template fields of the image's
   * slices (kind, role, key, jobname, scKey, reportClass), which the plan's keys fix; batch slices carry none of the
   * CICS roles. Per-tick region state (WT-09's server periods' DPs, rates, backlogs) stays out of it. Its `targets`
   * object goes into every tick's `LparTick.cics` (shared, so nothing may mutate it).
   */
  cicsRegions?: ReturnType<typeof cicsRegions>;
}

/** A coupling facility image, with its CF and ICF pool definitions. */
export interface CfImagePlan {
  lpar: LparConfig;
  cf: CfConfig | undefined;
  icf: LparPoolConfig | undefined;
}

export interface LparPlan {
  /** z/OS images in config.lpars order. */
  readonly images: readonly ImagePlan[];
  readonly byLparId: Readonly<Record<string, ImagePlan>>;
  /** z/OS image configs in config order (`images.map((i) => i.lpar)`). */
  readonly zosLpars: readonly LparConfig[];
  /** CF images in config.lpars order. */
  readonly cfImages: readonly CfImagePlan[];
  /** Every LPAR config by id (first one, as `.find()`), and its position in `t.lpars` (PR/SM order). */
  readonly lparById: Readonly<Record<string, LparConfig>>;
  readonly rtIdxOf: Readonly<Record<string, number>>;
  /** CPC config by id. */
  readonly cpcOf: Readonly<Record<string, CpcConfig>>;
  /** CPC site position of each LPAR's CPC, km (0 when unknown). */
  readonly siteKmOf: Readonly<Record<string, number>>;
  /** Images with a Db2 subsystem (a DB2.MSTR address space). */
  readonly db2Lpars: ReadonlySet<string>;
  /** CF structure request share by structure name (first one, as `.find()`). */
  readonly structureShareOf: Readonly<Record<string, number>>;
  /** Job class config by name (first one, as `.find()`), and where its WLM-managed queued jobs count. */
  readonly jobClassOf: Readonly<Record<string, JobClassConfig>>;
  /** WLM mode: first eligible image in name order (initiators > 0). */
  readonly wlmHomeOf: Readonly<Record<string, string | undefined>>;
  /** Capacity group config by id, and its member LPAR configs (config order). */
  readonly groupOf: Readonly<Record<string, CapacityGroupConfig>>;
  readonly groupMembers: Readonly<Record<string, readonly LparConfig[]>>;
}

export function buildLparPlan(config: WorldConfig, workloads: readonly WorkloadDef[], addressSpaces: readonly AddressSpaceDef[]): LparPlan {
  const rtOrder: Record<string, number> = {};
  let n = 0;
  for (const cpc of config.cpcs) for (const l of config.lpars) if (l.cpcId === cpc.id) rtOrder[l.id] = n++;
  const images: ImagePlan[] = [];
  const byLparId: Record<string, ImagePlan> = {};
  for (const l of config.lpars) {
    if (l.kind !== 'ZOS') continue;
    const cpc = config.cpcs.find((c) => c.id === l.cpcId)!;
    const ziipPool = l.pools.find((p) => p.pool === 'ZIIP');
    const wlKey: Record<string, string> = {};
    for (const w of workloads) wlKey[w.id] = `${w.id}@${l.id}`;
    let cicsRegionCount = 0;
    for (const a of addressSpaces) if (a.lparId === l.id && a.role?.startsWith('CICS.')) cicsRegionCount++;
    const image: ImagePlan = {
      lpar: l,
      zosIdx: images.length,
      rtIdx: rtOrder[l.id] ?? -1,
      cpc,
      system: config.systems.find((s) => s.lparId === l.id),
      cpPool: l.pools.find((p) => p.pool === 'CP'),
      ziipPool,
      hasZiips: l.pools.some((p) => p.pool === 'ZIIP' && p.logical > 0),
      iipcpReported: ziipPool !== undefined && ziipPool.logical + ziipPool.reserved > 0,
      db2: config.db2.find((d) => d.lparId === l.id),
      aors: config.cics.filter((c) => c.lparId === l.id),
      cpSpeed: cpSpeed(cpc),
      ziipSpeed: ziipSpeed(cpc),
      msuPerCp: msuPerCp(cpc),
      suPerCpuSec: suPerCpuSecOf(cpc),
      cicsRegionCount,
      wlKey,
      mxtKey: `${l.id}:MXT`,
      dbatKey: `${l.id}:DBAT`,
    };
    images.push(image);
    byLparId[l.id] = image;
  }
  const lparById: Record<string, LparConfig> = {};
  for (const l of config.lpars) lparById[l.id] ??= l;
  // Same construction as step's per-tick record (the last CPC with an id wins).
  const cpcOf: Record<string, CpcConfig> = {};
  for (const c of config.cpcs) cpcOf[c.id] = c;
  const siteKmOf: Record<string, number> = {};
  for (const l of config.lpars) siteKmOf[l.id] ??= cpcOf[l.cpcId]?.siteKm ?? 0;
  const structureShareOf: Record<string, number> = {};
  for (const x of config.cfStructures) structureShareOf[x.name] ??= x.requestShare;
  const jobClassOf: Record<string, JobClassConfig> = {};
  const wlmHomeOf: Record<string, string | undefined> = {};
  for (const jc of config.jobClasses) {
    if (jobClassOf[jc.jobClass]) continue;
    jobClassOf[jc.jobClass] = jc;
    wlmHomeOf[jc.jobClass] = Object.keys(jc.initiators).filter((l) => (jc.initiators[l] ?? 0) > 0).sort()[0];
  }
  const groupOf: Record<string, CapacityGroupConfig> = {};
  const groupMembers: Record<string, LparConfig[]> = {};
  for (const g of config.capacityGroups) {
    groupOf[g.id] ??= g;
    groupMembers[g.id] ??= config.lpars.filter((x) => x.capacityGroup === g.id);
  }
  return {
    images,
    byLparId,
    zosLpars: images.map((i) => i.lpar),
    cfImages: config.lpars.filter((l) => l.kind === 'CF').map((l) => ({ lpar: l, cf: config.cfs.find((c) => c.lparId === l.id), icf: l.pools.find((p) => p.pool === 'ICF') })),
    lparById,
    rtIdxOf: rtOrder,
    cpcOf,
    siteKmOf,
    db2Lpars: new Set(addressSpaces.filter((a) => a.role === 'DB2.MSTR').map((a) => a.lparId)),
    structureShareOf,
    jobClassOf,
    wlmHomeOf,
    groupOf,
    groupMembers,
  };
}

/** The image's CICS region topology (`cicsRegions`), computed once per plan from this tick's slices. */
export function regionsOf(
  img: ImagePlan,
  def: ServiceDefinition,
  slices: readonly SliceSpec[],
  byId: Record<string, WorkloadDef>,
  addressSpaces: readonly AddressSpaceDef[],
): ReturnType<typeof cicsRegions> {
  return (img.cicsRegions ??= cicsRegions(def, slices, byId, addressSpaces, img.lpar.id));
}

/** `arr[i]` when it is the entry `ok` wants (the plan's order holds while config is unchanged), else a search. */
export function atOrFind<T>(arr: readonly T[], i: number, ok: (x: T) => boolean): T | undefined {
  const x = arr[i];
  return x !== undefined && ok(x) ? x : arr.find(ok);
}

interface Node {
  next: WeakMap<object, Node>;
  plan?: LparPlan;
}
const roots = new WeakMap<object, Node>();

/**
 * The plan for this tick's configuration, memoised on the identity of every object it reads. `workloads` and
 * `addressSpaces` are the effective lists (scenario + run additions + routing overrides, see `effectiveWorkloads`),
 * so a routing change or an added workload or region replaces them and with them the plan. `scenario` and `def` are
 * keys too, so plan fields derived from them later stay correct without new invalidation.
 */
export function lparPlan(scenario: Scenario, config: WorldConfig, def: ServiceDefinition, workloads: readonly WorkloadDef[], addressSpaces: readonly AddressSpaceDef[]): LparPlan {
  let node: Node | undefined = roots.get(scenario);
  if (!node) roots.set(scenario, (node = { next: new WeakMap() }));
  for (const k of [config, def, workloads, addressSpaces]) {
    let child: Node | undefined = node.next.get(k);
    if (!child) node.next.set(k, (child = { next: new WeakMap() }));
    node = child;
  }
  return (node.plan ??= buildLparPlan(config, workloads, addressSpaces));
}
