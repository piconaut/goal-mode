import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { REVENUE_EVENTS } from '../../src/content/events/revenue-events';
import { HARBOURLINE_EVENTS } from '../../src/content/events/harbourline-events';
import { MECHANISM_HELP, TRIGGER_HELP, TRIGGER_LABEL, triggerLabel } from '../../src/content/rca';
import { CODEX } from '../../src/content/codex/entries';
import { MECHANISMS, TRIGGERS } from '../../src/game/sla';

describe('RCA vocabulary', () => {
  it('defines every mechanism and trigger the form offers', () => {
    expect(Object.keys(MECHANISM_HELP).sort()).toEqual([...MECHANISMS].sort());
    expect(Object.keys(TRIGGER_HELP).sort()).toEqual([...TRIGGERS].sort());
    for (const text of [...Object.values(MECHANISM_HELP), ...Object.values(TRIGGER_HELP)]) {
      expect(text.trim().length).toBeGreaterThan(20);
    }
  });

  it('shows the renamed trigger and the policy trigger under the labels the user chose (RT-09)', () => {
    expect(TRIGGER_LABEL.CHANGE_REGRESSION).toBe('Change regression');
    expect(TRIGGER_LABEL.POLICY).toBe('Policy or configuration');
    expect(triggerLabel('CHANGE_REGRESSION')).toBe('Change regression');
    for (const t of TRIGGERS) expect(TRIGGER_LABEL[t], t).toBeTruthy();
  });

  it('moves the five change-made-work-cost-more cards to change regression (RT-09)', () => {
    const moved = ['ENCRYPTION_MANDATE', 'MONITOR_CREEP', 'QR_RELEASE', 'ZIIP_LOSS', 'SMF_AUDIT'];
    for (const events of [MIDWEST_EVENTS, REVENUE_EVENTS, HARBOURLINE_EVENTS])
      for (const e of events.filter((x) => moved.includes(x.id))) expect(e.trigger, `${e.id} in ${e.name}`).toBe('CHANGE_REGRESSION');
    // The list above must actually exist in the base pack, or this test would pass vacuously.
    for (const id of moved) expect(MIDWEST_EVENTS.some((e) => e.id === id), id).toBe(true);
    // The agency pack's own encryption card (an adapt of ENCRYPTION_MANDATE): an override must not leave it on POLICY.
    expect(REVENUE_EVENTS.find((e) => e.id === 'TAXDATA_ENCRYPTION')?.trigger).toBe('CHANGE_REGRESSION');
  });

  it('widens the STORAGE and CAPPING help as the audit asked', () => {
    expect(MECHANISM_HELP.STORAGE).toMatch(/subsystem ran short of its own storage/);
    expect(MECHANISM_HELP.CAPPING).toMatch(/image or the class/);
  });

  it('the Codex names only trigger ids the form offers (the retired one included in the check)', () => {
    // The audit found no Codex text that names the renamed trigger, so this is a guard, not a migration: a future
    // entry that writes an id the form no longer offers (or the retired one) fails here.
    const retired = ['ACCESS_PATH_REGRESSION'];
    const known = new Set<string>([...TRIGGERS, ...retired]);
    const named = CODEX.flatMap((e) => `${e.title} ${e.body}`.match(/[A-Z][A-Z_]{5,}/g) ?? []);
    for (const id of named) if (known.has(id)) expect(TRIGGERS, id).toContain(id);
    for (const e of CODEX) expect(`${e.title} ${e.body}`).not.toContain('ACCESS_PATH_REGRESSION');
  });

  it('labels the CICS program storage leak as a software defect, not a policy choice', () => {
    for (const events of [MIDWEST_EVENTS, REVENUE_EVENTS]) {
      expect(events.find((e) => e.id === 'CICS_SOS')?.trigger).toBe('APPLICATION_ERROR');
    }
  });
});
