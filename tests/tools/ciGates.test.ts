import { describe, expect, it } from 'vitest';
import { behaviourNote } from '../../tools/ci/behaviourNote';
import { checkBands, parseSweepCsv } from '../../tools/ci/balanceGate';
import { DEFAULT_ARGS, planSweep } from '../../tools/ci/sweepPlan';

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
  it('defaults to the three band bots over seeds 1-20 in shards of five', () => {
    expect(planSweep('')).toEqual({ args: '--bots donothing,textbook,expert', seeds: '1-20', shards: ['1-5', '6-10', '11-15', '16-20'] });
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
