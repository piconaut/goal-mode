import { buildPlan, type PlanAssessment } from '../../src/sim/wlm/plan';
import type { Ladder } from '../../src/sim/wlm/ladder';

const original: Ladder = [['A'], ['B'], ['C'], ['G', 'H', 'I']];
const net = (pi: number): PlanAssessment => ({ ok: true, verdict: 'RETAINED', receiverPi: [2, pi], projected: true });
const blocked = (key?: string): PlanAssessment => ({ ok: false, verdict: 'MORE_IMPORTANT_HARMED',
  receiverPi: [2, null], projected: false, ...(key ? { blockedBy: key } : {}) });

describe('atomic policy plans (WT-08, SG24-6472-03 p.67–68)', () => {
  it('carries H, retains C, leaves failing B, retains A, then raises I enough to commit', () => {
    // Explicit expected orders, independent of the ladder helpers. G stays at the old level when I and H rise.
    const proposals: { ladder: Ladder; assessment: PlanAssessment }[] = [
      { ladder: [['A'], ['B'], ['C'], ['I'], ['G', 'H']], assessment: blocked('H') },
      { ladder: [['A'], ['B'], ['C'], ['H', 'I'], ['G']], assessment: net(1.95) },
      { ladder: [['A'], ['B'], ['C'], ['I'], ['H'], ['G']], assessment: blocked('H') },
      { ladder: [['A'], ['B'], ['C', 'H', 'I'], ['G']], assessment: net(1.90) },
      { ladder: [['A'], ['B'], ['I'], ['C', 'H'], ['G']], assessment: blocked() },
      { ladder: [['A'], ['B', 'C', 'H', 'I'], ['G']], assessment: blocked('B') },
      { ladder: [['B'], ['A', 'C', 'H', 'I'], ['G']], assessment: net(1.85) },
      { ladder: [['B'], ['I'], ['A', 'C', 'H'], ['G']], assessment: net(1.70) },
    ];
    let calls = 0;
    const out = buildPlan({ receiver: 'I', ladder: original, donors: ['C', 'B', 'A'], basePi: 2, maxSteps: 6,
      importanceOf: () => 2, receiverValue: (p) => 2 - p >= .2,
      assess: (L) => { const want = proposals[calls++]!; expect(L).toEqual(want.ladder); return want.assessment; } });
    expect(calls).toBe(proposals.length);
    expect(out.outcome).toBe('ACCEPTED');
    expect(out.ladder).toEqual([['B'], ['I'], ['A', 'C', 'H'], ['G']]);
    expect(out.moves.map((m) => [m.kind, m.scKey])).toEqual([['UP', 'I'], ['CARRY', 'H'], ['DONOR', 'C'], ['DONOR', 'A'], ['UP', 'I']]);
    expect(out.attempts.filter((a) => a.verdict === 'ACCEPTED')).toHaveLength(1);
    expect(original).toEqual([['A'], ['B'], ['C'], ['G', 'H', 'I']]);
  });

  it('rolls a safe but insufficient partial plan back at the step limit', () => {
    const L: Ladder = [['A'], ['R', 'X']];
    const out = buildPlan({ receiver: 'R', ladder: L, donors: [], basePi: 2, maxSteps: 1,
      importanceOf: () => 2, receiverValue: () => false, assess: () => net(1.99) });
    expect(out.outcome).toBe('STEP_LIMIT');
    expect(out.ladder).toBe(L);
    expect(out.moves).toEqual([]);
    expect(out.attempts[0]!.verdict).toBe('RETAINED');
  });

  it('assesses a join-and-split as one proposal without retaining the unsafe join', () => {
    let calls = 0;
    const L: Ladder = [['D'], ['R']];
    const out = buildPlan({ receiver: 'R', ladder: L, donors: [], basePi: 2, maxSteps: 2,
      importanceOf: () => 2, receiverValue: (p) => p < 1,
      assess: (T) => {
        calls++;
        if (calls === 1) { expect(T).toEqual([['D', 'R']]); return { ...blocked(), verdict: 'NO_NET_VALUE', projected: true }; }
        expect(T).toEqual([['R'], ['D']]); return net(.8);
      } });
    expect(out.outcome).toBe('ACCEPTED');
    expect(out.moves.map((m) => m.kind)).toEqual(['UP', 'UP']);
    expect(out.attempts.map((a) => a.verdict)).toEqual(['NO_NET_VALUE', 'ACCEPTED']);
    expect(L).toEqual([['D'], ['R']]);
  });

  it('rolls back when budget runs out immediately before a carry retry', () => {
    let calls = 0;
    const out = buildPlan({ receiver: 'I', ladder: original, donors: [], basePi: 2, maxSteps: 6,
      importanceOf: () => 2, receiverValue: () => true, assess: () => ++calls === 1 ? blocked('H') : null });
    expect(calls).toBe(2);
    expect(out.outcome).toBe('BUDGET');
    expect(out.ladder).toBe(original);
    expect(out.moves).toEqual([]);
    expect(out.attempts[0]!.moves.map((m) => m.kind)).toEqual(['UP']);
  });

  it('never moves a donor upward after earlier receiver raises left it below the receiver', () => {
    let calls = 0;
    const out = buildPlan({ receiver: 'R', ladder: [['D0'], ['D1', 'R', 'X']], donors: ['D0', 'D1'],
      basePi: 10, maxSteps: 6, importanceOf: () => 2, receiverValue: () => false,
      assess: () => { calls++; return calls === 2 ? { ...blocked(), verdict: 'NO_RECEIVER_GAIN' } : { ...net(10 - calls), receiverPi: [10, 10 - calls] }; } });
    expect(calls).toBe(4);
    expect(out.outcome).toBe('REJECTED');
    expect(out.attempts.flatMap((a) => a.moves).filter((m) => m.kind === 'DONOR').map((m) => m.scKey)).toEqual(['D0']);
  });

  it('does not retain a donor that makes no further gain over the current partial plan', () => {
    let calls = 0;
    const out = buildPlan({ receiver: 'I', ladder: original, donors: ['A'], basePi: 2, maxSteps: 2,
      importanceOf: () => 2, receiverValue: () => false,
      assess: () => ++calls === 1 ? net(1.95) : calls === 2 ? { ...blocked(), verdict: 'NO_RECEIVER_GAIN' } : net(1.96) });
    expect(out.moves).toEqual([]);
    expect(out.attempts.filter((a) => a.moves[0]!.kind === 'DONOR')).toHaveLength(1);
    expect(out.outcome).toBe('REJECTED');
  });
});
