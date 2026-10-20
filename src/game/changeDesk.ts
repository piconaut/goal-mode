import type { Command } from '../sim/core/commands';
import type { ConfigView } from './view';

/** Pure helpers behind the Change Desk: validation, "now → new" descriptions and the change basket. */

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 999;

const isInt = (n: number) => Number.isFinite(n) && Math.floor(n) === n;

export function validateWeight(weight: number): string | null {
  if (!isInt(weight) || weight < WEIGHT_MIN || weight > WEIGHT_MAX) return `Weight must be a whole number ${WEIGHT_MIN}–${WEIGHT_MAX}`;
  return null;
}

/** Logical engines can only be configured online up to online + reserved without an IPL. */
export function validateLogical(cfg: ConfigView, lparId: string, pool: 'CP' | 'ZIIP', logical: number): string | null {
  const l = cfg.lpars.find((x) => x.id === lparId);
  if (!l) return `Unknown LPAR ${lparId}`;
  const min = pool === 'CP' ? 1 : 0;
  const max = pool === 'CP' ? l.cpLogical + l.cpReserved : l.ziipLogical + l.ziipReserved;
  if (!isInt(logical) || logical < min) return `Needs a whole number ≥ ${min}`;
  if (logical > max) return `Max ${max} (online + reserved); more needs an image profile change and an IPL`;
  return null;
}

export function validateMemory(cfg: ConfigView, lparId: string, memoryGb: number): string | null {
  const l = cfg.lpars.find((x) => x.id === lparId);
  if (!l) return `Unknown LPAR ${lparId}`;
  if (!Number.isFinite(memoryGb) || memoryGb < 16) return 'At least 16 GB';
  const extra = memoryGb - l.memoryGb;
  if (extra > cfg.unassignedMemoryGb) return `Only ${cfg.unassignedMemoryGb} GB unassigned on the CPC`;
  return null;
}

export function validateDefinedCapacity(msu: number | null): string | null {
  if (msu === null) return null;
  if (!isInt(msu) || msu < 1) return 'Defined capacity must be a whole number ≥ 1 MSU (blank removes it)';
  return null;
}

export function validateRouting(shares: Record<string, number>): string | null {
  const vals = Object.values(shares);
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) return 'Shares must be ≥ 0';
  const sum = vals.reduce((a, v) => a + v, 0);
  if (Math.abs(sum - 1) > 0.005) return `Shares add up to ${(sum * 100).toFixed(0)}%, not 100%`;
  return null;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;
const shares = (r: Record<string, number>) =>
  Object.keys(r)
    .sort()
    .map((k) => `${k} ${pct(r[k]!)}`)
    .join(' / ');

/** One line per command, showing the current value where the config view knows it. */
export function describeCommand(cmd: Command, cfg: ConfigView): string {
  const lpar = 'lparId' in cmd ? cfg.lpars.find((l) => l.id === cmd.lparId) : undefined;
  switch (cmd.kind) {
    case 'SET_WEIGHT':
      return `${cmd.lparId} ${cmd.pool} weight ${lpar?.weight ?? '?'} → ${cmd.weight}`;
    case 'SET_LOGICAL':
      return `${cmd.lparId} logical ${cmd.pool === 'CP' ? 'CPs' : 'zIIPs'} ${cmd.pool === 'CP' ? lpar?.cpLogical : lpar?.ziipLogical} → ${cmd.logical}`;
    case 'SET_DEFINED_CAPACITY':
      return `${cmd.lparId} defined capacity ${lpar?.definedCapacity ?? 'none'} → ${cmd.msu ?? 'none'} MSU`;
    case 'SET_LPAR_MEMORY':
      return `${cmd.lparId} memory ${lpar?.memoryGb ?? '?'} → ${cmd.memoryGb} GB`;
    case 'SET_IEAOPT': {
      const s = cfg.systems.find((x) => x.lparId === cmd.lparId);
      const parts: string[] = [];
      if (cmd.changes.blwlinthdSec !== undefined) parts.push(`BLWLINTHD ${s?.blwlinthdSec ?? '?'} → ${cmd.changes.blwlinthdSec}s`);
      if (cmd.changes.blwltrpctFrac !== undefined) parts.push(`BLWLTRPCT ${s ? pct(s.blwltrpctFrac) : '?'} → ${pct(cmd.changes.blwltrpctFrac)}`);
      if (cmd.changes.iipHonorPriority !== undefined) parts.push(`IIPHONORPRIORITY ${s?.iipHonorPriority ? 'YES' : 'NO'} → ${cmd.changes.iipHonorPriority ? 'YES' : 'NO'}`);
      return `${cmd.lparId} IEAOPT ${parts.join(', ')}`;
    }
    case 'SET_RMF_INTERVAL':
      return `RMF interval ${cfg.rmfIntervalMin} → ${cmd.minutes} min`;
    case 'SET_MQ': {
      const q = cfg.mq.find((x) => x.workloadId === cmd.workloadId);
      return `ALTER QLOCAL(${q?.queue ?? cmd.workloadId}) MAXDEPTH ${q?.maxDepth ?? '?'} → ${cmd.maxDepthMsgs}`;
    }
    case 'SET_DB2': {
      const d = cfg.db2.find((x) => x.ssid === cmd.ssid);
      const parts: string[] = [];
      if (cmd.bufferPoolGb !== undefined) parts.push(`buffer pools ${d?.bufferPoolGb ?? '?'} → ${cmd.bufferPoolGb} GB`);
      if (cmd.maxDbat !== undefined) parts.push(`MAXDBAT ${d?.maxDbat ?? '?'} → ${cmd.maxDbat}`);
      return `${cmd.ssid} ${parts.join(', ')}`;
    }
    case 'SET_CICS': {
      const r = cfg.cics.find((x) => x.name === cmd.name);
      const parts: string[] = [];
      if (cmd.maxTasks !== undefined) parts.push(`MXT ${r?.maxTasks ?? '?'} → ${cmd.maxTasks}`);
      if (cmd.qrFrac !== undefined) parts.push(`QR share ${r ? pct(r.qrFrac) : '?'} → ${pct(cmd.qrFrac)}`);
      return `${cmd.name} ${parts.join(', ')}`;
    }
    case 'ADD_AOR':
      return `New CICS AOR ${cmd.name} on ${cmd.lparId} (MXT ${cmd.maxTasks})`;
    case 'SET_JOB_CLASS': {
      const j = cfg.jobClasses.find((x) => x.jobClass === cmd.jobClass);
      const before = j ? `${j.mode} ${shares1(j.initiators)}` : 'undefined';
      const after = `${cmd.mode ?? j?.mode ?? 'JES'} ${shares1(cmd.initiators ?? j?.initiators ?? {})}`;
      return `Job class ${cmd.jobClass} ${before} → ${after}`;
    }
    case 'SET_CF': {
      const c = cfg.cfs.find((x) => x.lparId === cmd.lparId);
      const parts: string[] = [];
      if (cmd.thinInterrupts !== undefined) parts.push(`thin interrupts ${c?.thinInterrupts ? 'on' : 'off'} → ${cmd.thinInterrupts ? 'on' : 'off'}`);
      return `${cmd.lparId} ${parts.join(', ')}`;
    }
    case 'SET_LCU': {
      const l = cfg.dasd.lcus.find((x) => x.id === cmd.lcuId);
      const parts: string[] = [];
      if (cmd.aliases !== undefined) parts.push(`aliases ${l?.aliases ?? '?'} → ${cmd.aliases}`);
      if (cmd.hotSkew !== undefined) parts.push('rebalance hot data sets');
      if (cmd.extraIops !== undefined) parts.push('utility I/O');
      return `LCU ${cmd.lcuId} ${parts.join(', ')}`;
    }
    case 'MOVE_STRUCTURE': {
      const st = cfg.cfStructures.find((x) => x.name === cmd.name);
      return `Rebuild ${cmd.name} ${st?.cfLparId ?? '?'} → ${cmd.cfLparId}`;
    }
    case 'SET_ROUTING': {
      const r = cfg.routing.find((x) => x.workloadId === cmd.workloadId);
      return `${cmd.workloadId} routing ${r ? shares(r.shares) : '?'} → ${shares(cmd.routing)}`;
    }
    case 'RESTART_JOB':
      return `Restart ${cmd.name}`;
    case 'ACTIVATE_POLICY':
      return `Activate WLM policy ${cmd.definition.policyName}`;
    default:
      return cmd.kind;
  }
}

function shares1(r: Record<string, number>): string {
  return Object.keys(r)
    .sort()
    .map((k) => `${k}:${r[k]}`)
    .join(' ');
}

/** Identity of what a command sets, so a later basket item replaces an earlier one for the same target. */
export function commandTarget(cmd: Command): string {
  switch (cmd.kind) {
    case 'SET_WEIGHT':
    case 'SET_LOGICAL':
      return `${cmd.kind}:${cmd.lparId}:${cmd.pool}`;
    case 'SET_DEFINED_CAPACITY':
    case 'SET_LPAR_MEMORY':
      return `${cmd.kind}:${cmd.lparId}`;
    case 'SET_IEAOPT':
      return `${cmd.kind}:${cmd.lparId}:${Object.keys(cmd.changes).sort().join(',')}`;
    case 'SET_CF':
      return `${cmd.kind}:${cmd.lparId}:${cmd.thinInterrupts !== undefined ? 'thin' : ''}`;
    case 'MOVE_STRUCTURE':
      return `${cmd.kind}:${cmd.name}`;
    case 'SET_LCU':
      return `${cmd.kind}:${cmd.lcuId}:${cmd.aliases !== undefined ? 'aliases' : ''}${cmd.hotSkew !== undefined ? 'skew' : ''}`;
    case 'SET_DB2':
      return `${cmd.kind}:${cmd.ssid}:${cmd.bufferPoolGb !== undefined ? 'bp' : ''}${cmd.maxDbat !== undefined ? 'dbat' : ''}`;
    case 'SET_CICS':
      return `${cmd.kind}:${cmd.name}:${cmd.maxTasks !== undefined ? 'mxt' : ''}${cmd.qrFrac !== undefined ? 'qr' : ''}`;
    case 'SET_JOB_CLASS':
      return `${cmd.kind}:${cmd.jobClass}`;
    case 'SET_ROUTING':
    case 'SET_MQ':
      return `${cmd.kind}:${cmd.workloadId}`;
    case 'SET_RMF_INTERVAL':
      return cmd.kind;
    case 'ADD_AOR':
      return `${cmd.kind}:${cmd.name}`;
    case 'RESTART_JOB':
      return `${cmd.kind}:${cmd.day}:${cmd.name}`;
    default:
      return `${cmd.kind}:${JSON.stringify(cmd)}`;
  }
}

/** Add commands to the basket; a command for a target already in the basket replaces it in place. */
export function addToBasket(basket: readonly Command[], cmds: readonly Command[]): Command[] {
  const out = [...basket];
  for (const c of cmds) {
    const t = commandTarget(c);
    const i = out.findIndex((x) => commandTarget(x) === t);
    if (i >= 0) out[i] = c;
    else out.push(c);
  }
  return out;
}

/** Short label for a submitted basket. */
export function basketLabel(basket: readonly Command[], cfg: ConfigView): string {
  if (basket.length === 1) return describeCommand(basket[0]!, cfg);
  const full = `${basket.length} changes: ${basket.map((c) => describeCommand(c, cfg)).join('; ')}`;
  return full.length > 120 ? `${full.slice(0, 119)}…` : full;
}

/** Next free 8-character region name (CICSAOR5, then CICSAO10…), deterministic; the LPAR doesn't affect it. */
export function nextAorName(existing: readonly string[]): string {
  for (let i = 1; i < 100; i++) {
    const n = i < 10 ? `CICSAOR${i}` : `CICSAO${i}`;
    if (!existing.includes(n)) return n;
  }
  return 'CICSAOXX';
}

/** Spare HyperPAV aliases after the alias changes already staged in the basket (other LCUs only). */
export function spareAfterBasket(cfg: ConfigView, basket: readonly Command[], exceptLcu: string): number {
  let spare = cfg.dasd.spareAliases;
  for (const c of basket) {
    if (c.kind !== 'SET_LCU' || c.aliases === undefined || c.lcuId === exceptLcu) continue;
    const cur = cfg.dasd.lcus.find((l) => l.id === c.lcuId)?.aliases ?? c.aliases;
    spare += cur - c.aliases;
  }
  return spare;
}

/** Commands run in order: release aliases before other LCUs claim them. */
export function orderBasket(cfg: ConfigView, basket: readonly Command[]): Command[] {
  const freed = (c: Command) => (c.kind === 'SET_LCU' && c.aliases !== undefined ? (cfg.dasd.lcus.find((l) => l.id === c.lcuId)?.aliases ?? 0) - c.aliases : 0);
  return [...basket].sort((a, b) => (freed(b) > 0 ? 1 : 0) - (freed(a) > 0 ? 1 : 0));
}
