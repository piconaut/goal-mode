import { afterEach, vi } from 'vitest';
import { SCENARIOS } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import * as evaluator from '../../src/sim/wlm/evaluate';

// Game accounting identities, not a change to the processor model. The period and consumer sums group the same
// grants differently: 1e-9 relative/absolute allows only floating-point addition order at small engine counts.
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

afterEach(() => vi.restoreAllMocks());

describe.each(Object.entries(SCENARIOS))('CPU accounting: %s', (_id, scenario) => {
  it('reconciles wait by host and every consumer grant against the dispatch slices over several ticks', () => {
    const evaluations: { input: evaluator.LparEvalInput; result: evaluator.LparEvalResult }[] = [];
    const original = evaluator.evaluateLpar;
    vi.spyOn(evaluator, 'evaluateLpar').mockImplementation((input) => {
      const result = original(input);
      if (!input.scpsOnly) evaluations.push({ input, result });
      return result;
    });
    let s = initState(42, scenario);
    let wait = 0, roles = 0, workloads = 0, other = 0, overflow = 0;
    for (let tick = 0; tick < 6; tick++) {
      evaluations.length = 0;
      const offline = tick === 3 ? s.config.lpars.filter((l) => l.pools.some((p) => p.pool === 'ZIIP'))
        .map((l) => ({ kind: 'SET_LOGICAL' as const, lparId: l.id, pool: 'ZIIP' as const, logical: 0 })) : [];
      s = step(s, offline, scenario);
      for (const w of s.last.workloads) {
        if (w.completions <= 0) continue;
        expect(w.cpuWaitByLpar).toBeDefined();
        const rows = Object.values(w.cpuWaitByLpar!);
        near(rows.reduce((n, x) => n + x.cp, 0), w.parts.cpuQueue ?? 0);
        near(rows.reduce((n, x) => n + x.ziip, 0), w.parts.ziipQueue ?? 0);
        near(rows.reduce((n, x) => n + x.backlog, 0), w.parts.backlogWait ?? 0);
        near(rows.reduce((n, x) => n + x.completions, 0), w.completions);
        wait += rows.reduce((n, x) => n + x.cp + x.ziip + x.backlog, 0);
      }
      expect(evaluations.length).toBe(s.last.lpars.length);
      for (const [li, lt] of s.last.lpars.entries()) {
        const { input, result } = evaluations[li]!;
        const expectedRoles: Record<string, { cp: number; ziip: number; iipcp: number }> = {};
        const expectedWork: Record<string, { cp: number; ziip: number; iipcp: number }> = {};
        const expectedWait: Record<string, { cp: number; ziip: number; backlog: number; completions: number }> = {};
        let otherCp = 0, otherZi = 0, otherIipcp = 0;
        input.slices.forEach((slice, i) => {
          const r = result.slices[i]!;
          if (slice.workloadId && r.parts && r.completions > 0) {
            const w = expectedWait[slice.workloadId] ??= { cp: 0, ziip: 0, backlog: 0, completions: 0 };
            w.cp += r.parts.cpuQueue * r.completions;
            w.ziip += r.parts.ziip * r.completions;
            w.backlog += r.parts.backlogWait * r.completions;
            w.completions += r.completions;
          }
          const key = slice.kind === 'AS' && slice.role ? slice.role : slice.workloadId;
          if (key) {
            const rows = slice.kind === 'AS' ? expectedRoles : expectedWork;
            const row = rows[key] ??= { cp: 0, ziip: 0, iipcp: 0 };
            row.cp += r.cpGranted;
            row.ziip += r.ziipGranted;
            row.iipcp += r.iipcpGranted;
          } else {
            otherCp += r.cpGranted;
            otherZi += r.ziipGranted;
            otherIipcp += r.iipcpGranted;
          }
        });
        expect(lt.cpByRole).toEqual(Object.keys(expectedRoles).length ? expectedRoles : undefined);
        expect(lt.cpByWorkload).toEqual(Object.keys(expectedWork).length ? expectedWork : undefined);
        for (const w of s.last.workloads) expect(w.cpuWaitByLpar?.[lt.lparId]).toEqual(expectedWait[w.id]);
        const consumers = [...Object.values(lt.cpByRole ?? {}), ...Object.values(lt.cpByWorkload ?? {})];
        near(consumers.reduce((n, x) => n + x.cp, otherCp), lt.scps.reduce((n, x) => n + x.cpEngines, 0));
        near(consumers.reduce((n, x) => n + x.ziip, otherZi), lt.scps.reduce((n, x) => n + x.ziipEngines, 0));
        near(consumers.reduce((n, x) => n + x.iipcp, otherIipcp), lt.scps.reduce((n, x) => n + x.iipcpEngines, 0));
        overflow += lt.scps.reduce((n, x) => n + x.iipcpEngines, 0);
        near(lt.scps.reduce((n, x) => n + x.cpEngines + x.iipcpEngines, 0), s.lpars.find((l) => l.id === lt.lparId)!.pools.find((p) => p.pool === 'CP')!.effectiveEngines);
        roles += Object.keys(expectedRoles).length;
        workloads += Object.keys(expectedWork).length;
        other += otherCp;
      }
    }
    expect(wait).toBeGreaterThan(0);
    expect(roles).toBeGreaterThan(0);
    expect(workloads).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
    expect(overflow).toBeGreaterThan(0);
  });
});

it('omits consumer and wait records without corresponding slices, including after a populated tick', () => {
  const scenario = SCENARIOS.midwest!;
  const populated = step(initState(42, scenario), [], scenario);
  expect(populated.last.lpars.some((l) => l.cpByRole)).toBe(true);
  const empty = { ...scenario, addressSpaces: [], workloads: [] };
  const next = step(populated, [], empty);
  for (const l of next.last.lpars) {
    expect(l.cpByRole).toBeUndefined();
    expect(l.cpByWorkload).toBeUndefined();
  }
  for (const w of next.last.workloads) expect(w.cpuWaitByLpar).toBeUndefined();
});

it('omits wait records when workloads have no completions', () => {
  const scenario = SCENARIOS.midwest!;
  const quiet = { ...scenario, workloads: scenario.workloads.map((w) => ({ ...w, peakRatePerSec: 0 })) };
  const s = step(initState(42, quiet), [], quiet);
  expect(s.last.workloads.length).toBeGreaterThan(0);
  for (const w of s.last.workloads) {
    expect(w.completions).toBe(0);
    expect(w.cpuWaitByLpar).toBeUndefined();
  }
});

it('does not record queue wait from transaction slices with zero completions', () => {
  const original = evaluator.evaluateLpar;
  let queuedSec = 0, failed = 0;
  vi.spyOn(evaluator, 'evaluateLpar').mockImplementation((input) => {
    // Use real queue/parts calculation, but make every offered transaction fail at the subsystem.
    const result = original({ ...input, slices: input.slices.map((s) => s.kind === 'TXN' ? { ...s, failFrac: 1 } : s) });
    if (!input.scpsOnly) for (const r of result.slices) if (r.parts) {
      expect(r.completions).toBe(0);
      queuedSec += r.parts.cpuQueue + r.parts.ziip + r.parts.backlogWait;
      failed += r.failed;
    }
    return result;
  });
  const scenario = SCENARIOS.midwest!;
  const s = step(initState(42, scenario), [], scenario);
  expect(queuedSec).toBeGreaterThan(0);
  expect(failed).toBeGreaterThan(0);
  for (const w of s.last.workloads) {
    expect(w.completions).toBe(0);
    expect(w.cpuWaitByLpar).toBeUndefined();
    expect(w.parts).toEqual({});
  }
});

it('retains nonzero IIPCP grants for both server roles and workloads when zIIPs are offline', () => {
  const scenario = SCENARIOS.midwest!;
  let s = initState(42, scenario);
  const commands = s.config.lpars.filter((l) => l.pools.some((p) => p.pool === 'ZIIP'))
    .map((l) => ({ kind: 'SET_LOGICAL' as const, lparId: l.id, pool: 'ZIIP' as const, logical: 0 }));
  expect(commands.length).toBeGreaterThan(0);
  let roleIipcp = 0, workloadIipcp = 0;
  for (let tick = 0; tick < 3; tick++) {
    s = step(s, tick === 0 ? commands : [], scenario);
    for (const lt of s.last.lpars) {
      roleIipcp += Object.values(lt.cpByRole ?? {}).reduce((n, x) => n + x.iipcp, 0);
      workloadIipcp += Object.values(lt.cpByWorkload ?? {}).reduce((n, x) => n + x.iipcp, 0);
    }
  }
  expect(roleIipcp).toBeGreaterThan(0);
  expect(workloadIipcp).toBeGreaterThan(0);
});
