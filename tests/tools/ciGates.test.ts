import { describe, expect, it } from 'vitest';
import { behaviourNote } from '../../tools/ci/behaviourNote';
import { checkBands, parseSweepCsv } from '../../tools/ci/balanceGate';
import { DEFAULT_ARGS, planSweep } from '../../tools/ci/sweepPlan';
import { SUITES, planTest } from '../../tools/ci/testPlan';
import { summarize, type VitestJson } from '../../tools/ci/testReport';

describe('behaviourNote', () => {
  it('returns the section text up to the next heading', () => {
    const body = '## Summary\nFaster CF.\n\n## Behaviour change\nLock requests now convert to async.\n\n## Testing\nnpm run check';
    expect(behaviourNote(body)).toBe('Lock requests now convert to async.');
  });

  it('reads a section at the end of the body', () => {
    expect(behaviourNote('## Behavior change\r\nZ is now Y.\r\n')).toBe('Z is now Y.');
  });

  it('treats a missing section, the template comment or a placeholder as no note', () => {
    expect(behaviourNote('## Summary\nstuff')).toBe('');
    expect(behaviourNote('## Behaviour change\n<!-- what changed and why -->\n\n## Testing\nx')).toBe('');
    expect(behaviourNote('## Behaviour change\nNone.\n')).toBe('');
    expect(behaviourNote('## Behaviour change\nn/a')).toBe('');
  });
});

describe('balance gate', () => {
  const csv = (rows: string[]) => ['bot,seed,phase,cause,day,score,overall_trust', ...rows].join('\n');
  const bands = { donothing: { dayMedian: [8, 22] as [number, number], victoryFrac: [0, 0] as [number, number] }, expert: { dayMedian: [28, 40] as [number, number], victoryFrac: [0.6, 1] as [number, number] } };

  it('passes runs inside their bands', () => {
    const rows = parseSweepCsv(csv(['donothing,1,LOST,trust,12,100,40', 'donothing,2,LOST,batch,15,90,40', 'donothing,3,LOST,trust,20,90,40', 'expert,1,VICTORY,victory,40,3000,80', 'expert,2,VICTORY,victory,40,2900,80', 'expert,3,LOST,opex,28,2000,60']));
    expect(checkBands(rows, 3, bands).failures).toEqual([]);
  });

  it('reports a median outside its band, too few victories and missing runs', () => {
    const rows = parseSweepCsv(csv(['donothing,1,VICTORY,victory,40,100,40', 'donothing,2,LOST,trust,30,90,40', 'expert,1,LOST,trust,20,1000,30', 'expert,2,LOST,trust,25,1000,30', 'expert,3,VICTORY,victory,40,3000,80']));
    expect(checkBands(rows, 3, bands).failures).toEqual([
      'donothing: 2 of 3 runs finished',
      'donothing: median end day 35 outside 8–22',
      'donothing: 1 of 2 victories outside 0%–0%',
      'expert: median end day 25 outside 28–40',
      'expert: 1 of 3 victories outside 60%–100%',
    ]);
  });

  it('scales the victory band with the number of seeds', () => {
    const rows = parseSweepCsv(csv(Array.from({ length: 10 }, (_, i) => `expert,${i + 1},${i < 9 ? 'VICTORY,victory,40' : 'LOST,opex,30'},3000,80`)));
    expect(checkBands(rows, 10, { expert: { dayMedian: [28, 40], victoryFrac: [0.6, 1] } }).failures).toEqual([]);
  });
});

describe('remote sweep plan', () => {
  it('defaults to the three band bots over seeds 1-20 in shards of two', () => {
    expect(planSweep('')).toEqual({ args: '--bots donothing,textbook,expert', seeds: '1-20', shards: ['1-2', '3-4', '5-6', '7-8', '9-10', '11-12', '13-14', '15-16', '17-18', '19-20'] });
    expect(planSweep('--seeds 1-40').shards).toHaveLength(10);
    expect(planSweep(DEFAULT_ARGS)).toEqual(planSweep(''));
  });

  it('keeps the other flags for every shard and spreads uneven seed counts', () => {
    const p = planSweep('--bots expert --difficulty hard --reader --seeds 3-9', 3);
    expect(p.args).toBe('--bots expert --difficulty hard --reader');
    expect(p.shards).toEqual(['3-5', '6-7', '8-9']);
    expect(planSweep('--seeds 7').shards).toEqual(['7-7']);
    expect(planSweep('--seeds 1-3', 8).shards).toEqual(['1-1', '2-2', '3-3']);
  });

  it('rejects flags the workflow owns and values that could reach a shell', () => {
    expect(() => planSweep('--out x.csv')).toThrow(/not allowed/);
    expect(() => planSweep('--jobs 2')).toThrow(/not allowed/);
    expect(() => planSweep('--bots expert;rm')).toThrow(/bad value/);
    expect(() => planSweep('--bots $(id)')).toThrow(/bad value/);
    expect(() => planSweep('--seeds 5-1')).toThrow(/seeds/);
    expect(() => planSweep('--seeds 1-500')).toThrow(/seeds/);
  });
});

describe('remote test plan', () => {
  it('defaults to every test file', () => {
    expect(planTest('')).toEqual({ raw: '', filters: [] });
    expect(planTest('   ')).toEqual({ raw: '', filters: [] });
    expect(SUITES).toEqual(['golden', 'game', 'sim', 'tools', 'ui']);
  });

  it('maps --suite to test directories and --filter to a path substring', () => {
    expect(planTest('--suite sim,golden')).toEqual({ raw: '--suite sim,golden', filters: ['tests/sim', 'tests/golden'] });
    expect(planTest('--suite sim,sim')).toEqual({ raw: '--suite sim,sim', filters: ['tests/sim'] });
    expect(planTest('--filter tests/sim/wlm --filter golden')).toEqual({ raw: '--filter tests/sim/wlm --filter golden', filters: ['tests/sim/wlm', 'golden'] });
  });

  it('refuses to mix --suite with --filter, which would widen instead of narrow', () => {
    expect(() => planTest('--suite sim --filter wlm')).toThrow(/not both/);
  });

  it('rejects unknown suites, missing values, shard flags and values that could reach a shell', () => {
    expect(() => planTest('--suite nope')).toThrow(/unknown suite nope/);
    expect(() => planTest('--suite sim,,golden')).toThrow(/unknown suite/);
    expect(() => planTest('--suite')).toThrow(/bad value/);
    expect(() => planTest('--filter')).toThrow(/bad value/);
    expect(() => planTest('--filter $(id)')).toThrow(/bad value/);
    expect(() => planTest('--suite sim;rm')).toThrow(/bad value/);
    expect(() => planTest('--shards 2')).toThrow(/not allowed/);
    expect(() => planTest('--out x.txt')).toThrow(/not allowed/);
    expect(() => planTest('wlm')).toThrow(/not allowed/);
  });
});

describe('remote test report', () => {
  const json = (over: Partial<VitestJson> = {}): VitestJson => ({
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 0,
    numFailedTestSuites: 0,
    success: true,
    testResults: [{ name: '/work/tests/sim/wlm.test.ts', status: 'passed', assertionResults: [{ fullName: 'wlm keeps the goal', status: 'passed' }] }],
    ...over,
  });
  const failedJson = (count = 1): VitestJson =>
    json({
      numTotalTests: count,
      numPassedTests: 0,
      numFailedTests: count,
      numFailedTestSuites: 1,
      success: false,
      testResults: [
        {
          name: '/work/tests/sim/wlm.test.ts',
          status: 'failed',
          assertionResults: Array.from({ length: count }, (_, i) => ({
            fullName: `wlm fails ${i}`,
            status: 'failed',
            failureMessages: [`AssertionError: expected 1 to be 2\n    at /work/tests/sim/wlm.test.ts:${i + 2}:42`],
          })),
        },
      ],
    });

  it('passes when nothing failed', () => {
    const { markdown, ok } = summarize(json(), '/work');
    expect(ok).toBe(true);
    expect(markdown.join('\n')).toContain('3 passed, 0 failed, 0 skipped — 3 tests');
    expect(markdown.join('\n')).toContain('All tests passed.');
  });

  it('lists failed tests with the checkout path stripped from the message', () => {
    const { markdown, ok } = summarize(failedJson(), '/work');
    const text = markdown.join('\n');
    expect(ok).toBe(false);
    expect(text).toContain('**tests/sim/wlm.test.ts › wlm fails 0**');
    expect(text).toContain('AssertionError: expected 1 to be 2');
    expect(text).not.toContain('/work/');
    expect(text).toContain('0 passed, 1 failed');
    expect(text).toContain('1 file(s) failed');
  });

  it('fails when a hook error failed the file without failing a test', () => {
    const hook = summarize({
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 1,
      numFailedTestSuites: 1,
      success: false,
      testResults: [{ name: '/work/tests/sim/hook.test.ts', status: 'failed', message: 'setup blew up', assertionResults: [{ fullName: 'never runs', status: 'skipped' }] }],
    }, '/work');
    const text = hook.markdown.join('\n');
    expect(hook.ok).toBe(false);
    expect(text).toContain('**tests/sim/hook.test.ts (file failed)**');
    expect(text).toContain('setup blew up');
    expect(text).toContain('0 passed, 0 failed, 1 skipped — 1 tests');
  });

  it('fails when no report was written or nothing ran', () => {
    const missing = summarize(null);
    expect(missing.ok).toBe(false);
    expect(missing.markdown.join('\n')).toContain('No test report was written');

    const none = summarize({ numTotalTests: 0 });
    expect(none.ok).toBe(false);
    expect(none.markdown.join('\n')).toContain('No tests ran');
  });

  it('caps the failure list and points at the run log', () => {
    const { markdown, ok } = summarize(failedJson(23), '/work');
    const text = markdown.join('\n');
    expect(ok).toBe(false);
    expect(text).toContain('**tests/sim/wlm.test.ts › wlm fails 19**');
    expect(text).not.toContain('wlm fails 20');
    expect(text).toContain('… and 3 more failure(s)');
  });
});
