// @vitest-environment jsdom
// The Problems card (RT-22): opening a record from the reports tab, filing a diagnosis, and the reply it renders.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { fileProblemDiagnosis, openProblemRecord } from '../../src/game/problems';
import { newRun } from '../../src/game/run';
import type { QuietHour, RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { Problems } from '../../src/ui/Problems';
import type { GameHandle } from '../../src/ui/useGame';
import { EMPTY_SUBJECTS, truthOf } from '../helpers/truth';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const content = { ...MIDWEST_GAME, events: [] };
const H = TICKS_PER_HOUR;
const fact = (): QuietHour => ({
  day: 0, hourOfDay: 6, startTick: 0, endTick: H, workloadId: 'RBANK', reason: 'CARD',
  truth: truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' }), subjects: EMPTY_SUBJECTS, attainmentPct: 100,
});
const base = (): RunState => {
  const r = newRun(MIDWEST, content, 7);
  return { ...r, sim: { ...r.sim, tick: 2 * H }, smfHours: [{ day: 0, hourOfDay: 6, workloads: {} }, { day: 0, hourOfDay: 7, workloads: {} }], quietHours: [fact()] };
};

function mount(run: RunState, send: (m: unknown) => void): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(createElement(Problems, { v: buildView(run, MIDWEST), game: { send } as unknown as GameHandle })));
  return { container, root };
}

describe('problem records in the UI (RT-22)', () => {
  it('opens a record with the default subject and the newest closed hour', () => {
    const send = vi.fn();
    const { container, root } = mount(base(), send);
    const open = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open record');
    expect(open).toBeDefined();
    act(() => open!.click());
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'OPEN_PROBLEM',
      subject: { kind: 'WORKLOAD', id: 'RBANK' },
      fromTick: H,
      toTick: 2 * H,
    }));
    act(() => root.unmount());
  });

  it('files from an open record and renders the reply', () => {
    const opened = openProblemRecord(base(), content, MIDWEST, { kind: 'WORKLOAD', id: 'RBANK' }, 0, H);
    expect(opened.ok).toBe(true);
    const send = vi.fn();
    const { container, root } = mount(opened.run, send);
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === 'File diagnosis');
    expect(submit).toBeDefined();
    act(() => submit!.click());
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'FILE_PROBLEM', recordId: opened.record!.id, mechanism: 'CPU_PRIORITY', trigger: 'POLICY',
    }));
    act(() => root.unmount());
  });

  it('renders a filed diagnosis and its reply', () => {
    const opened = openProblemRecord(base(), content, MIDWEST, { kind: 'WORKLOAD', id: 'RBANK' }, 0, H);
    const filed = fileProblemDiagnosis(opened.run, content, MIDWEST, opened.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(filed.ok, filed.message).toBe(true);
    const { container, root } = mount(filed.run, vi.fn());
    const text = container.textContent ?? '';
    expect(text).toContain('REC1');
    expect(text).toContain('Retail banking (RBANK)');
    expect(text).toContain('Mechanism CPU_PRIORITY accepted');
    expect(text).toContain('Trust +1 on Retail');
    expect(text).not.toContain('REGRESSION@0');
    act(() => root.unmount());
  });
});
