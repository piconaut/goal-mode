import { expect, it } from 'vitest';
import { summarizeProfile } from '../../tools/profileSummary';

const frame = (functionName: string, columnNumber = 0) => ({
  functionName, scriptId: '1', url: 'file:///sim.ts', lineNumber: 0, columnNumber,
});

it('merges repeated frames across call paths and counts recursive frames once per inclusive sample', () => {
  const { frames, totalUs } = summarizeProfile({
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 4] },
      { id: 2, callFrame: frame('step'), children: [3] },
      { id: 3, callFrame: frame('step'), children: [6] },
      { id: 4, callFrame: frame('advance'), children: [5] },
      { id: 5, callFrame: frame('step') },
      { id: 6, callFrame: frame('step', 10) },
    ],
    samples: [2, 3, 5, 6],
    timeDeltas: [100, 200, 300, 400],
  });

  expect(totalUs).toBe(1000);
  expect(frames.map(({ functionName, columnNumber, selfUs, inclusiveUs }) => [functionName, columnNumber, selfUs, inclusiveUs])).toEqual([
    ['(root)', 0, 0, 1000],
    ['step', 0, 600, 1000],
    ['advance', 0, 0, 300],
    ['step', 10, 400, 400],
  ]);
});

it('rejects profiles with no timing for a sample', () => {
  expect(() => summarizeProfile({ nodes: [], samples: [1], timeDeltas: [] })).toThrow('one time delta per sample');
});

it('does not count an interval twice when V8 emits a sample out of timestamp order', () => {
  const { frames, totalUs } = summarizeProfile({
    nodes: [
      { id: 1, callFrame: frame('step'), children: [2] },
      { id: 2, callFrame: frame('advance') },
    ],
    samples: [2, 2, 1],
    timeDeltas: [1000, -100, 200],
  });

  expect(totalUs).toBe(1100);
  expect(frames.map(({ selfUs, inclusiveUs }) => [selfUs, inclusiveUs])).toEqual([[100, 1100], [1000, 1000]]);
});
