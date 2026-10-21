// Player and event commands (SPEC §6). Applied at the start of a tick; each returns a new
// state or a validation error. Commands are plain data so runs can be replayed.

import { CF_FAILURE } from '../../content/cf';
import { cfUsedGb, duplexSecondary, failCf, type CfStructureConfig } from '../cf/cf';
import { startTfp, type TfpTerms } from '../cost/mlc';
import { TICK_SEC } from './units';
import { LCU_MAX_DEVICES } from '../io/dasd';
import type { ServiceDefinition } from '../wlm/types';
import type { AddressSpaceDef, WorkloadDef } from '../workload/types';
import type { RoutingPolicy } from '../workload/routing';
import type { PoolType, SimModifiers, SimState, ZosSystemConfig } from './types';

export type Command =
  | { kind: 'ACTIVATE_POLICY'; definition: ServiceDefinition }
  | { kind: 'SET_WEIGHT'; lparId: string; pool: PoolType; weight: number }
  | { kind: 'SET_LOGICAL'; lparId: string; pool: PoolType; logical: number }
  | { kind: 'SET_DEFINED_CAPACITY'; lparId: string; msu: number | null }
  | { kind: 'SET_CAPACITY_GROUP'; groupId: string; limitMsu: number | null; members: string[] }
  | { kind: 'SET_ABSOLUTE_CAP'; lparId: string; engines: number | null }
  | { kind: 'SET_IEAOPT'; lparId: string; changes: Partial<Omit<ZosSystemConfig, 'lparId'>> }
  | { kind: 'SET_RMF_INTERVAL'; minutes: number }
  | { kind: 'SET_CPC_ENGINES'; cpcId: string; pool: PoolType; engines: number }
  | { kind: 'SET_CPC_CAPACITY'; cpcId: string; capacitySetting: 4 | 5 | 6 | 7; generation?: string }
  | { kind: 'SET_CPC_MEMORY'; cpcId: string; memoryGb: number }
  | { kind: 'SET_LPAR_MEMORY'; lparId: string; memoryGb: number }
  | { kind: 'SET_DB2'; ssid: string; bufferPoolGb?: number; maxDbat?: number }
  | { kind: 'SET_CICS'; name: string; maxTasks?: number; qrFrac?: number }
  | { kind: 'ADD_AOR'; lparId: string; name: string; maxTasks: number; qrFrac: number }
  | { kind: 'SET_JOB_CLASS'; jobClass: string; mode?: 'JES' | 'WLM'; initiators?: Record<string, number> }
  | { kind: 'SET_CF'; lparId: string; thinInterrupts?: boolean; degrade?: number }
  | { kind: 'MOVE_STRUCTURE'; name: string; cfLparId: string }
  | { kind: 'FAIL_CF'; lparId: string; failed: boolean }
  | { kind: 'SET_DUPLEX'; name: string; on: boolean }
  | { kind: 'SET_DASD'; changes: Partial<SimState['config']['dasd']> }
  | { kind: 'SET_LCU'; lcuId: string; aliases?: number; hotSkew?: number; extraIops?: Partial<Record<'RANDOM' | 'SEQ', number>> }
  | { kind: 'SET_ROUTING'; workloadId: string; routing: Record<string, number> }
  | { kind: 'SET_ROUTING_POLICY'; workloadId: string; policy: RoutingPolicy }
  | { kind: 'SET_MODIFIER'; mod: keyof Omit<SimModifiers, 'lockBoost'>; key: string; value: number }
  | { kind: 'SET_LOCK_BOOST'; value: number }
  | { kind: 'ADD_WORKLOAD'; workload: WorkloadDef }
  | { kind: 'ADD_ADDRESS_SPACE'; addressSpace: AddressSpaceDef }
  | { kind: 'ABEND_JOB'; critical: boolean }
  | { kind: 'RESTART_JOB'; day: number; name: string }
  | { kind: 'SET_PRICING'; tfp: TfpTerms }
  | { kind: 'SET_MQ'; workloadId: string; maxDepthMsgs: number }
  | { kind: 'NOTE'; text: string };

export interface CommandResult {
  state: SimState;
  ok: boolean;
  message: string;
}

const fail = (state: SimState, message: string): CommandResult => ({ state, ok: false, message });
const ok = (state: SimState, message: string): CommandResult => ({ state, ok: true, message });

function withConfig(s: SimState, f: (c: SimState['config']) => void): SimState {
  const config = structuredClone(s.config);
  f(config);
  return { ...s, config };
}

export function applyCommand(s: SimState, cmd: Command): CommandResult {
  switch (cmd.kind) {
    case 'ACTIVATE_POLICY':
      if (cmd.definition.classes.length === 0) return fail(s, 'Policy has no service classes');
      return ok({ ...s, wlm: { ...s.wlm, definition: structuredClone(cmd.definition) } }, `Policy ${cmd.definition.policyName} activated`);

    case 'SET_WEIGHT': {
      const l = s.config.lpars.find((x) => x.id === cmd.lparId);
      const p = l?.pools.find((x) => x.pool === cmd.pool);
      if (!l || !p) return fail(s, `${cmd.lparId} has no ${cmd.pool} pool`);
      if (p.dedicated) return fail(s, 'Dedicated processors have no weight');
      if (cmd.weight < 1 || cmd.weight > 999) return fail(s, 'Weight must be 1–999');
      return ok(withConfig(s, (c) => (c.lpars.find((x) => x.id === cmd.lparId)!.pools.find((x) => x.pool === cmd.pool)!.weight = Math.round(cmd.weight))), `${cmd.lparId} ${cmd.pool} weight ${cmd.weight}`);
    }

    case 'SET_LOGICAL': {
      const l = s.config.lpars.find((x) => x.id === cmd.lparId);
      if (!l) return fail(s, `No LPAR ${cmd.lparId}`);
      const p = l.pools.find((x) => x.pool === cmd.pool);
      const max = p ? p.logical + p.reserved : 0;
      if (cmd.logical < 0) return fail(s, 'Logical count must be ≥ 0');
      if (p && cmd.logical > max) return fail(s, `Only ${max} logical ${cmd.pool}s defined (online + reserved); more needs an image profile change and IPL`);
      return ok(
        withConfig(s, (c) => {
          const lp = c.lpars.find((x) => x.id === cmd.lparId)!;
          const pc = lp.pools.find((x) => x.pool === cmd.pool);
          if (pc) {
            pc.reserved = pc.logical + pc.reserved - cmd.logical;
            pc.logical = cmd.logical;
          } else {
            lp.pools.push({ pool: cmd.pool, logical: cmd.logical, reserved: 0, weight: lp.pools.find((x) => x.pool === 'CP')?.weight ?? 100, dedicated: false, initialCapping: false, absoluteCapEngines: null });
          }
        }),
        `${cmd.lparId} logical ${cmd.pool}s = ${cmd.logical}`,
      );
    }

    case 'SET_DEFINED_CAPACITY':
      if (!s.config.lpars.some((x) => x.id === cmd.lparId)) return fail(s, `No LPAR ${cmd.lparId}`);
      if (cmd.msu !== null && cmd.msu < 1) return fail(s, 'Defined capacity must be ≥ 1 MSU');
      return ok(withConfig(s, (c) => (c.lpars.find((x) => x.id === cmd.lparId)!.definedCapacityMsu = cmd.msu)), `${cmd.lparId} defined capacity ${cmd.msu ?? 'none'}`);

    case 'SET_CAPACITY_GROUP': {
      // Capacity groups are defined per CPC on the HMC; members on two CPCs can't share one.
      const memberCpcs = new Set(s.config.lpars.filter((l) => cmd.members.includes(l.id)).map((l) => l.cpcId));
      if (cmd.limitMsu !== null && memberCpcs.size > 1) return fail(s, `Capacity group ${cmd.groupId} spans CPCs; a group must stay on one CPC`);
      return ok(
        withConfig(s, (c) => {
          c.capacityGroups = c.capacityGroups.filter((g) => g.id !== cmd.groupId);
          for (const l of c.lpars) if (l.capacityGroup === cmd.groupId) l.capacityGroup = null;
          if (cmd.limitMsu !== null) {
            const cpcId = c.lpars.find((l) => l.id === cmd.members[0])?.cpcId ?? c.cpcs[0]!.id;
            c.capacityGroups.push({ id: cmd.groupId, cpcId, limitMsu: cmd.limitMsu });
            for (const l of c.lpars) if (cmd.members.includes(l.id)) l.capacityGroup = cmd.groupId;
          }
        }),
        `Capacity group ${cmd.groupId} ${cmd.limitMsu ?? 'removed'}`,
      );
    }

    case 'SET_ABSOLUTE_CAP':
      return ok(withConfig(s, (c) => (c.lpars.find((x) => x.id === cmd.lparId)!.pools.find((p) => p.pool === 'CP')!.absoluteCapEngines = cmd.engines)), `${cmd.lparId} absolute cap ${cmd.engines ?? 'none'}`);

    case 'SET_IEAOPT':
      return ok(withConfig(s, (c) => Object.assign(c.systems.find((x) => x.lparId === cmd.lparId)!, cmd.changes)), `SET OPT on ${cmd.lparId}`);

    case 'SET_RMF_INTERVAL':
      if (![5, 10, 15, 20, 30, 60].includes(cmd.minutes)) return fail(s, 'RMF interval must divide an hour (5–60 min)');
      return ok(withConfig(s, (c) => (c.rmfIntervalMin = cmd.minutes)), `RMF interval ${cmd.minutes} min (takes effect at the next interval boundary)`);

    case 'SET_CPC_ENGINES':
      return ok(withConfig(s, (c) => (c.cpcs.find((x) => x.id === cmd.cpcId)!.engines[cmd.pool] = cmd.engines)), `${cmd.cpcId} ${cmd.pool} engines = ${cmd.engines}`);

    case 'SET_CPC_CAPACITY':
      return ok(
        withConfig(s, (c) => {
          const cpc = c.cpcs.find((x) => x.id === cmd.cpcId)!;
          cpc.capacitySetting = cmd.capacitySetting;
          if (cmd.generation) cpc.generation = cmd.generation;
        }),
        `${cmd.cpcId} capacity setting ${cmd.capacitySetting}${cmd.generation ? ` (${cmd.generation})` : ''}`,
      );

    case 'SET_CPC_MEMORY':
      return ok(withConfig(s, (c) => (c.cpcs.find((x) => x.id === cmd.cpcId)!.memoryGb = cmd.memoryGb)), `${cmd.cpcId} memory ${cmd.memoryGb} GB`);

    case 'SET_LPAR_MEMORY': {
      const l = s.config.lpars.find((x) => x.id === cmd.lparId);
      if (!l) return fail(s, `No LPAR ${cmd.lparId}`);
      const cpc = s.config.cpcs.find((c) => c.id === l.cpcId)!;
      const others = s.config.lpars.filter((x) => x.cpcId === cpc.id && x.id !== l.id).reduce((a, x) => a + x.memoryGb, 0);
      if (others + cmd.memoryGb > cpc.memoryGb) return fail(s, `Only ${cpc.memoryGb - others} GB unassigned on ${cpc.id}`);
      return ok(withConfig(s, (c) => (c.lpars.find((x) => x.id === cmd.lparId)!.memoryGb = cmd.memoryGb)), `${cmd.lparId} memory ${cmd.memoryGb} GB`);
    }

    case 'SET_DB2': {
      if (!s.config.db2.some((d) => d.ssid === cmd.ssid)) return fail(s, `No Db2 ${cmd.ssid}`);
      return ok(
        withConfig(s, (c) => {
          const d = c.db2.find((x) => x.ssid === cmd.ssid)!;
          if (cmd.bufferPoolGb !== undefined) d.bufferPoolGb = cmd.bufferPoolGb;
          if (cmd.maxDbat !== undefined) d.maxDbat = cmd.maxDbat;
        }),
        `${cmd.ssid} updated`,
      );
    }

    case 'SET_CICS':
      if (!s.config.cics.some((r) => r.name === cmd.name)) return fail(s, `No CICS region ${cmd.name}`);
      return ok(
        withConfig(s, (c) => {
          const r = c.cics.find((x) => x.name === cmd.name)!;
          if (cmd.maxTasks !== undefined) r.maxTasks = cmd.maxTasks;
          if (cmd.qrFrac !== undefined) r.qrFrac = cmd.qrFrac;
        }),
        `${cmd.name} updated`,
      );

    case 'ADD_AOR': {
      const st = withConfig(s, (c) => c.cics.push({ name: cmd.name, lparId: cmd.lparId, maxTasks: cmd.maxTasks, qrFrac: cmd.qrFrac }));
      const as: AddressSpaceDef = { jobname: cmd.name, lparId: cmd.lparId, role: 'CICS.AOR', subsystem: 'STC', baseEnginesRef: 0.012, ziipFrac: 0 };
      return ok({ ...st, extraAddressSpaces: [...st.extraAddressSpaces, as] }, `${cmd.name} started on ${cmd.lparId}`);
    }

    case 'SET_JOB_CLASS':
      return ok(
        withConfig(s, (c) => {
          let jc = c.jobClasses.find((x) => x.jobClass === cmd.jobClass);
          if (!jc) {
            jc = { jobClass: cmd.jobClass, mode: 'JES', initiators: {} };
            c.jobClasses.push(jc);
          }
          if (cmd.mode) jc.mode = cmd.mode;
          if (cmd.initiators) jc.initiators = { ...cmd.initiators };
        }),
        `Job class ${cmd.jobClass} updated`,
      );

    case 'SET_CF':
      return ok(
        withConfig(s, (c) => {
          const cf = c.cfs.find((x) => x.lparId === cmd.lparId);
          if (!cf) return;
          if (cmd.thinInterrupts !== undefined) cf.thinInterrupts = cmd.thinInterrupts;
          if (cmd.degrade !== undefined) cf.degrade = cmd.degrade;
        }),
        `${cmd.lparId} CF settings updated`,
      );

    case 'MOVE_STRUCTURE': {
      const st = s.config.cfStructures.find((x) => x.name === cmd.name);
      if (!st) return fail(s, `No structure ${cmd.name}`);
      const cf = s.config.cfs.find((x) => x.lparId === cmd.cfLparId);
      if (!cf) return fail(s, `${cmd.cfLparId} is not a coupling facility`);
      if (cf.failed) return fail(s, `${cmd.cfLparId} is down`);
      if (st.cfLparId !== cmd.cfLparId || st.lost) {
        const free = cfFreeGb(s, cmd.cfLparId, cmd.name);
        if ((st.sizeGb ?? 0) > free) return fail(s, `${cmd.cfLparId} has only ${free.toFixed(1)} GB free; ${cmd.name} needs ${st.sizeGb} GB`);
      }
      // SETXCF START,REBUILD: the structure is reallocated in the target CF.
      return ok(
        withConfig(s, (c) => {
          const x = c.cfStructures.find((y) => y.name === cmd.name)!;
          x.cfLparId = cmd.cfLparId;
          x.lost = false;
          if (x.duplexed && x.prefList && duplexSecondaryOf(c, x) === null) x.duplexed = false;
        }),
        `${cmd.name} rebuilt in ${cmd.cfLparId}`,
      );
    }

    case 'SET_DUPLEX': {
      const st = s.config.cfStructures.find((x) => x.name === cmd.name);
      if (!st) return fail(s, `No structure ${cmd.name}`);
      if (st.lost) return fail(s, `${cmd.name} is lost; reallocate it first`);
      if (!cmd.on) return ok(withConfig(s, (c) => void (c.cfStructures.find((y) => y.name === cmd.name)!.duplexed = false)), `${cmd.name} duplexing stopped`);
      const probe = { ...st, duplexed: true };
      const sec = duplexSecondaryOf(s.config, probe);
      if (!sec) return fail(s, `No second CF on ${cmd.name}'s preference list is up`);
      const free = cfFreeGb(s, sec, null);
      if ((st.sizeGb ?? 0) > free) return fail(s, `${sec} has only ${free.toFixed(1)} GB free for the duplex copy (${st.sizeGb} GB)`);
      return ok(withConfig(s, (c) => void (c.cfStructures.find((y) => y.name === cmd.name)!.duplexed = true)), `${cmd.name} duplexed into ${sec}`);
    }

    case 'FAIL_CF': {
      const cf = s.config.cfs.find((x) => x.lparId === cmd.lparId);
      if (!cf) return fail(s, `${cmd.lparId} is not a coupling facility`);
      if (cmd.failed) {
        if (cf.failed) return fail(s, `${cmd.lparId} is already down`);
        const up = s.config.cfs.filter((x) => !x.failed).map((x) => x.lparId);
        const mem = (id: string) => s.config.lpars.find((l) => l.id === id)?.memoryGb ?? 0;
        const r = failCf(s.config.cfStructures, cmd.lparId, up, mem, s.tick, TICK_SEC);
        return ok(
          withConfig(s, (c) => {
            c.cfs.find((x) => x.lparId === cmd.lparId)!.failed = true;
            c.cfStructures = r.structures;
          }),
          `IXC518I ${cmd.lparId} FAILED. ${r.notes.join('; ')}`,
        );
      }
      if (!cf.failed) return fail(s, `${cmd.lparId} is not down`);
      // The CF is back: lost structures are reallocated in it and recover (GRECP/LPL recovery for GBPs).
      const recover = Math.ceil(CF_FAILURE.recoverySec / TICK_SEC);
      const lost = s.config.cfStructures.filter((x) => x.lost).map((x) => x.name);
      return ok(
        withConfig(s, (c) => {
          c.cfs.find((x) => x.lparId === cmd.lparId)!.failed = false;
          for (const x of c.cfStructures)
            if (x.lost) {
              x.lost = false;
              x.cfLparId = cmd.lparId;
              x.rebuildUntilTick = s.tick + recover;
            }
        }),
        `${cmd.lparId} back online${lost.length ? `; reallocated ${lost.join(', ')}` : ''}. Structures rebuilt elsewhere stay there until moved back.`,
      );
    }

    case 'SET_LCU': {
      const lcu = s.config.dasd.lcus.find((x) => x.id === cmd.lcuId);
      if (!lcu) return fail(s, `No LCU ${cmd.lcuId}`);
      if (cmd.aliases !== undefined) {
        const delta = cmd.aliases - lcu.aliases;
        if (cmd.aliases < 0 || !Number.isInteger(cmd.aliases)) return fail(s, 'Alias count must be a whole number ≥ 0');
        if (delta > s.config.dasd.spareAliases) return fail(s, `Only ${s.config.dasd.spareAliases} spare aliases`);
        if (lcu.volumes + cmd.aliases > LCU_MAX_DEVICES) return fail(s, `LCU ${lcu.id} can address ${LCU_MAX_DEVICES - lcu.volumes} aliases at most`);
      }
      return ok(
        withConfig(s, (c) => {
          const l = c.dasd.lcus.find((x) => x.id === cmd.lcuId)!;
          if (cmd.aliases !== undefined) {
            c.dasd.spareAliases -= cmd.aliases - l.aliases;
            l.aliases = cmd.aliases;
          }
          if (cmd.hotSkew !== undefined) l.hotSkew = Math.min(1, Math.max(0.05, cmd.hotSkew));
          if (cmd.extraIops !== undefined) l.extraIops = { ...cmd.extraIops };
        }),
        `LCU ${cmd.lcuId} updated`,
      );
    }

    case 'SET_DASD':
      return ok(withConfig(s, (c) => Object.assign(c.dasd, cmd.changes)), 'DASD configuration updated');

    case 'SET_ROUTING_POLICY': {
      const { [cmd.workloadId]: _old, ...rest } = s.routingPolicies ?? {};
      const policies = cmd.policy.method === 'STATIC' ? rest : { ...rest, [cmd.workloadId]: cmd.policy };
      const p = cmd.policy;
      const label =
        p.method === 'WLM'
          ? `WLM weights${p.ziipAware ? ' (zIIP-aware)' : ''}`
          : p.method === 'CPSM_GOAL'
            ? `CPSM goal${p.abendCritFrac !== null ? ` ABENDCRIT ${Math.round(p.abendCritFrac * 100)}%` : ''}${p.quiesced.length ? `, quiesced ${p.quiesced.join(' ')}` : ''}`
            : 'static weights';
      const { routingPolicies: _drop, ...base } = s;
      return ok(Object.keys(policies).length ? { ...base, routingPolicies: policies } : base, `${cmd.workloadId} routing: ${label}`);
    }

    case 'SET_ROUTING': {
      // Explicit weights mean static routing: a dynamic policy would overwrite them within a minute.
      if (s.routingPolicies?.[cmd.workloadId]) return fail(s, `${cmd.workloadId} routes by ${s.routingPolicies[cmd.workloadId]!.method}; switch it to static weights first`);
      const total = Object.values(cmd.routing).reduce((a, b) => a + b, 0);
      if (total <= 0) return fail(s, 'Routing weights must sum to > 0');
      const norm = Object.fromEntries(Object.entries(cmd.routing).map(([k, v]) => [k, v / total]));
      return ok({ ...s, routing: { ...s.routing, [cmd.workloadId]: norm } }, `${cmd.workloadId} routing updated`);
    }

    case 'SET_MODIFIER': {
      const table = { ...s.mods[cmd.mod] };
      // Fractions are neutral at 0, multipliers at 1.
      if (cmd.value === (cmd.mod === 'regionFailFrac' ? 0 : 1)) delete table[cmd.key];
      else table[cmd.key] = cmd.value;
      return ok({ ...s, mods: { ...s.mods, [cmd.mod]: table } }, `${cmd.mod}[${cmd.key}] = ${cmd.value}`);
    }

    case 'SET_LOCK_BOOST':
      return ok({ ...s, mods: { ...s.mods, lockBoost: cmd.value } }, `lock boost ${cmd.value}`);

    case 'ADD_WORKLOAD':
      if (s.extraWorkloads.some((w) => w.id === cmd.workload.id)) return fail(s, `Workload ${cmd.workload.id} exists`);
      return ok({ ...s, extraWorkloads: [...s.extraWorkloads, cmd.workload], workloads: [...s.workloads, { id: cmd.workload.id, noise: 0, retryRate: 0, lastRtSec: 0 }] }, `Workload ${cmd.workload.id} went live`);

    case 'ADD_ADDRESS_SPACE':
      return ok({ ...s, extraAddressSpaces: [...s.extraAddressSpaces, cmd.addressSpace] }, `${cmd.addressSpace.jobname} started`);

    case 'ABEND_JOB': {
      const jobs = s.batch.jobs.map((j) => ({ ...j }));
      const victim = jobs.find((j) => j.status === 'RUNNING' && j.def.critical === cmd.critical);
      if (!victim) return fail(s, 'No running job to abend');
      victim.status = 'ABENDED';
      return ok({ ...s, batch: { ...s.batch, jobs } }, `${victim.def.name} ABEND S0C7 on ${victim.lparId}`);
    }

    case 'RESTART_JOB': {
      const jobs = s.batch.jobs.map((j) => ({ ...j }));
      const j = jobs.find((x) => x.day === cmd.day && x.def.name === cmd.name && x.status === 'ABENDED');
      if (!j) return fail(s, `${cmd.name} is not abended`);
      j.status = 'QUEUED';
      j.progress = j.progress * 0.5; // restart from the last checkpoint
      j.queuedTick = s.tick;
      return ok({ ...s, batch: { ...s.batch, jobs } }, `${cmd.name} restarted from checkpoint`);
    }

    case 'SET_MQ':
      if (!Number.isInteger(cmd.maxDepthMsgs) || cmd.maxDepthMsgs < 1 || cmd.maxDepthMsgs > 999_999_999) return fail(s, 'MAXDEPTH must be 1–999999999');
      return ok({ ...s, mqMaxDepth: { ...(s.mqMaxDepth ?? {}), [cmd.workloadId]: cmd.maxDepthMsgs } }, `ALTER QLOCAL MAXDEPTH(${cmd.maxDepthMsgs}) for ${cmd.workloadId}`);

    case 'SET_PRICING':
      if (s.cost.tfp) return fail(s, 'Tailored Fit Pricing is already in force');
      return ok({ ...s, cost: startTfp(s.cost, cmd.tfp, s.tick) }, 'Billing switched to Tailored Fit Pricing');

    case 'NOTE':
      return ok(s, cmd.text);
  }
}

/** CF storage left in a CF, optionally ignoring one structure (when moving it). */
function cfFreeGb(s: SimState, cfId: string, ignore: string | null): number {
  const up = s.config.cfs.filter((x) => !x.failed).map((x) => x.lparId);
  const used = cfUsedGb(s.config.cfStructures.filter((x) => x.name !== ignore), up);
  return (s.config.lpars.find((l) => l.id === cfId)?.memoryGb ?? 0) - (used[cfId] ?? 0);
}

const duplexSecondaryOf = (c: SimState['config'], x: CfStructureConfig) =>
  duplexSecondary(
    x,
    c.cfs.filter((y) => !y.failed).map((y) => y.lparId),
  );


export function applyCommands(s: SimState, cmds: readonly Command[]): SimState {
  if (cmds.length === 0) return s;
  let st = s;
  const log: string[] = [];
  for (const c of cmds) {
    const r = applyCommand(st, c);
    st = r.state;
    log.push(`${r.ok ? 'OK ' : 'ERR'} ${r.message}`);
  }
  return { ...st, commandLog: [...st.commandLog, ...log].slice(-50) };
}
