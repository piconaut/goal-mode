// @vitest-environment jsdom
// PR-26: the day report card renders the gateway protection modes and the DFSMShsm recall hold from the day report,
// and a report written before those fields existed still renders its SLA and batch lines.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { newRun } from '../../src/game/run';
import type { DayReport, Facet } from '../../src/game/types';
import { buildView, type ViewModel } from '../../src/game/view';
import { DaySummary } from '../../src/ui/overlays/DaySummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const content = { ...MIDWEST_GAME, events: [] };
const trustDelta = Object.fromEntries(['Retail', 'Cards', 'Digital', 'Payments', 'Finance', 'Regulator'].map((f) => [f, 0])) as Record<Facet, number>;

const report = (over: Partial<DayReport>): DayReport => ({
  day: 0,
  sla: [],
  batch: null,
  batchMissed: false,
  trustDelta,
  score: 10,
  mlcEstimate: 0,
  events: [],
  piWorst: {},
  ...over,
});

const view = (lastReport: DayReport): ViewModel => ({ ...buildView(newRun(MIDWEST, content, 7), MIDWEST), lastReport });

const render = (v: ViewModel): string => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(createElement(DaySummary, { v })));
    return container.textContent ?? '';
  } finally {
    act(() => root.unmount());
  }
};

describe('the day report card operation lines (PR-26)', () => {
  it('names a protected channel with its mode and the recall hold with its start and backlog', () => {
    const text = render(view(report({
      gateway: [{ id: 'MOBILE', name: 'Mobile app', mode: 'LIMIT' }],
      // 05:00 of the played day: after midnight, before the 06:00 close.
      recalls: { held: true, heldSinceTick: 8280, backlogIo: 216_000_000 },
    })));
    expect(text).toContain('Gateway · Mobile app');
    expect(text).toContain('Rate limit');
    expect(text).toContain('DFSMShsm recalls');
    expect(text).toContain('216,000,000 queued I/Os');
    expect(text).toContain('HELD since D1 05:00');
  });

  it('renders a released backlog, and nothing for a report written before the fields existed', () => {
    expect(render(view(report({ recalls: { held: false, heldSinceTick: null, backlogIo: 4_200 } }))))
      .toContain('released');
    const old = render(view(report({})));
    expect(old).toContain('Day 1 report card');
    expect(old).not.toContain('Gateway ·');
    expect(old).not.toContain('DFSMShsm recalls');
  });
});
