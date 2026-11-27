import { describe, expect, it } from 'vitest';
import { minuteKey } from '../../src/sim/core/clock';
import { median } from '../../src/sim/core/math';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

describe('median', () => {
  it('is undefined for no readings', () => {
    expect(median([])).toBeUndefined();
  });

  it('takes the middle reading of an odd count, whatever the input order', () => {
    expect(median([7])).toBe(7);
    expect(median([9, 1, 4])).toBe(4);
  });

  it('averages the two middle readings of an even count', () => {
    expect(median([10, 2])).toBe(6);
    expect(median([5, 1, 9, 3])).toBe(4);
  });

  it('does not reorder its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('minuteKey', () => {
  it('keys the played day and the visible minute', () => {
    expect(minuteKey(0)).toBe('0:06:00');
    expect(minuteKey(6)).toBe('0:06:01');
  });

  it('puts ticks within the same visible minute on one key and the next minute on another', () => {
    expect(minuteKey(5)).toBe(minuteKey(0));
    expect(minuteKey(6)).not.toBe(minuteKey(5));
  });

  it('keeps the played day across midnight and changes it at the next 06:00', () => {
    expect(minuteKey(TICKS_PER_DAY - 1)).toBe('0:05:59');
    expect(minuteKey(TICKS_PER_DAY)).toBe('1:06:00');
  });
});
