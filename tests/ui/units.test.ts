import { fmtSuRate, rgLimitEquiv, type CpcSpeed } from '../../src/ui/units';

const CPCS: CpcSpeed[] = [
  { id: 'CPC1', suPerCpuSec: 64444.44 },
  { id: 'CPC2', suPerCpuSec: 27333.33 },
];

describe('resource-group unit conversions', () => {
  it('shows a type 1 SU/s limit as MSU and per-CPC CPs', () => {
    expect(rgLimitEquiv(100, CPCS)).toBe('≈ 0.36 MSU ≈ 0.0016 CP (CPC1) / 0.0037 CP (CPC2)');
    expect(rgLimitEquiv(100, CPCS.slice(0, 1))).toBe('≈ 0.36 MSU ≈ 0.0016 CP');
    expect(rgLimitEquiv(64444.44, CPCS.slice(0, 1))).toBe('≈ 232 MSU ≈ 1 CP');
  });

  it('shows MSU alone when no CPC is known, and nothing for a blank or invalid limit', () => {
    expect(rgLimitEquiv(100, [])).toBe('≈ 0.36 MSU');
    expect(rgLimitEquiv(null, CPCS)).toBeNull();
    expect(rgLimitEquiv(Number.NaN, CPCS)).toBeNull();
    expect(rgLimitEquiv(-1, CPCS)).toBeNull();
  });

  it('formats small and large approximate values without trailing zeros', () => {
    expect(fmtSuRate(0)).toBe('0');
    expect(fmtSuRate(0.0016)).toBe('0.0016');
    expect(fmtSuRate(0.36)).toBe('0.36');
    expect(fmtSuRate(1.2)).toBe('1.2');
    expect(fmtSuRate(12.4)).toBe('12');
    expect(fmtSuRate(232)).toBe('232');
    expect(fmtSuRate(0.001)).toBe('0.001');
    expect(fmtSuRate(1e-8)).toBe('0.00000001');
  });

  it('never renders tiny limits in exponent notation', () => {
    expect(rgLimitEquiv(0.001, CPCS)).not.toMatch(/e/);
    expect(rgLimitEquiv(0.001, CPCS)).toBe('≈ 0.0000036 MSU ≈ 0.000000016 CP (CPC1) / 0.000000037 CP (CPC2)');
  });
});
