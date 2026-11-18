// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { savePolicy } from '../../src/game/policies';
import { newRun } from '../../src/game/run';
import { buildView } from '../../src/game/view';
import { PolicySchedule } from '../../src/ui/changeDesk/Wlm';
import type { GameHandle } from '../../src/ui/useGame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('saved-policy controls', () => {
  it.each(['BRIEFING', 'LIVE', 'REVIEW'] as const)('previews activation costs and availability in %s', (phase) => {
    const initial = newRun(MIDWEST, { ...MIDWEST_GAME, events: [] }, 7);
    const run = { ...savePolicy(initial, { ...initial.sim.wlm.definition, policyName: 'NIGHTPOL' }).run, phase };
    const send = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      act(() => root.render(createElement(PolicySchedule, {
        v: buildView(run, MIDWEST), game: { send, pending: null } as unknown as GameHandle,
      })));
      const activate = container.querySelector<HTMLButtonElement>('[aria-label="Activate policy NIGHTPOL now"]')!;
      const load = container.querySelector<HTMLButtonElement>('[aria-label="Load policy NIGHTPOL into the editor"]')!;
      expect(activate.textContent).toContain('1.5h');
      expect(activate.disabled).toBe(phase === 'REVIEW');
      if (phase === 'LIVE') {
        expect(activate.textContent).toMatch(/EMERG .*trust each/);
        expect(activate.textContent).toContain('fail risk');
      }
      act(() => activate.click());
      if (phase === 'REVIEW') {
        expect(send).not.toHaveBeenCalled();
        expect(activate.title).not.toBe('');
      } else expect(send).toHaveBeenCalledWith({ type: 'ACTIVATE_SAVED_POLICY', name: 'NIGHTPOL' });
      act(() => load.click());
      expect(send).toHaveBeenLastCalledWith({ type: 'LOAD_SAVED_POLICY', name: 'NIGHTPOL' });
    } finally {
      act(() => root.unmount());
    }
  });
});
