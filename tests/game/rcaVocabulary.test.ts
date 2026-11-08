import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { REVENUE_EVENTS } from '../../src/content/events/revenue-events';
import { MECHANISM_HELP, TRIGGER_HELP } from '../../src/content/rca';
import { MECHANISMS, TRIGGERS } from '../../src/game/sla';

describe('RCA vocabulary', () => {
  it('defines every mechanism and trigger the form offers', () => {
    expect(Object.keys(MECHANISM_HELP).sort()).toEqual([...MECHANISMS].sort());
    expect(Object.keys(TRIGGER_HELP).sort()).toEqual([...TRIGGERS].sort());
    for (const text of [...Object.values(MECHANISM_HELP), ...Object.values(TRIGGER_HELP)]) {
      expect(text.trim().length).toBeGreaterThan(20);
    }
  });

  it('labels the CICS program storage leak as a software defect, not a policy choice', () => {
    for (const events of [MIDWEST_EVENTS, REVENUE_EVENTS]) {
      expect(events.find((e) => e.id === 'CICS_SOS')?.trigger).toBe('APPLICATION_ERROR');
    }
  });
});
