// @vitest-environment jsdom
// The slow-TSO surcharge in the UI (PT-50): the Change Desk banner names the response time, the goal and the cost,
// and an operation's button text carries the multiplier.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { previewChange } from '../../src/game/catalog';
import { newRun } from '../../src/game/run';
import type { RunState, SmfHour } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { SlowTsoBanner } from '../../src/ui/changeDesk/Requests';
import { costText } from '../../src/ui/changeDesk/shared';
import type { Command } from '../../src/sim/core/commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const content = { ...MIDWEST_GAME, events: [] };
const missed = (day: number, hourOfDay: number, rtSec: number): SmfHour => ({
  day,
  hourOfDay,
  workloads: { TSO: { completions: 1000, withinSla: 1000, failed: 0, rtSumSec: rtSec * 1000, parts: {} } },
});
const weight: Command = { kind: 'SET_WEIGHT', lparId: 'PROD1', pool: 'CP', weight: 500 };
const slowRun = (): RunState => ({ ...newRun(MIDWEST, content, 7), smfHours: [missed(0, 10, 1.2), missed(0, 11, 1.3)] });

describe('slow-TSO surcharge in the UI (PT-50)', () => {
  it('shows the banner with the response time, the goal and the multiplier', () => {
    const v = buildView(slowRun(), MIDWEST);
    expect(v.previewCtx.staffSurcharge).toMatchObject({ mult: 1.5, rtSec: 1.3, goalSec: 0.5, missedHours: 2 });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(SlowTsoBanner, { v })));
      const text = container.textContent ?? '';
      expect(text).toContain('SLOW TSO');
      expect(text).toContain('1.30 s');
      expect(text).toContain('0.50 s');
      expect(text).toContain('1.5×');
      expect(text).toContain('WLMGL');
    } finally {
      act(() => root.unmount());
    }
  });

  it('prices a change at 1.5x and names the surcharge beside the cost', () => {
    const v = buildView(slowRun(), MIDWEST);
    const p = previewChange(v.previewCtx, { commands: [weight] });
    expect(p.hours).toBeCloseTo(0.75);
    expect(costText(p)).toContain('0.75h');
    expect(costText(p)).toContain('1.5× slow TSO');
    // No episode, no surcharge: the same change reads its base cost.
    const quiet = buildView(newRun(MIDWEST, content, 7), MIDWEST);
    expect(costText(previewChange(quiet.previewCtx, { commands: [weight] }))).not.toContain('slow TSO');
    expect(previewChange(quiet.previewCtx, { commands: [weight] }).hours).toBeCloseTo(0.5);
  });
});
