// Postprocessor-style text renderers for RMF interval records. Layouts evoke the real
// WLMGL / CPU Activity / Partition Data / CF / DASD reports without copying them exactly.

import type { ProductDef } from '../../content/pricing';
import { billLines, type CostState } from '../cost/mlc';
import { clockAt } from '../core/clock';
import { BUCKET_BOUNDS } from '../wlm/goals';
import type { RmfInterval, WlmRecord } from './rmf';

const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
const f = (x: number | null | undefined, d = 1, n = 6) => pad(x === null || x === undefined ? '-' : x.toFixed(d), n);

function stamp(tick: number): string {
  const c = clockAt(tick);
  const h = Math.floor(c.hourOfDay);
  const m = Math.round((c.hourOfDay - h) * 60);
  return `DAY ${String(c.day + 1).padStart(2, '0')}  TIME ${String(h).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}.00`;
}

function header(title: string, iv: RmfInterval): string[] {
  const mins = Math.floor(iv.intervalSec / 60);
  return [
    ''.padEnd(30) + title.split('').join(' '),
    `z/OS V3R1        SYSPLEX PLEXP1     ${stamp(iv.startTick)}   INTERVAL ${String(mins).padStart(2, '0')}.00.000   MODE = GOAL`,
    `                 RPT VERSION V3R1 RMF   POLICY=${iv.policy}`,
    '',
  ];
}

const rtText = (r: WlmRecord) => (r.avgRtSec === null ? '      -' : pad(r.avgRtSec < 10 ? r.avgRtSec.toFixed(3) : r.avgRtSec.toFixed(1), 7));

function wlmRow(r: WlmRecord): string {
  return [
    padR(r.serviceClass, 9),
    `${pad(r.reportClass ? '-' : r.period, 3)} ${pad(r.importance ?? '-', 3)}`,
    ' ',
    padR(r.goalText, 24),
    rtText(r),
    f(r.execVelocity, 1, 7),
    f(r.pi, 2, 6),
    pad(Math.round(r.ended), 9),
    f(r.endPerSec, 1, 9),
    f(r.applCpPct, 1, 6),
    f(r.applIipcpPct, 1, 6),
    f(r.applIipPct, 1, 6),
    f(r.usingPct.cpu, 0, 5),
    f(r.usingPct.ziip, 0, 4),
    f(r.usingPct.io, 0, 4),
    f(r.delayPct.cpu, 0, 5),
    f(r.delayPct.ziip, 0, 4),
    f(r.delayPct.io, 0, 4),
    f(r.delayPct.storage, 0, 4),
    f(r.delayPct.cap, 0, 4),
    f(r.delayPct.other, 0, 4),
  ].join(' ');
}

export function renderWlmSummary(iv: RmfInterval, system = '*PLEX'): string {
  const rows = iv.wlm
    .filter((r) => r.lparId === system)
    .sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0) || a.scKey.localeCompare(b.scKey));
  const out = header('WORKLOAD ACTIVITY', iv);
  out.push(`REPORT BY: SYSTEM=${system}   (SERVICE CLASS PERIODS)`);
  out.push('');
  out.push('SERVICE   PER IMP  GOAL                      ACTUAL   EX    PERF   ENDED     END/S  --APPL %--------  ---USING %---  --------DELAY %---------');
  out.push('CLASS                                        RESP    VEL%   INDX                    CP  IIPCP   IIP  CPU  IIP  I/O  CPU  IIP  I/O  STO  CAP  OTH');
  for (const r of rows) out.push(wlmRow(r));
  const rcRows = (iv.wlmRc ?? []).filter((r) => r.lparId === system).sort((a, b) => a.scKey.localeCompare(b.scKey));
  if (rcRows.length > 0) {
    out.push('', `REPORT BY: SYSTEM=${system}   (REPORT CLASSES; GOAL AND PI ONLY FOR HOMOGENEOUS CLASSES)`, '');
    out.push('REPORT    PER IMP  GOAL                      ACTUAL   EX    PERF   ENDED     END/S  --APPL %--------  ---USING %---  --------DELAY %---------');
    out.push('CLASS                                        RESP    VEL%   INDX                    CP  IIPCP   IIP  CPU  IIP  I/O  CPU  IIP  I/O  STO  CAP  OTH');
    for (const r of rcRows) out.push(wlmRow(r));
    out.push('', 'SERVICE CLASS PERIODS PER REPORT CLASS');
    for (const r of rcRows) out.push(`${padR(r.serviceClass, 9)} ${(r.members ?? []).join(', ')}`);
  }
  return out.join('\n');
}

export function renderWlmDetail(iv: RmfInterval, scKey: string, system = '*PLEX'): string {
  const r = iv.wlm.find((x) => x.lparId === system && x.scKey === scKey) ?? iv.wlmRc?.find((x) => x.lparId === system && x.scKey === scKey);
  const out = header('WORKLOAD ACTIVITY', iv);
  if (!r) return [...out, `NO DATA FOR ${scKey} ON ${system}`].join('\n');
  out.push(
    r.reportClass
      ? `REPORT BY: REPORT CLASS=${r.serviceClass}  SERVICE CLASS PERIODS=${(r.members ?? []).join(',')}  SYSTEM=${system}`
      : `REPORT BY: SERVICE CLASS=${r.serviceClass}  PERIOD=${r.period}  IMPORTANCE=${r.importance ?? '-'}  SYSTEM=${system}`,
  );
  out.push(`GOAL: ${r.goalText}`);
  out.push('');
  out.push(`-TRANSACTIONS-   ENDED ${Math.round(r.ended)}   END/S ${r.endPerSec.toFixed(2)}   FAILED ${Math.round(r.failed)}`);
  out.push(`ACTUAL RESP ${r.avgRtSec === null ? '-' : r.avgRtSec.toFixed(4) + 's'}   EX VEL% ${f(r.execVelocity, 1, 0)}   PERF INDX ${f(r.pi, 2, 0)}`);
  out.push(`APPL% CP ${r.applCpPct.toFixed(1)}  IIPCP ${r.applIipcpPct.toFixed(1)}  IIP ${r.applIipPct.toFixed(1)}`);
  out.push(
    `USING% CPU ${r.usingPct.cpu.toFixed(1)} IIP ${r.usingPct.ziip.toFixed(1)} I/O ${r.usingPct.io.toFixed(1)}   ` +
      `DELAY% CPU ${r.delayPct.cpu.toFixed(1)} IIP ${r.delayPct.ziip.toFixed(1)} I/O ${r.delayPct.io.toFixed(1)} STO ${r.delayPct.storage.toFixed(1)} CAP ${r.delayPct.cap.toFixed(1)} UNK ${r.delayPct.other.toFixed(1)}`,
  );
  const total = r.buckets.reduce((a, b) => a + b, 0);
  if (total > 0 && r.goalText.includes('<')) {
    const goalSec = Number(/< ([\d.]+)s/.exec(r.goalText)?.[1] ?? 0);
    out.push('');
    out.push('            ----------RESPONSE TIME DISTRIBUTION----------');
    out.push('  ----TIME----    --NUMBER OF TRANSACTIONS--   -------PERCENT-------  0    20   40   60   80  100');
    out.push('  HH.MM.SS.TTT     CUM TOTAL     IN BUCKET      CUM TOTAL  IN BUCKET  |....|....|....|....|....|');
    let cum = 0;
    r.buckets.forEach((b, i) => {
      cum += b;
      const bound = BUCKET_BOUNDS[i]!;
      const label = bound === Infinity ? `> ${hms(4 * goalSec)}` : `${i === 0 ? '< ' : '<='}${hms(bound * goalSec)}`;
      const pctIn = (100 * b) / total;
      out.push(
        `${padR(label, 16)}${pad(Math.round(cum), 12)}${pad(Math.round(b), 14)}${f((100 * cum) / total, 1, 13)}${f(pctIn, 1, 11)}  ${'>'.repeat(Math.round(pctIn / 4))}`,
      );
    });
  }
  return out.join('\n');
}

function hms(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}.${String(m).padStart(2, '0')}.${s.toFixed(3).padStart(6, '0')}`;
}

export function renderPartitionData(iv: RmfInterval): string {
  const out = header('PARTITION DATA REPORT', iv);
  for (const c of iv.cpcBusy) out.push(`CPC ${c.cpcId}  ${padR(c.pool, 4)} PHYSICAL BUSY ${c.physicalBusyPct.toFixed(1)}%`);
  out.push('');
  out.push('NAME      WGT  LCPS  POLARITY        PHYS ENG  LOG BUSY%  LPAR MGMT%  PR/SM DLY%  CAPPED%  MSU AVG   R4HA   DEF CAP  zIIP ENG');
  for (const r of iv.cpu.filter((x) => x.logicalCps > 0)) {
    out.push(
      [
        padR(r.lparId, 8),
        pad(r.weight, 4),
        pad(r.logicalCps, 5),
        ' ' + padR(r.polarity, 14),
        f(r.physicalEngines, 2, 9),
        f(r.logicalBusyPct, 1, 10),
        f(r.overheadPct, 2, 11),
        f(r.prsmDelayPct, 1, 11),
        f(r.cappedPct, 1, 8),
        f(r.msuAvg, 0, 8),
        f(r.r4ha, 0, 7),
        pad(r.definedCapacityMsu ?? '-', 8),
        f(r.ziipEngines, 2, 9),
      ].join(' '),
    );
  }
  const cfs = iv.cpu.filter((x) => x.logicalCps === 0 && x.icfEngines > 0);
  for (const r of cfs) out.push(`${padR(r.lparId, 8)}  ICF ENGINES ${r.icfEngines.toFixed(2)}`);
  return out.join('\n');
}

export function renderCfActivity(iv: RmfInterval): string {
  const out = header('COUPLING FACILITY ACTIVITY', iv);
  out.push('CF NAME   UTIL%    REQ/SEC   SYNC SERV(us)  ASYNC %   AVG SERV(us)');
  for (const c of iv.cf) {
    out.push(`${padR(c.lparId, 8)} ${f(c.busyPct, 1, 6)} ${f(c.reqPerSec, 0, 10)} ${f(c.syncUs, 1, 14)} ${f(c.asyncPct, 1, 9)} ${f(c.serviceUs, 1, 14)}`);
  }
  if ((iv.cfStructures ?? []).length) {
    out.push('', 'STRUCTURE SUMMARY');
    out.push('STRUCTURE NAME     TYPE   CF        REQ/SEC   SYNC %   SYNC SERV(us)   AVG SERV(us)');
    for (const st of iv.cfStructures) {
      out.push(`${padR(st.name, 18)} ${padR(st.type, 6)} ${padR(st.cfLparId, 8)} ${f(st.reqPerSec, 0, 8)} ${f(st.syncPct, 1, 8)} ${f(st.syncUs, 1, 15)} ${f(st.serviceUs, 1, 14)}`);
    }
  }
  return out.join('\n');
}

export function renderDasdSummary(iv: RmfInterval): string {
  const d = iv.dasd;
  const out = [
    ...header('DIRECT ACCESS DEVICE ACTIVITY', iv),
    'DEVICE GROUP   ACTIVITY RATE   AVG RESP(ms)  IOSQ   PEND   DISC   CONN    SEQ RESP(ms)',
    `ALL VOLUMES    ${f(d.iops, 0, 13)}   ${f(d.rtRandomMs, 3, 10)} ${f(d.iosqMs, 3, 6)} ${f(d.pendMs, 3, 6)} ${f(d.discMs, 3, 6)} ${f(d.connMs, 3, 6)} ${f(d.rtSeqMs, 3, 13)}`,
  ];
  if ((iv.lcus ?? []).length) {
    out.push('', 'LOGICAL CONTROL UNIT SUMMARY (HyperPAV aliases are pooled per LCU)');
    out.push('LCU  CONTENTS               VOLS  ALIASES  ACTIVITY RATE  AVG RESP(ms)   IOSQ(ms)  ALIASES/HOT VOL');
    for (const l of iv.lcus) {
      out.push(`${padR(l.id, 4)} ${padR(l.label, 22)} ${f(l.volumes, 0, 4)} ${f(l.aliases, 0, 8)} ${f(l.iops, 0, 14)} ${f(l.rtMs, 3, 13)} ${f(l.iosqMs, 3, 10)} ${f(l.aliasesPerHotVol, 2, 16)}`);
    }
  }
  return out.join('\n');
}

/** SCRT-style sub-capacity report for a month (prices are the game's fictional ones). */
export function renderScrt(
  cost: CostState,
  products: readonly ProductDef[],
  month: 'current' | number,
  clockText: (tick: number) => string,
): string {
  const bill = month === 'current' ? null : cost.bills.find((b) => b.month === month);
  const lines = bill
    ? bill.lines
    : billLines(cost, products);
  const out = [
    '                         S U B - C A P A C I T Y   R E P O R T   (SCRT-style)',
    `REPORTING PERIOD: MONTH ${(bill ? bill.month : cost.month) + 1}${bill ? '' : ' (month to date)'}      PRICES: FICTIONAL GAME TIERS`,
    '',
    'PRODUCT          LPARS                         PEAK 4HRA MSU   PEAK HOUR (ENDING)        CHARGE',
  ];
  for (const l of lines) {
    const p = products.find((x) => x.id === l.product)!;
    out.push(`${padR(p.name, 16)} ${padR(p.lpars.join(','), 29)} ${f(l.peakMsu, 1, 13)}   ${padR(l.peakMsu > 0 ? clockText(l.peakTick) : '-', 22)} ${f(l.cost, 0, 10)}`);
  }
  out.push('', `TOTAL ${f(lines.reduce((a, l) => a + l.cost, 0), 0, 82)}`, '', 'PEAK-HOUR CONTRIBUTION BY LPAR (R4HA, limited by defined capacity)');
  for (const l of lines) {
    const by = l.peakByLpar ?? {};
    const parts = Object.keys(by)
      .sort()
      .map((k) => `${k} ${f(by[k]!, 1, 0)}`)
      .join('  ');
    out.push(`${padR(products.find((x) => x.id === l.product)!.name, 16)} ${parts || '-'}`);
  }
  if (lines.some((l) => l.msuHours !== undefined)) {
    out.push('', 'CONSUMPTION (TAILORED FIT PRICING; CHARGE ABOVE INCLUDES ANY SUB-CAPACITY PART OF THE MONTH)', 'PRODUCT          MSU-HOURS USED   BASELINE (PRORATED)   OVER BASELINE');
    for (const l of lines) {
      const used = l.msuHours ?? 0;
      const base = l.baselineMsuHours ?? 0;
      out.push(`${padR(products.find((x) => x.id === l.product)!.name, 16)} ${f(used, 0, 14)}   ${f(base, 0, 19)}   ${f(Math.max(0, used - base), 0, 13)}`);
    }
  }
  return out.join('\n');
}
