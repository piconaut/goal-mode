// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Mon3ProcJob, Mon3Row } from '../../src/game/mon3';
import { Procu } from '../../src/ui/monitor/WorkloadViews';
import type { GameHandle } from '../../src/ui/useGame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const send = vi.fn();
const game = { send } as unknown as GameHandle;
const row = { system: 'PROD1', scKey: 'DDF#1', cpuEngines: 0.8, iipcpEngines: 0.1, ziipEngines: 0.4, importance: 2 } as Mon3Row;
const job = { system: 'PROD1', jobname: 'DIST', serviceClass: 'DDF', cx: 'S', cpEngines: 0.3, iipcpEngines: 0.1, eapplCpEngines: 0.8, eapplZiipEngines: 0.4 } as Mon3ProcJob;
const mount = (jobs: Mon3ProcJob[] | null) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Procu, { rows: [row], jobs, game })));
};
const headings = () => [...container.querySelectorAll('th')].map((c) => c.textContent);
const cells = () => [...container.querySelectorAll('tbody tr:first-child td')].map((c) => c.firstChild?.textContent);
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  send.mockClear();
});

it('shows one class EAppl CP figure, its IIPCP subset and zIIP, retaining all evidence pins', () => {
  mount(null); // trimmed history has class rows but no job rows
  expect(headings()).toEqual(['Service Class', 'EAppl % CP', 'IIPCP %', 'EAppl % IIP', 'imp']);
  expect(cells()).toEqual(['DDF#1', '80.0', '10.0', '40.0', '2']);
  const pins = [...container.querySelectorAll<HTMLButtonElement>('button.pin')];
  for (const pin of pins) act(() => pin.click());
  expect(send.mock.calls.map(([msg]) => msg.req)).toEqual([
    { source: 'MON3', system: 'PROD1', scKey: 'DDF#1', metric: 'APPL_CP' },
    { source: 'MON3', system: 'PROD1', scKey: 'DDF#1', metric: 'APPL' },
    { source: 'MON3', system: 'PROD1', scKey: 'DDF#1', metric: 'IIPCP' },
    { source: 'MON3', system: 'PROD1', scKey: 'DDF#1', metric: 'APPL_IIP' },
  ]);
});

it('keeps the distinct job CP and EAppl columns when switching between jobs and classes', () => {
  mount([job]);
  const jobHeadings = ['Jobname', 'CX', 'Service Class', 'Time on CP % Total', 'IIP', 'EAppl % CP', 'IIP'];
  expect(headings()).toEqual(jobHeadings);
  expect(cells()).toEqual(['DIST', 'S', 'DDF', '30.0', '10.0', '80.0', '40.0']);
  const click = (label: string) => act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click());
  click('Service classes');
  expect(headings()).not.toContain('Time on CP % Total');
  expect(cells()).toEqual(['DDF#1', '80.0', '10.0', '40.0', '2']);
  click('Jobs');
  expect(headings()).toEqual(jobHeadings);
});
