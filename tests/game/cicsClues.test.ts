// WLMGL reports CICS transactions' CPU service and state samples with the regions' classes (WLM Planning 3.1 p.113;
// RMF Report Analysis p.536–537), so an event clue must not send the player to APPL% or delay on a CICS
// transaction class row.
import { HARBOURLINE_EVENTS } from '../../src/content/events/harbourline-events';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { REVENUE_EVENTS } from '../../src/content/events/revenue-events';
import { SCENARIOS } from '../../src/content/scenarios';
import { classify } from '../../src/sim/wlm/classify';

const cases = [
  ['midwest', MIDWEST_EVENTS],
  ['harbourline', HARBOURLINE_EVENTS],
  ['revenue', REVENUE_EVENTS],
] as const;

describe('event clues and CICS transaction classes', () => {
  it.each(cases)('%s clues read CICS CPU from the region class, not the transaction class', (id, events) => {
    const sc = SCENARIOS[id]!;
    const cicsWork = sc.workloads.filter((w) => w.subsystem === 'CICS');
    const cics = new Set(cicsWork.map((w) => classify(sc.definition, w.work).serviceClass));
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(cics.size).toBeGreaterThan(0);
    for (const e of events) {
      const clue = (e as { clue?: string }).clue ?? '';
      for (const cls of cics) {
        // In the same clause: the class's APPL%, service or delay samples (WLMGL and Monitor III show none).
        expect(clue, `${e.id}: ${cls}`).not.toMatch(new RegExp(`\\b${cls}\\b[^.;:]*?(APPL%|service per|CPU delay|UNK delay|DELAY %)`));
        expect(clue, `${e.id}: ${cls}`).not.toMatch(new RegExp(`\\b${cls}\\b (service|APPL%)`));
      }
      // Workloads by name: their delays show on the regions, not on them.
      for (const w of cicsWork) expect(clue, `${e.id}: ${w.name}`).not.toMatch(new RegExp(`${esc(w.name)}[^.;]*?(CPU delay|UNK delay)`, 'i'));
    }
  });
});
