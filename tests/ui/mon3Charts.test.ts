// @vitest-environment jsdom
// PT-15: the chart picker hides and shows every chart, keeps the choice per viewer, and falls back to the
// default set when storage is blocked; the CP busy chart says what each line is measured against.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewModel } from '../../src/game/view';
import {
  CHARTS,
  DEFAULT_CHART_SELECTION,
  Mon3Charts,
  parseChartSelection,
} from '../../src/ui/Mon3Charts';
import type { GameHandle } from '../../src/ui/useGame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHART_KEY = 'goalmode.mon3charts.shown';
const sample = (tick: number) => ({
  tick,
  cpcBusyPct: 20,
  sys: { PROD1: { cpPct: 30, cpcPct: 12, ziipPct: 5, cappedPct: 0, prsmDelayPct: 1 } },
  pi: { 'ONLHI#1': 1.1 },
  rt: { 'ONLHI#1': 40 },
  rcRt: {},
  arr: { ONLHI: 3 },
  rcArr: {},
  delay: { 'ONLHI#1': { cpu: 2, ziip: 0, io: 1, cap: 0, other: 0 } },
  ddf: {},
  cpu: { 'ONLHI#1': 1.2, 'BATCHHI#1': 0.4 },
});
const v = { mon3Charts: { samples: 2, markers: 0, firstTick: 0 }, mon3: { rows: [] }, config: { cpcs: [{ id: 'CPC1' }] } } as unknown as ViewModel;
const game = { charts: { samples: [sample(0), sample(60)], markers: [] }, send: () => {} } as unknown as GameHandle;

let container: HTMLDivElement;
let root: Root;
const mount = (g: GameHandle = game, view = v) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Mon3Charts, { v: view, game: g, openAnalytics: () => {} })));
  return container;
};
const text = () => container.textContent ?? '';
const checkbox = (label: string): HTMLInputElement => {
  const found = [...container.querySelectorAll('label')].find((l) => l.textContent?.trim() === label);
  if (!found) throw new Error(`No checkbox ${label}`);
  return found.querySelector('input')!;
};
const click = (label: string) => act(() => checkbox(label).click());

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Monitor III chart picker', () => {
  it('lists every chart and defaults to the whole set except CPU by service class', () => {
    expect(new Set(CHARTS.map((c) => c.id)).size).toBe(CHARTS.length);
    expect(parseChartSelection(DEFAULT_CHART_SELECTION)).toEqual(CHARTS.map((c) => c.id).filter((id) => id !== 'svcCpu'));
    expect(parseChartSelection('')).toEqual([]);
    expect(parseChartSelection('busy,svcCpu,nope')).toEqual(['busy', 'svcCpu']);
    mount();
    expect(text()).toContain(`Charts (8/${CHARTS.length})`);
    expect(text()).toContain('Performance index');
    expect(text()).toContain('PROD1 (% of its logical CPs)');
    // The new chart is an ordinary picker entry, hidden until picked.
    expect(checkbox('CPU by service class')).toBeDefined();
    expect(text()).not.toContain('ONLHI#1 (engines)');
  });

  it('hides and shows every chart, and keeps the choice in localStorage', () => {
    mount();
    click('CPU by service class');
    expect(text()).toContain(`Charts (9/${CHARTS.length})`);
    expect(text()).toContain('ONLHI#1 (engines)');
    expect(localStorage.getItem(CHART_KEY)!.split(',')).toContain('svcCpu');
    click('Arrival rate');
    expect(text()).not.toContain('Transaction arrival rate');
    click('Arrival rate');
    expect(text()).toContain('Transaction arrival rate');
    // A fresh mount reads the stored selection (a reload keeps it).
    act(() => root.unmount());
    container.remove();
    mount();
    expect(text()).toContain(`Charts (9/${CHARTS.length})`);
    expect(text()).toContain('ONLHI#1 (engines)');
  });

  it('falls back to the default set when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mount();
    expect(text()).toContain(`Charts (8/${CHARTS.length})`);
    expect(text()).toContain('Performance index');
    expect(text()).not.toContain('ONLHI#1 (engines)');
    // Toggling still works; it just isn't remembered.
    click('CPU by service class');
    expect(text()).toContain('ONLHI#1 (engines)');
  });

  it('charts idle periods as zero and legacy samples as gaps', () => {
    // A save from the previous build keeps its samples; the newest one has no `cpu` map.
    const old = { ...sample(120) } as Record<string, unknown>;
    delete old.cpu;
    const idle = { ...sample(60), cpu: {} };
    mount({ charts: { samples: [sample(0), idle, old], markers: [] }, send: () => {} } as unknown as GameHandle);
    click('CPU by service class');
    expect(text()).toContain('ONLHI#1 (engines)');
    expect(text()).toContain('06:000.401.20');
    expect(text()).toContain('06:1000');
    expect(text()).toContain('06:20--'); // the legacy sample is a gap, not a crash
  });

  it('labels the CP busy lines and can plot every LPAR against the CPC', () => {
    mount();
    expect(text()).toContain('PROD1 (% of its logical CPs)');
    expect(text()).toContain('CPC (% of physical CPs)');
    const busyChart = container.querySelector('svg[aria-label^="CP busy"]')!.closest('.chart')!;
    expect(busyChart.querySelector('svg')?.textContent).not.toContain('(% of its logical CPs)');
    expect(busyChart.querySelector('tbody tr')?.children[1]?.textContent).toBe('30.0');
    click("% of its CPC (each LPAR against its own CPC's physical CPs)");
    expect(text()).toContain('PROD1 (% of its CPC)');
    expect(text()).toContain('CPC (% of physical CPs)');
    expect(busyChart.querySelector('tbody tr')?.children[1]?.textContent).toBe('12.0');
  });

  it('identifies the physical CP line as a combined figure on a multi-CPC run', () => {
    mount(game, { ...v, config: { ...v.config, cpcs: [...v.config.cpcs, { ...v.config.cpcs[0]!, id: 'CPC2' }] } });
    expect(text()).toContain('All CPCs (% of combined physical CPs)');
  });
});
