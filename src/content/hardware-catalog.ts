// FICTIONAL hardware price list and lead times (SPEC §5.11.3).

import type { Command } from '../sim/core/commands';
import type { SimState } from '../sim/core/types';

export interface HardwareItem {
  id: string;
  name: string;
  description: string;
  capex: number;
  opexPerDay: number;
  leadDays: number;
  /** Temporary capacity reverts after this many days (On/Off CoD). */
  durationDays: number | null;
  commands: (s: SimState) => Command[];
  revert: (s: SimState) => Command[];
}

const cpc = (s: SimState) => s.config.cpcs[0]!;

export const HARDWARE: HardwareItem[] = [
  {
    id: 'COD_CP',
    name: 'On/Off CoD: +1 CP (3 days)',
    description: 'Temporary general CP, active within minutes. Raises MLC if the extra capacity is used at peak.',
    capex: 0,
    opexPerDay: 9_000,
    leadDays: 0,
    durationDays: 3,
    commands: (s) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s).id, pool: 'CP', engines: cpc(s).engines.CP + 1 }],
    revert: (s) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s).id, pool: 'CP', engines: cpc(s).engines.CP - 1 }],
  },
  {
    id: 'PERM_CP',
    name: 'Permanent upgrade: +1 CP',
    description: 'MCU upgrade, one more general CP at the current capacity setting.',
    capex: 380_000,
    opexPerDay: 0,
    leadDays: 4,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s).id, pool: 'CP', engines: cpc(s).engines.CP + 1 }],
    revert: () => [],
  },
  {
    id: 'ADD_ZIIP',
    name: 'Add 1 zIIP',
    description: 'Specialty engine at full speed; zIIP MSU do not count toward MLC.',
    capex: 95_000,
    opexPerDay: 0,
    leadDays: 4,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s).id, pool: 'ZIIP', engines: cpc(s).engines.ZIIP + 1 }],
    revert: () => [],
  },
  {
    id: 'ADD_ICF',
    name: 'Add 1 ICF',
    description: 'Coupling facility engine (lets CF02 run dedicated).',
    capex: 160_000,
    opexPerDay: 0,
    leadDays: 4,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_ENGINES', cpcId: cpc(s).id, pool: 'ICF', engines: cpc(s).engines.ICF + 1 }],
    revert: () => [],
  },
  {
    id: 'MEMORY_128',
    name: 'Add 128 GB memory',
    description: 'More real storage on the CPC to assign to LPARs (buffer pools, regions).',
    capex: 70_000,
    opexPerDay: 0,
    leadDays: 3,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_MEMORY', cpcId: cpc(s).id, memoryGb: cpc(s).memoryGb + 128 }],
    revert: () => [],
  },
  {
    id: 'CAP_SETTING_UP',
    name: 'Capacity setting +1 (faster CPs)',
    description: 'Raises every general CP one sub-capacity step. Faster engines, more MSU per CP.',
    capex: 650_000,
    opexPerDay: 0,
    leadDays: 3,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_CAPACITY', cpcId: cpc(s).id, capacitySetting: Math.min(7, cpc(s).capacitySetting + 1) as 4 | 5 | 6 | 7 }],
    revert: () => [],
  },
  {
    id: 'NEW_GEN',
    name: 'Next-generation CPC (M2)',
    description: 'Faster engines and better MP scaling. Long lead time; migration over a weekend.',
    capex: 2_600_000,
    opexPerDay: 0,
    leadDays: 18,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_CPC_CAPACITY', cpcId: cpc(s).id, capacitySetting: cpc(s).capacitySetting, generation: 'M2' }],
    revert: () => [],
  },
  {
    id: 'HYPERPAV_64',
    name: '+64 HyperPAV aliases',
    description: 'More alias devices for the DASD subsystem; reduces IOSQ on hot volumes.',
    capex: 25_000,
    opexPerDay: 0,
    leadDays: 2,
    durationDays: null,
    commands: (s) => [{ kind: 'SET_DASD', changes: { aliasPool: s.config.dasd.aliasPool + 64 } }],
    revert: () => [],
  },
];
