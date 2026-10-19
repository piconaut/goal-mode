// Multi-day engineering projects (SPEC §6): engineer-hours over several days for a permanent
// per-transaction improvement. FICTIONAL sizes and effects, shaped after what such projects
// typically buy in practice.

export type ProjectEffect =
  | { kind: 'EFFICIENCY'; workloads: string[]; factor: number }
  | { kind: 'IO'; workloads: string[]; factor: number }
  | { kind: 'ZIIP_SHIFT'; workloads: string[]; frac: number }
  | { kind: 'CICS_QR'; factor: number };

export interface ProjectDef {
  id: string;
  name: string;
  description: string;
  hours: number;
  /** Most engineer-hours the team can usefully put in per day. */
  maxHoursPerDay: number;
  effects: ProjectEffect[];
  /** Codex entry that explains why it helps. */
  codex?: string;
}

export const PROJECTS: ProjectDef[] = [
  {
    id: 'THREADSAFE',
    name: 'Threadsafe CICS conversion',
    description: 'Make the core banking programs threadsafe so most work leaves the QR TCB: each region’s QR share drops to 40% of today’s.',
    hours: 24,
    maxHoursPerDay: 4,
    effects: [{ kind: 'CICS_QR', factor: 0.4 }],
    codex: 'qr-tcb',
  },
  {
    id: 'ZIIP_JAVA',
    name: 'zIIP-enable the mobile API',
    description: 'Move the z/OS Connect API layer to Java so 25% more of MOBILE’s CPU is zIIP-eligible. Pays off only where zIIPs exist (PROD2 has none).',
    hours: 20,
    maxHoursPerDay: 4,
    effects: [{ kind: 'ZIIP_SHIFT', workloads: ['MOBILE'], frac: 0.25 }],
    codex: 'ziip',
  },
  {
    id: 'DB2_COMPRESSION',
    name: 'Db2 table space compression',
    description: 'Compress the large retail and card table spaces: 25% fewer I/Os per Db2 transaction, at about 3% more CPU for compression.',
    hours: 16,
    maxHoursPerDay: 4,
    effects: [
      { kind: 'IO', workloads: ['RBANK', 'CARDAUTH', 'TELLER', 'PAYMQ', 'MOBILE'], factor: 0.75 },
      { kind: 'EFFICIENCY', workloads: ['RBANK', 'CARDAUTH', 'TELLER', 'PAYMQ', 'MOBILE'], factor: 1.03 },
    ],
  },
  {
    id: 'SQL_TUNING',
    name: 'SQL tuning sprint (retail)',
    description: 'Index and access-path work on the retail and teller packages: about 15% less CPU per transaction.',
    hours: 12,
    maxHoursPerDay: 6,
    effects: [{ kind: 'EFFICIENCY', workloads: ['RBANK', 'TELLER'], factor: 0.85 }],
  },
  {
    id: 'ARCHIVE',
    name: 'Archive old account history',
    description: 'Move seven-year-old history out of the online tables: smaller indexes, about 8% fewer I/Os per transaction for retail, teller and payments.',
    hours: 8,
    maxHoursPerDay: 4,
    effects: [{ kind: 'IO', workloads: ['RBANK', 'TELLER', 'PAYMQ'], factor: 0.92 }],
  },
];

export const projectDef = (id: string): ProjectDef | undefined => PROJECTS.find((p) => p.id === id);
