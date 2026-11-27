// CL-19: a guard over the service-class accumulator fields.
//
// Four functions carry the per-period accumulator fields by hand:
//   - addScp and mergeAcc build an RMF interval accumulator (src/sim/measure/rmf.ts);
//   - decayInto and sumAcc add and total WLM's management accumulators (src/sim/wlm/runtime.ts).
//
// The field lists below are typed with `satisfies Record<keyof Required<...>, ...>`, so a field added to ScpAcc or
// ScpTick fails `npm run typecheck` until it is listed with its treatment. Each test fills the inputs with a distinct
// non-zero value in every field and checks that a carried field reaches the output, while a deliberate omission says
// why in OMIT_REASONS.

import { addScp, mergeAcc, type ScpIntervalAcc } from '../../src/sim/measure/rmf';
import type { ScpTick } from '../../src/sim/wlm/evaluate';
import { BUCKETS } from '../../src/sim/wlm/goals';
import type { MovedSamples, WorkManagerSamples } from '../../src/sim/wlm/reporting';
import { ACC_DECAY, decayInto, sumAcc, type ScpAcc } from '../../src/sim/wlm/runtime';

const FNS = ['addScp', 'decayInto', 'mergeAcc', 'sumAcc'] as const;
type Fn = (typeof FNS)[number];

/** sum: the function adds the field (mergeAcc/sumAcc are checked exactly); decay: carried through the decay;
 * carry: mergeAcc spreads the left-hand accumulator's value; omit: deliberately not carried, with a reason below. */
type Treatment = 'sum' | 'decay' | 'carry' | 'omit';

interface FieldSpec {
  /** A distinct non-zero input value; moved/workManager spread it over their sub-fields. */
  value: number;
  addScp: Treatment;
  decayInto: Treatment;
  mergeAcc: Treatment;
  sumAcc: Treatment;
}

type Rules = Omit<FieldSpec, 'value'>;

const ALL: Rules = { addScp: 'sum', decayInto: 'decay', mergeAcc: 'sum', sumAcc: 'sum' };
// CICS attribution metadata: its work is already in the main fields; reportedAccs() attributes it to region classes.
const MOVED: Rules = { addScp: 'omit', decayInto: 'decay', mergeAcc: 'carry', sumAcc: 'omit' };
// Kept in WLM's decayed accumulator (management or Monitor III), never written by addScp; an interval accumulator
// carries nothing to merge.
const WLM_ACC_ONLY: Rules = { addScp: 'omit', decayInto: 'decay', mergeAcc: 'carry', sumAcc: 'sum' };
// WLM's sustained-demand projection feeds decisions, not reports.
const PROJECTION: Rules = { addScp: 'omit', decayInto: 'decay', mergeAcc: 'carry', sumAcc: 'omit' };

let n = 0;
const v = (): number => ++n;

const SCP_ACC_FIELDS = {
  moved: { ...MOVED, value: v() },
  workManager: { ...ALL, value: v() },
  completions: { ...ALL, value: v() },
  rtSumSec: { ...ALL, value: v() },
  rtQueueSumSec: { ...WLM_ACC_ONLY, value: v() },
  buckets: { ...ALL, value: v() },
  using: { ...ALL, value: v() },
  delay: { ...ALL, value: v() },
  delayCpu: { ...ALL, value: v() },
  delayZiip: { ...ALL, value: v() },
  delayIo: { ...ALL, value: v() },
  delayOther: { ...ALL, value: v() },
  delayCap: { ...ALL, value: v() },
  delayStorage: { ...ALL, value: v() },
  delayQueue: { ...ALL, value: v() },
  cpuEngines: { ...ALL, value: v() },
  ziipEngines: { ...ALL, value: v() },
  usingCpu: { ...ALL, value: v() },
  usingZiip: { ...ALL, value: v() },
  usingIo: { ...ALL, value: v() },
  iipcpEngines: { ...ALL, value: v() },
  ziipEnginesView: { ...WLM_ACC_ONLY, value: v() },
  demandCp: { ...PROJECTION, value: v() },
  demandZi: { ...PROJECTION, value: v() },
  usingIoNoVel: { ...ALL, value: v() },
  delayIoNoVel: { ...ALL, value: v() },
  srvUsing: { ...WLM_ACC_ONLY, value: v() },
  srvDelay: { ...WLM_ACC_ONLY, value: v() },
  srvDelayCap: { ...WLM_ACC_ONLY, value: v() },
} satisfies Record<keyof Required<ScpAcc>, FieldSpec>;

let tn = 100;
const tv = (): number => ++tn;

const TICK_VALUES = {
  moved: tv(),
  workManager: tv(),
  scKey: 'GUARD#1',
  dp: 0xd0,
  cpEngines: tv(),
  ziipEngines: tv(),
  iipcpEngines: tv(),
  usingCpu: tv(),
  usingZiip: tv(),
  usingIo: tv(),
  delayCpu: tv(),
  delayZiip: tv(),
  delayIo: tv(),
  delayOther: tv(),
  delayStorage: tv(),
  delayCap: tv(),
  delayQueue: tv(),
  demandCp: tv(),
  demandZi: tv(),
  usingIoNoVel: tv(),
  delayIoNoVel: tv(),
  srvUsing: tv(),
  srvDelay: tv(),
  srvDelayCap: tv(),
  completions: tv(),
  failed: tv(),
  rtSumSec: tv(),
  rtQueueSumSec: tv(),
  buckets: tv(),
} satisfies Record<keyof Required<ScpTick>, number | string>;

/** Why each deliberate omission is safe; every `omit` must have one (checked below). */
const OMIT_REASONS: Partial<Record<keyof Required<ScpAcc>, Partial<Record<Fn, string>>>> = {
  moved: {
    addScp:
      'reportedTicks() subtracts CICS transaction samples from a tick and attributes them to its region classes before addScp(), so an RMF interval accumulator has none.',
    sumAcc:
      'moved samples are attribution metadata; their work is already in using/delay/cpuEngines, and reportedAccs() attributes it to region classes before a sysplex sum.',
  },
  rtQueueSumSec: {
    addScp:
      "WLM's batch queue-time figure (WT-12); the sim's WLMGL row (rmf.ts wlmRecord) reports no queue time yet, though real SMF 72.3 does (R723CQDT, z/OS 3.1 MVS SMF SA38-0667-60 PDF p.646 (printed 618); RF-13).",
  },
  ziipEnginesView: {
    addScp: "Monitor III's decayed zIIP view (PR-21); the RMF interval record reads ziipEngines (APPL% IIP).",
  },
  demandCp: {
    addScp: "WLM's sustained-demand projection (docs/wlm-design.md §5.4) is management input, not an RMF field.",
    sumAcc: 'sumAcc feeds reported/sysplex figures; sustained demand is management input and has no reported meaning summed.',
  },
  demandZi: {
    addScp: "WLM's sustained-demand projection (docs/wlm-design.md §5.4) is management input, not an RMF field.",
    sumAcc: 'sumAcc feeds reported/sysplex figures; sustained demand is management input and has no reported meaning summed.',
  },
  srvUsing: {
    addScp:
      "the server-region split of using is reported by Monitor III and the hourly CAP figures, not managed (goalPi subtracts it); addScp's RMF row reports the class total, which already includes it.",
  },
  srvDelay: {
    addScp:
      "the server-region split of delay is reported by Monitor III and the hourly CAP figures, not managed (goalPi subtracts it); addScp's RMF row reports the class total, which already includes it.",
  },
  srvDelayCap: {
    addScp:
      'the capping part of the server-region split feeds Monitor III and the hourly CAP figures; the RMF row reports the class total.',
  },
} satisfies Partial<Record<keyof Required<ScpAcc>, Partial<Record<Fn, string>>>>;

/** Distinct non-zero values for every sub-field, scaled so accumulator A and B differ. */
function movedSamples(scale: number): MovedSamples {
  let i = 0;
  const next = (): number => scale * ++i;
  return {
    cpEngines: next(),
    ziipEngines: next(),
    iipcpEngines: next(),
    usingCpu: next(),
    usingZiip: next(),
    usingIo: next(),
    delayCpu: next(),
    delayZiip: next(),
    delayIo: next(),
    delayOther: next(),
    delayStorage: next(),
    delayCap: next(),
    usingIoNoVel: next(),
    delayIoNoVel: next(),
  };
}

function workManagerSamples(scale: number): WorkManagerSamples {
  let i = 0;
  const next = (): number => scale * ++i;
  return {
    active: next(),
    ready: next(),
    idle: next(),
    waitingIo: next(),
    waitingLock: next(),
    waitingProd: next(),
    waitingMisc: next(),
    regionKeys: [`GUARD#${scale}`],
    managedToTxn: true,
  };
}

const buckets = (scale: number): number[] => Array.from({ length: BUCKETS }, (_, i) => scale + i + 1);

function buildAcc(scale: number): ScpAcc {
  const out: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(SCP_ACC_FIELDS)) {
    const value = spec.value * scale;
    out[field] =
      field === 'moved'
        ? movedSamples(value)
        : field === 'workManager'
          ? workManagerSamples(value)
          : field === 'buckets'
            ? buckets(value)
            : value;
  }
  return out as unknown as ScpAcc;
}

function buildTick(scale: number): ScpTick {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(TICK_VALUES)) {
    out[field] =
      field === 'scKey' || field === 'dp'
        ? value
        : field === 'moved'
          ? movedSamples((value as number) * scale)
          : field === 'workManager'
            ? workManagerSamples((value as number) * scale)
            : field === 'buckets'
              ? buckets((value as number) * scale)
              : (value as number) * scale;
  }
  return out as unknown as ScpTick;
}

const LPAR = 'GUARD';
const A = buildAcc(1);
const B = buildAcc(2);
const T = buildTick(1);
const asInterval = (a: ScpAcc, failed: number): ScpIntervalAcc =>
  ({ ...a, lparId: LPAR, scKey: T.scKey, dp: T.dp, failed }) as ScpIntervalAcc;
const P = asInterval(A, 1.5);
const Q = asInterval(B, 2.5);

const raw = (o: ScpAcc, field: keyof ScpAcc): unknown => (o as unknown as Record<string, unknown>)[field];

/** A field reached the output: numbers non-zero, buckets all non-zero, sample objects carrying non-zero data. */
function reachesOutput(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((x) => typeof x === 'number' && Number.isFinite(x) && x !== 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).every((x) =>
      typeof x === 'number' ? Number.isFinite(x) && x !== 0 : Array.isArray(x) ? x.length > 0 : x === true,
    );
  }
  return false;
}

const fields = Object.entries(SCP_ACC_FIELDS) as [keyof Required<ScpAcc>, FieldSpec][];

describe('service-class accumulator fields (CL-19)', () => {
  it('lists every ScpAcc and ScpTick field, and gives every deliberate omission a reason', () => {
    const values = fields.map(([, spec]) => spec.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((x) => x !== 0)).toBe(true);

    const tickNumbers = Object.values(TICK_VALUES).filter((x): x is number => typeof x === 'number');
    expect(new Set(tickNumbers).size).toBe(tickNumbers.length);
    expect(tickNumbers.every((x) => x !== 0)).toBe(true);

    for (const [field, spec] of fields) {
      for (const fn of FNS) {
        if (spec[fn] === 'omit') expect(OMIT_REASONS[field]?.[fn], `${field}.${fn} needs a reason`).toBeTruthy();
      }
    }
  });

  it('addScp keeps every field it carries and omits the WLM-accumulator-only ones', () => {
    const scps: Record<string, ScpIntervalAcc> = { [`${LPAR}|${T.scKey}`]: P };
    addScp(scps, LPAR, T);
    const out = scps[`${LPAR}|${T.scKey}`]!;

    for (const [field, spec] of fields) {
      if (spec.addScp === 'omit') {
        expect(raw(out, field), `${field} must be omitted`).toBeUndefined();
      } else {
        expect(reachesOutput(raw(out, field)), `${field} must reach addScp`).toBe(true);
      }
    }

    // The aggregate formulas the field list cannot express. addScp counts IIPCP in its own field, not in cpuEngines
    // (decayInto differs).
    expect(out.using).toBe(A.using + T.usingCpu + T.usingZiip + T.usingIo);
    expect(out.delay).toBe(
      A.delay + T.delayCpu + T.delayZiip + T.delayIo + T.delayStorage + T.delayCap + (T.delayQueue ?? 0),
    );
    expect(out.cpuEngines).toBe(A.cpuEngines + T.cpEngines);
    // ScpIntervalAcc's own field, outside the ScpAcc/ScpTick lists.
    expect(out.failed).toBe(P.failed + T.failed);
  });

  it('decayInto carries every field through the decay', () => {
    const out = decayInto(A, T);

    for (const [field, spec] of fields) {
      if (spec.decayInto === 'omit') {
        expect(raw(out, field), `${field} must be omitted`).toBeUndefined();
      } else {
        expect(reachesOutput(raw(out, field)), `${field} must reach decayInto`).toBe(true);
      }
    }

    expect(out.using).toBeCloseTo(A.using * ACC_DECAY + T.usingCpu + T.usingZiip + T.usingIo, 9);
    const delay = T.delayCpu + T.delayZiip + T.delayIo + T.delayStorage + T.delayCap + (T.delayQueue ?? 0);
    expect(out.delay).toBeCloseTo(A.delay * ACC_DECAY + delay, 9);
    expect(out.cpuEngines).toBeCloseTo(A.cpuEngines * ACC_DECAY + T.cpEngines + T.iipcpEngines, 9);
  });

  it('mergeAcc sums every field it sums and carries the rest from the left accumulator', () => {
    const out = mergeAcc(P, Q);

    for (const [field, spec] of fields) {
      if (spec.mergeAcc === 'carry') {
        expect(raw(out, field), `${field} must be carried from P`).toEqual(raw(P, field));
        continue;
      }
      expect(reachesOutput(raw(out, field)), `${field} must reach mergeAcc`).toBe(true);
      if (field === 'buckets') {
        expect(out.buckets).toEqual(P.buckets.map((x, i) => x + (Q.buckets[i] ?? 0)));
      } else if (field === 'workManager') {
        expect(out.workManager!.active).toBeCloseTo(P.workManager!.active + Q.workManager!.active, 9);
        expect(out.workManager!.waitingMisc).toBeCloseTo(P.workManager!.waitingMisc + Q.workManager!.waitingMisc, 9);
        expect(out.workManager!.regionKeys).toEqual([...new Set([...P.workManager!.regionKeys, ...Q.workManager!.regionKeys])].sort());
      } else {
        expect(raw(out, field) as number).toBeCloseTo((raw(P, field) as number) + (raw(Q, field) as number), 9);
      }
    }
    expect(out.failed).toBe(P.failed + Q.failed);
  });

  it('sumAcc sums every field it sums and omits the projection-only ones', () => {
    const out = sumAcc([A, B]);

    for (const [field, spec] of fields) {
      if (spec.sumAcc === 'omit') {
        expect(raw(out, field), `${field} must be omitted`).toBeUndefined();
        continue;
      }
      expect(reachesOutput(raw(out, field)), `${field} must reach sumAcc`).toBe(true);
      if (field === 'buckets') {
        expect(out.buckets).toEqual(A.buckets.map((x, i) => x + (B.buckets[i] ?? 0)));
      } else if (field === 'workManager') {
        expect(out.workManager!.active).toBeCloseTo(A.workManager!.active + B.workManager!.active, 9);
        expect(out.workManager!.waitingMisc).toBeCloseTo(A.workManager!.waitingMisc + B.workManager!.waitingMisc, 9);
      } else {
        expect(raw(out, field) as number).toBeCloseTo((raw(A, field) as number) + (raw(B, field) as number), 9);
      }
    }
  });
});
