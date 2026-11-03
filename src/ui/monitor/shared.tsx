import type { EvidenceMetric } from '../../content/evidence';
import { type Mon3Row } from '../../game/mon3';

export const pct = (f: number) => (f * 100).toFixed(0);
export const n1 = (x: number) => x.toFixed(1);
// DELAY's % Delayed for columns (RMF Report Analysis p.109): PRC covers CPs and zIIPs, each pinnable on its own.
// APPROX: SUB, OPR and ENQ delays are not modelled and show 0; WLM capping has no column (DLY % includes it).
export const DELAY_COLS: { label: string; parts: [keyof Mon3Row['delay'], EvidenceMetric, string][] }[] = [
  { label: 'PRC', parts: [['cpu', 'DELAY_CPU', 'CP'], ['ziip', 'DELAY_ZIIP', 'zIIP']] },
  { label: 'DEV', parts: [['io', 'DELAY_IO', 'DEV']] },
  { label: 'STR', parts: [['stor', 'DELAY_STO', 'STR']] },
  { label: 'SUB', parts: [] },
  { label: 'OPR', parts: [] },
  { label: 'ENQ', parts: [] },
];
// RMF scales anything above 99999 ms with K/M (SYSINFO RESP Time, SYSSUM).
export const ms = (x: number | null) => (x === null ? '-' : x < 100_000 ? x.toFixed(0) : x < 1e8 ? `${(x / 1000).toFixed(0)}K` : `${(x / 1e6).toFixed(0)}M`);
export const sameClass = (rows: Mon3Row[], i: number) => i > 0 && rows[i - 1]!.serviceClass === rows[i]!.serviceClass;
