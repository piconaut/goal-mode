import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASEPOL } from '../../src/content/wlm/basepol';
import type { ViewModel } from '../../src/game/view';
import { cicsTransactionClasses, serviceClassGoalIssues } from '../../src/game/wlmEdit';
import type { ServiceDefinition } from '../../src/sim/wlm/types';
import { ServiceClasses } from '../../src/ui/ServiceClassEditor';
import type { GameHandle } from '../../src/ui/useGame';

const fields = (def: ServiceDefinition) => ({
  classDefs: def.classes, resourceGroups: def.resourceGroups,
  cicsClasses: cicsTransactionClasses(def), goalIssues: serviceClassGoalIssues(def),
});

describe('CICS transaction tag in the service-class editor', () => {
  it.each([
    { pending: false, cicsBad: false }, { pending: true, cicsBad: false },
    { pending: false, cicsBad: true }, { pending: true, cicsBad: true },
  ])('uses only CICS issues (pending: $pending, CICS issue: $cicsBad)', ({ pending, cicsBad }) => {
    const def = structuredClone(BASEPOL);
    const cics = def.subsystems.find((s) => s.subsystem === 'CICS')!;
    cics.defaultServiceClass = 'BATCHPRD';
    cics.rules = [];
    const cls = def.classes.find((c) => c.id === 'BATCHPRD')!;
    cls.periods = [{ goal: { kind: 'AVG', rtSec: 100 }, importance: 4, durationSu: cicsBad ? 100 : null }];
    if (cicsBad) cls.periods.push({ goal: { kind: 'AVG', rtSec: 200 }, importance: 4, durationSu: null });
    // Both subsystems use this class: JES always warns, CICS only on multiple periods.
    const v = { ...fields(pending ? BASEPOL : def), config: { cpcs: [] } } as unknown as ViewModel;
    const game = { pending: pending ? fields(def) : null, send: () => {} } as unknown as GameHandle;
    const html = renderToStaticMarkup(createElement(ServiceClasses, { v, game }));
    const tag = html.match(/<span class="([^"]*)" title="CICS transactions are classified into this class">/);
    expect(tag).not.toBeNull();
    expect(tag![1]!.split(' ').includes('bad')).toBe(cicsBad);
    expect(html).toContain('needs at least three completions per 20 minutes');
  });
});
