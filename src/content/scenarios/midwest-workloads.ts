// FICTIONAL: Midwest Mutual business workloads and address spaces (SPEC §5.2).
// Rates and CPU costs are tuned so day 1 peaks at roughly 75–85% of the CPC.

import type { AddressSpaceDef, ArrivalShape, WorkloadDef } from '../../sim/workload/types';

const WEEKDAY: ArrivalShape['weekly'] = [1, 1, 1, 1, 1.05, 0.45, 0.35];
const ALLWEEK: ArrivalShape['weekly'] = [1, 1, 1, 1, 1.05, 0.9, 0.85];

export const db2Servers = (dbm1Ms: number) => [
  { role: 'TCPIP', cpuMsRef: 0.02, latencySec: 0.0005 },
  { role: 'DB2.DBM1', cpuMsRef: dbm1Ms, latencySec: 0.012 },
  { role: 'DB2.MSTR', cpuMsRef: 0.03, latencySec: 0.006 },
  { role: 'DB2.IRLM', cpuMsRef: 0.02, latencySec: 0.004 },
];
export const cicsServers = (dbm1Ms: number) => [{ role: 'CICS.TOR', cpuMsRef: 0.05, latencySec: 0.002 }, ...db2Servers(dbm1Ms)];

export const MIDWEST_WORKLOADS: WorkloadDef[] = [
  {
    id: 'RBANK',
    name: 'Retail banking',
    stakeholder: 'Retail',
    subsystem: 'CICS',
    work: { subsystem: 'CICS', TN: 'RB01' },
    peakRatePerSec: 600,
    shape: { floor: 0.06, peaks: [{ hour: 10.5, height: 1, widthHours: 1.6 }, { hour: 14, height: 0.9, widthHours: 1.8 }, { hour: 19.5, height: 0.45, widthHours: 1.5 }], weekly: WEEKDAY, payday: 1.25, monthEnd: 1.1 },
    growthPerDay: 0.003,
    noiseSigma: 0.06,
    noisePhi: 0.97,
    routing: { PROD1: 0.55, PROD2: 0.45 },
    cpuMsRef: 1.1,
    cpuSigma: 0.5,
    ziipFrac: 0,
    ioPerTxn: 5,
    baseLatencySec: 0.04,
    rtSigma: 0.55,
    timeoutSec: 10,
    retryFrac: 0.5,
    servers: cicsServers(0.12),
    sla: { kind: 'PCT', pct: 95, rtSec: 0.25 },
  },
  {
    id: 'CARDAUTH',
    name: 'Card authorisation',
    stakeholder: 'Cards',
    subsystem: 'CICS',
    work: { subsystem: 'CICS', TN: 'AUTH' },
    peakRatePerSec: 600,
    shape: { floor: 0.12, peaks: [{ hour: 12.5, height: 0.75, widthHours: 2.2 }, { hour: 18.5, height: 1, widthHours: 2 }], weekly: ALLWEEK, payday: 1.15, monthEnd: 1.05 },
    growthPerDay: 0.004,
    noiseSigma: 0.07,
    noisePhi: 0.97,
    routing: { PROD1: 0.5, PROD2: 0.5 },
    cpuMsRef: 0.8,
    cpuSigma: 0.4,
    ziipFrac: 0,
    ioPerTxn: 2,
    baseLatencySec: 0.012,
    rtSigma: 0.45,
    timeoutSec: 2,
    retryFrac: 0.8,
    servers: cicsServers(0.08),
    sla: { kind: 'PCT', pct: 99, rtSec: 0.1 },
  },
  {
    id: 'MOBILE',
    name: 'Mobile API',
    stakeholder: 'Digital',
    subsystem: 'DDF',
    work: { subsystem: 'DDF', UI: 'MOBAPI', CI: 'ZCONNECT', PK: 'MOBPKG' },
    peakRatePerSec: 300,
    shape: { floor: 0.05, peaks: [{ hour: 12.5, height: 1, widthHours: 1.4 }, { hour: 20.5, height: 0.95, widthHours: 1.8 }, { hour: 8, height: 0.55, widthHours: 1.2 }], weekly: ALLWEEK, payday: 1.3, monthEnd: 1.05 },
    growthPerDay: 0.015,
    noiseSigma: 0.1,
    noisePhi: 0.96,
    // DDF is routed mostly to PROD2, which has no zIIPs (flaw F7).
    routing: { PROD1: 0.4, PROD2: 0.6 },
    cpuMsRef: 2.4,
    cpuSigma: 0.9,
    ziipFrac: 0.55,
    ioPerTxn: 4,
    baseLatencySec: 0.06,
    rtSigma: 0.6,
    timeoutSec: 15,
    retryFrac: 0.6,
    servers: [{ role: 'DB2.DIST', cpuMsRef: 0.06, latencySec: 0.004 }, ...db2Servers(0.15)],
    sla: { kind: 'PCT', pct: 95, rtSec: 0.4 },
  },
  {
    id: 'TELLER',
    name: 'Branch teller',
    stakeholder: 'Retail',
    subsystem: 'CICS',
    work: { subsystem: 'CICS', TN: 'TL10' },
    peakRatePerSec: 200,
    shape: { floor: 0.0, peaks: [{ hour: 10.5, height: 1, widthHours: 2.2 }, { hour: 14.5, height: 0.9, widthHours: 2 }], weekly: [1, 1, 1, 1, 1.1, 0.3, 0], payday: 1.2, monthEnd: 1.0 },
    growthPerDay: 0,
    noiseSigma: 0.05,
    noisePhi: 0.97,
    routing: { PROD1: 0.5, PROD2: 0.5 },
    cpuMsRef: 1.8,
    cpuSigma: 0.5,
    ziipFrac: 0,
    ioPerTxn: 6,
    baseLatencySec: 0.08,
    rtSigma: 0.5,
    timeoutSec: 30,
    retryFrac: 0.2,
    servers: cicsServers(0.12),
    sla: { kind: 'PCT', pct: 90, rtSec: 0.5 },
  },
  {
    id: 'PAYMQ',
    name: 'Payments (MQ)',
    stakeholder: 'Payments',
    subsystem: 'CICS',
    work: { subsystem: 'CICS', TN: 'PMQ1' },
    peakRatePerSec: 120,
    shape: { floor: 0.08, peaks: [{ hour: 9, height: 0.8, widthHours: 1 }, { hour: 13, height: 1, widthHours: 1.5 }, { hour: 17, height: 0.9, widthHours: 1 }], weekly: WEEKDAY, payday: 1.6, monthEnd: 1.3 },
    growthPerDay: 0.006,
    noiseSigma: 0.15,
    noisePhi: 0.9,
    routing: { PROD1: 0.5, PROD2: 0.5 },
    cpuMsRef: 3.0,
    cpuSigma: 0.5,
    ziipFrac: 0.1,
    ioPerTxn: 8,
    baseLatencySec: 0.15,
    rtSigma: 0.5,
    timeoutSec: 60,
    retryFrac: 1.0,
    // FICTIONAL: queue sized for ~10 minutes of peak traffic per queue manager.
    mq: { queue: 'PAY.REQUEST', maxDepthMsgs: 40_000, msgBytes: 6_000 },
    servers: [{ role: 'MQ.CHIN', cpuMsRef: 0.3, latencySec: 0.01 }, { role: 'MQ.MSTR', cpuMsRef: 0.2, latencySec: 0.01 }, ...cicsServers(0.15)],
    sla: { kind: 'AVG', rtSec: 1 },
  },
  {
    id: 'ADHOC',
    name: 'BI ad-hoc queries',
    stakeholder: 'Internal',
    subsystem: 'DDF',
    work: { subsystem: 'DDF', UI: 'BIUSER', CI: 'QMFBI' },
    peakRatePerSec: 0.3,
    shape: { floor: 0.02, peaks: [{ hour: 10.5, height: 1, widthHours: 2 }, { hour: 15, height: 1, widthHours: 2 }], weekly: [1, 1, 1, 1, 0.9, 0.1, 0.05], payday: 1, monthEnd: 1.4 },
    growthPerDay: 0.005,
    noiseSigma: 0.25,
    noisePhi: 0.9,
    routing: { PROD2: 1 },
    cpuMsRef: 900,
    cpuSigma: 1.4,
    ziipFrac: 0.6,
    ioPerTxn: 2000,
    baseLatencySec: 0.5,
    rtSigma: 1.2,
    timeoutSec: 3600,
    retryFrac: 0,
    servers: [{ role: 'DB2.DIST', cpuMsRef: 1, latencySec: 0.01 }, ...db2Servers(20)],
    sla: { kind: 'NONE' },
  },
  {
    id: 'TSO',
    name: 'TSO/ISPF developers',
    stakeholder: 'Internal',
    subsystem: 'TSO',
    work: { subsystem: 'TSO', UI: 'DEV001' },
    peakRatePerSec: 30,
    shape: { floor: 0.0, peaks: [{ hour: 10, height: 1, widthHours: 1.8 }, { hour: 15, height: 1, widthHours: 2 }], weekly: [1, 1, 1, 1, 0.9, 0.05, 0], payday: 1, monthEnd: 1 },
    growthPerDay: 0,
    noiseSigma: 0.1,
    noisePhi: 0.95,
    routing: { DEVT: 0.85, PROD1: 0.08, PROD2: 0.07 },
    cpuMsRef: 4,
    cpuSigma: 1.3,
    ziipFrac: 0,
    ioPerTxn: 10,
    baseLatencySec: 0.05,
    rtSigma: 0.8,
    timeoutSec: 600,
    thinkTimeSec: 20,
    retryFrac: 0,
    servers: [],
    sla: { kind: 'NONE' },
  },
];

export const as = (lparId: string, jobname: string, role: string | null, baseEnginesRef: number, ziipFrac = 0): AddressSpaceDef => ({
  jobname,
  lparId,
  role,
  subsystem: 'STC',
  baseEnginesRef,
  ziipFrac,
});

export function zosBase(lparId: string, scale: number): AddressSpaceDef[] {
  return [
    as(lparId, '*MASTER*', null, 0.01 * scale),
    as(lparId, 'XCFAS', null, 0.02 * scale),
    as(lparId, 'GRS', null, 0.008 * scale),
    as(lparId, 'CATALOG', null, 0.006 * scale),
    as(lparId, 'SMF', null, 0.006 * scale),
    as(lparId, 'JES2', 'JES2', 0.012 * scale),
    as(lparId, 'VTAM', 'VTAM', 0.008 * scale),
    as(lparId, 'TCPIP', 'TCPIP', 0.015 * scale),
    as(lparId, 'RRS', 'RRS', 0.004 * scale),
    as(lparId, 'RMFGAT', null, 0.01 * scale),
    as(lparId, 'MONAGENT', null, 0.03 * scale),
  ];
}

export function db2(lparId: string, ssid: string): AddressSpaceDef[] {
  return [
    as(lparId, `${ssid}MSTR`, 'DB2.MSTR', 0.012),
    as(lparId, `${ssid}DBM1`, 'DB2.DBM1', 0.03, 0.3),
    as(lparId, `${ssid}DIST`, 'DB2.DIST', 0.004, 0.5),
    as(lparId, `${ssid}IRLM`, 'DB2.IRLM', 0.006),
  ];
}

export function cics(lparId: string, tor: string, aors: string[]): AddressSpaceDef[] {
  return [as(lparId, `CICSTOR${tor}`, 'CICS.TOR', 0.01), ...aors.map((n) => as(lparId, `CICSAOR${n}`, 'CICS.AOR', 0.012))];
}

export function mq(lparId: string, qm: string): AddressSpaceDef[] {
  return [as(lparId, `${qm}MSTR`, 'MQ.MSTR', 0.006), as(lparId, `${qm}CHIN`, 'MQ.CHIN', 0.008)];
}

export const MIDWEST_ADDRESS_SPACES: AddressSpaceDef[] = [
  ...zosBase('PROD1', 1),
  ...db2('PROD1', 'DB1A'),
  ...cics('PROD1', '1', ['1', '3']),
  ...mq('PROD1', 'MQ1A'),
  ...zosBase('PROD2', 1),
  ...db2('PROD2', 'DB1B'),
  ...cics('PROD2', '2', ['2', '4']),
  ...mq('PROD2', 'MQ1B'),
  ...zosBase('DEVT', 0.6),
  ...db2('DEVT', 'DB1T'),
  ...zosBase('SYSP', 0.4),
];
