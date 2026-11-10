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
import type { CicsRegionConfig, CpcConfig, Db2MemberConfig, LparConfig, LparPoolConfig, WorldConfig, ZosSystemConfig } from '../types';

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
}

export interface LparPlan {
  /** z/OS images in config.lpars order. */
  images: ImagePlan[];
  byLparId: Record<string, ImagePlan>;
}

function buildPlan(config: WorldConfig, workloads: readonly WorkloadDef[], addressSpaces: readonly AddressSpaceDef[]): LparPlan {
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
  return { images, byLparId };
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
  return (node.plan ??= buildPlan(config, workloads, addressSpaces));
}
