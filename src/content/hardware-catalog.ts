// FICTIONAL hardware price list and lead times (SPEC §5.11.3).

import type { Command } from '../sim/core/commands';
import type { CpcConfig, SimState } from '../sim/core/types';

export interface HardwareItem {
  id: string;
  name: string;
  description: string;
  capex: number;
  opexPerDay: number;
  leadDays: number;
  /** Temporary capacity reverts after this many days (On/Off CoD). */
  durationDays: number | null;
  /** Bought for one CPC (the player picks which; default the first). */
  perCpc?: true;
  /** Why it can't be bought for this CPC (e.g. already at the top setting), or null. */
  unavailable?: (c: Pick<CpcConfig, 'capacitySetting' | 'generation'>) => string | null;
  commands: (s: SimState, cpcId?: string) => Command[];
  revert: (s: SimState, cpcId?: string) => Command[];
}

/** The target CPC of a per-CPC item: the named one, else the first. */
export const cpcFor = (s: SimState, cpcId?: string): CpcConfig => s.config.cpcs.find((c) => c.id === cpcId) ?? s.config.cpcs[0]!;
const cpc = cpcFor;

export const HARDWARE: HardwareItem[] = [
  {
    id: 'COD_CP',
    name: 'On/Off CoD: +1 CP (3 days)',
    description: 'Temporary general CP, active within minutes. Raises MLC if the extra capacity is used at peak.',
    capex: 0,
    opexPerDay: 9_000,
    leadDays: 0,
    perCpc: true,
    durationDays: 3,
    commands: (s, id) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s, id).id, pool: 'CP', engines: cpc(s, id).engines.CP + 1 }],
    revert: (s, id) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s, id).id, pool: 'CP', engines: cpc(s, id).engines.CP - 1 }],
  },
  {
    id: 'PERM_CP',
    name: 'Permanent upgrade: +1 CP',
    description: 'MCU upgrade, one more general CP at the current capacity setting.',
    capex: 380_000,
    opexPerDay: 0,
    leadDays: 4,
    perCpc: true,
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s, id).id, pool: 'CP', engines: cpc(s, id).engines.CP + 1 }],
    revert: () => [],
  },
  {
    id: 'ADD_ZIIP',
    name: 'Add 1 zIIP',
    description: 'Specialty engine at full speed; zIIP MSU do not count toward MLC.',
    capex: 95_000,
    opexPerDay: 0,
    leadDays: 4,
    perCpc: true,
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s, id).id, pool: 'ZIIP', engines: cpc(s, id).engines.ZIIP + 1 }],
    revert: () => [],
  },
  {
    id: 'ADD_ICF',
    name: 'Add 1 ICF',
    description: 'Coupling facility engine (lets CF02 run dedicated).',
    capex: 160_000,
    opexPerDay: 0,
    leadDays: 4,
    perCpc: true,
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s, id).id, pool: 'ICF', engines: cpc(s, id).engines.ICF + 1 }],
    revert: () => [],
  },
  {
    id: 'MEMORY_128',
    name: 'Add 128 GB memory',
    description: 'More real storage on the CPC to assign to LPARs (buffer pools, regions).',
    capex: 70_000,
    opexPerDay: 0,
    leadDays: 3,
    perCpc: true,
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_MEMORY', cpcId: cpc(s, id).id, memoryGb: cpc(s, id).memoryGb + 128 }],
    revert: () => [],
  },
  {
    id: 'CAP_SETTING_UP',
    name: 'Capacity setting +1 (faster CPs)',
    description: 'Raises every general CP one sub-capacity step. Faster engines, more MSU per CP.',
    capex: 650_000,
    opexPerDay: 0,
    leadDays: 3,
    perCpc: true,
    unavailable: (c) => (c.capacitySetting >= 7 ? 'Already at the top capacity setting' : null),
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_CAPACITY', cpcId: cpc(s, id).id, capacitySetting: Math.min(7, cpc(s, id).capacitySetting + 1) as 4 | 5 | 6 | 7 }],
    revert: () => [],
  },
  {
    id: 'NEW_GEN',
    name: 'Next-generation CPC (M2)',
    description: 'Faster engines and better MP scaling. Long lead time; migration over a weekend.',
    capex: 2_600_000,
    opexPerDay: 0,
    leadDays: 18,
    perCpc: true,
    unavailable: (c) => (c.generation === 'M2' ? 'Already the newest generation' : null),
    durationDays: null,
    commands: (s, id) => [{ kind: 'SET_CPC_CAPACITY', cpcId: cpc(s, id).id, capacitySetting: cpc(s, id).capacitySetting, generation: 'M2' }],
    revert: () => [],
  },
  {
    id: 'HYPERPAV_64',
    name: '+64 HyperPAV aliases',
    description: 'More HyperPAV alias devices, defined as spares: assign them to the LCUs that queue (Change Desk › DASD). Each LCU addresses at most 256 devices.',
    capex: 25_000,
    opexPerDay: 0,
    leadDays: 2,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_DASD', changes: { spareAliases: s.config.dasd.spareAliases + 64 } }],
    revert: () => [],
  },
];

// FICTIONAL: moving hot data sets off an LCU's busiest volumes (DFSMS migrate/reallocate) spreads its
// hot spots but takes a storage admin half a day.
export const DASD_REBALANCE = { hours: 4, skewFactor: 0.7, minSkew: 0.15 };
