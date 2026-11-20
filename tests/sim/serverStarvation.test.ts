import { describe, expect, it } from 'vitest';
import { SERVER_STARVATION } from '../../src/content/wlm/tuning';
import { starvedShare } from '../../src/sim/core/tick/demand';

// RF-09: a server role whose CPU a cap withheld, and which got less than the starvation threshold of its demand,
// carries only its granted share of its dependents' work.
describe('server starvation', () => {
  const roles = [{ role: 'DB2.MSTR' }, { role: 'DB2.DBM1' }];

  it('leaves a dependent at its full rate while every server has its demand', () => {
    expect(starvedShare(roles, { 'DB2.MSTR': { health: 1, capped: true }, 'DB2.DBM1': { health: 0.9, capped: true } })).toBe(1);
  });

  it('carries dependents at the starved role’s granted share', () => {
    expect(starvedShare(roles, { 'DB2.MSTR': { health: 0.02, capped: true }, 'DB2.DBM1': { health: 1, capped: false } })).toBeCloseTo(0.02);
    // The worst role decides: a request needs every server in its chain.
    expect(starvedShare(roles, { 'DB2.MSTR': { health: 0.02, capped: true }, 'DB2.DBM1': { health: 0.005, capped: true } })).toBeCloseTo(0.005);
  });

  it('keeps the bounded-delay form just above the threshold', () => {
    const justAbove = SERVER_STARVATION.healthBelow + 0.01;
    expect(starvedShare(roles, { 'DB2.MSTR': { health: justAbove, capped: true }, 'DB2.DBM1': { health: 1, capped: false } })).toBe(1);
    expect(starvedShare(roles, { 'DB2.MSTR': { health: SERVER_STARVATION.healthBelow, capped: true }, 'DB2.DBM1': { health: 1, capped: false } })).toBe(1);
  });

  it('keeps the delay form for an image-wide shortage, which takes the dependents’ own CPU too', () => {
    expect(starvedShare(roles, { 'DB2.MSTR': { health: 0.01, capped: false }, 'DB2.DBM1': { health: 0.2, capped: false } })).toBe(1);
  });

  it('ignores roles the image did not report, and workloads with no servers', () => {
    expect(starvedShare([{ role: 'CICS.AOR' }], { 'DB2.MSTR': { health: 0.01, capped: true } })).toBe(1);
    expect(starvedShare([], { 'DB2.MSTR': { health: 0.01, capped: true } })).toBe(1);
    expect(starvedShare(undefined, { 'DB2.MSTR': { health: 0.01, capped: true } })).toBe(1);
    expect(starvedShare(roles, undefined)).toBe(1);
  });
});
