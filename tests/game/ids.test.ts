import { describe, expect, it } from 'vitest';
import { idText, parseIdText } from '../../src/game/ids';

describe('prefixed run ids', () => {
  it('shows each kind with its own prefix', () => {
    expect(idText('incident', 13)).toBe('INC13');
    expect(idText('pin', 12)).toBe('PIN12');
    expect(idText('change', 4)).toBe('CHG4');
  });

  it('reads the prefixed, lower-case, # and bare forms', () => {
    for (const t of ['INC13', 'inc13', '#13', '13', ' 13 ']) expect(parseIdText('incident', t)).toBe(13);
  });

  it('refuses another kind or junk, naming the kind it wants', () => {
    expect(() => parseIdText('incident', 'PIN12')).toThrow(/PIN12 is a pin id; expected an incident id like INC12/);
    expect(() => parseIdText('pin', 'XYZ1')).toThrow(/not an id/);
    expect(() => parseIdText('pin', '')).toThrow(/not an id/);
  });
});
