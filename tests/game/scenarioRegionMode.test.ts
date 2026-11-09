import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../src/content/scenarios';
import { classify } from '../../src/sim/wlm/classify';

// User decision 2026-11-05: Manage Region Using Goals Of stays at TRANSACTION (not a player lever), so every
// scenario must start with every CICS region managed as a transaction server.
describe('scenarios manage CICS regions using goals of TRANSACTION', () => {
  for (const [id, sc] of Object.entries(SCENARIOS)) {
    it(id, () => {
      expect(sc.definition.cicsRegionMode ?? 'TRANSACTION').toBe('TRANSACTION');
      const regions = sc.addressSpaces.filter((a) => a.role === 'CICS.AOR' || a.role === 'CICS.TOR');
      expect(regions.length).toBeGreaterThan(0);
      for (const a of regions) expect(classify(sc.definition, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId }).regionMode ?? 'TRANSACTION', a.jobname).toBe('TRANSACTION');
    });
  }
});
