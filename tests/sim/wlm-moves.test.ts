import type { WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import type { PlanMove } from '../../src/sim/wlm/plan';
import { committedMoves } from '../helpers/wlmMoves';

const trace = (before: Record<string, number>, after: Record<string, number>, plan: PlanMove[], sec: number): WlmAdjustTrace => ({
  clockText: `D1 06:00:${String(sec).padStart(2, '0')}`, lparId: 'SYS', dps: before, protection: [], action: `plan at ${sec}`,
  candidates: [{ scKey: 'I', importance: 2, sysplexPi: 2, localPi: 2, dp: before.I ?? 244, bottleneck: 'CPU',
    delayShares: { CPU: 1, ZIIP: 0, IO: 0, STORAGE: 0, QUEUE: 0, CAP: 0, OTHER: 0 }, outcome: 'ASSESSED',
    trials: [{ move: 'last proposal only', verdict: 'ACCEPTED', plan, afterDps: after }] }],
});

it('observes a net upward carry even when the same plan ends by lowering that period', () => {
  const a = { A: 246, B: 246, H: 246, G: 244, I: 244, J: 244 };
  const b = { A: 246, B: 246, H: 244, G: 244, I: 244, J: 244 };
  const c = { A: 246, B: 246, H: 242, G: 240, I: 244, J: 240 };
  const first = trace(a, b, [{ kind: 'DONOR', scKey: 'H', fromDp: 246, toDp: 244 }], 0);
  const second = trace(b, c, [
    { kind: 'UP', scKey: 'I', fromDp: 244, toDp: 244, above: 'G' },
    { kind: 'CARRY', scKey: 'H', fromDp: 242, toDp: 244 },
    { kind: 'DONOR', scKey: 'H', fromDp: 244, toDp: 242 },
  ], 10);
  expect([first, second].flatMap(committedMoves).filter((m) => m.who === 'H').map((m) => m.dir)).toEqual([-1, 1]);
});

it('observes a donor reversal when another period has the first step of its plan', () => {
  const low = { D: 244, T: 246, O: 242 }, high = { D: 246, T: 244, O: 242 };
  const rows = [
    trace(low, high, [{ kind: 'UP', scKey: 'D', fromDp: 244, toDp: 246 }], 0),
    trace(high, low, [{ kind: 'UP', scKey: 'T', fromDp: 244, toDp: 246 }, { kind: 'DONOR', scKey: 'D', fromDp: 246, toDp: 244 }], 10),
    trace(low, high, [{ kind: 'UP', scKey: 'D', fromDp: 244, toDp: 246 }], 20),
  ];
  expect(rows.flatMap(committedMoves).filter((m) => m.who === 'D').map((m) => m.dir)).toEqual([1, -1, 1]);
});

it('ignores canonical renumbering with no change to live ordering', () => {
  expect(committedMoves(trace({ I: 246, H: 244 }, { I: 244, H: 242 }, [
    { kind: 'UP', scKey: 'I', fromDp: 246, toDp: 244 },
  ], 0))).toEqual([]);
});

it('keeps elapsed times increasing across midnight within the same played day', () => {
  const t = trace({ I: 244, H: 246 }, { I: 246, H: 244 }, [{ kind: 'UP', scKey: 'I', fromDp: 244, toDp: 246 }], 0);
  const before = committedMoves({ ...t, clockText: 'D1 23:59:50' })[0]!;
  const after = committedMoves({ ...t, clockText: 'D1 00:00:10' })[0]!;
  expect(after.sec - before.sec).toBe(20);
});
