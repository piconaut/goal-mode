// @vitest-environment jsdom
// PRO-03 (docs/prologue-design.md §11.4, §11.5 anchor test): every step target names an anchor in the registry, and in
// each test step's own state the spotlight brings its anchor on screen and moves focus to it, whichever tab the
// player was on.
import { readFileSync } from 'node:fs';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PROLOGUE_SCENARIOS } from '../../src/content/packs';
import { PROLOGUE_REFERENCE } from '../../src/game/tutor/reference';
import { replayStates } from '../../src/game/tutor/replay';
import { tutorView } from '../../src/game/tutor/view';
import { buildView, type ViewModel } from '../../src/game/view';
import { Page, TabButtons } from '../../src/ui/app/Page';
import type { Tab } from '../../src/ui/app/shortcuts';
import { ANCHORS, anchorOf } from '../../src/ui/tutor/anchors';
import { Spotlight, spotlightTarget } from '../../src/ui/tutor/Spotlight';
import type { GameHandle } from '../../src/ui/useGame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pack = PROLOGUE_SCENARIOS['midwest-prologue']!;
const rules = pack.game.prologue!;
const steps = rules.chapters.flatMap((c) => c.beats.flatMap((b) => b.steps));
const game = { history: [], send: () => {}, setBasket: () => {} } as unknown as GameHandle;

/** The first state of the reference replay at which each targeted step is current. */
function stepStates(): Map<string, ViewModel> {
  const out = new Map<string, ViewModel>();
  for (const { run } of replayStates(PROLOGUE_REFERENCE)) {
    const s = tutorView(run, pack.game)?.step;
    if (s?.target && !out.has(s.id)) out.set(s.id, buildView(run, pack.scenario));
  }
  return out;
}

function Harness({ v, start }: { v: ViewModel; start: Tab }) {
  const [tab, setTab] = useState<Tab>(start);
  const s = v.tutor!.step!;
  return createElement(
    'div',
    null,
    createElement('div', { className: 'tabs' }, createElement(TabButtons, { v, tab, setTab })),
    createElement(Page, { v, game, tab, setTab }),
    createElement(Spotlight, { target: spotlightTarget(s.target, s.opensTab, tab), stepKey: s.id, tab, showTab: setTab }),
  );
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('prologue anchors (PRO-03)', () => {
  it('every step target names a registered anchor', () => {
    const missing = steps.filter((s) => s.target && !anchorOf(s.target)).map((s) => `${s.id} → ${s.target}`);
    expect(missing).toEqual([]);
  });

  it('every Change Desk section anchor is a Section id in the Change Desk', () => {
    const src = readFileSync('src/ui/Actions.tsx', 'utf8');
    const ids = new Set([...src.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]));
    const sections = Object.values(ANCHORS).flatMap((a) => (a.section ? [a.section] : []));
    expect(sections.filter((s) => !ids.has(s))).toEqual([]);
  });

  it('a target on another tab: the spotlight opens that tab itself', () => {
    const [, v] = [...stepStates()][0]!;
    const step = { ...v.tutor!.step!, opensTab: null };
    const nv = { ...v, tutor: { ...v.tutor!, step } };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    act(() => root.render(createElement(Harness, { v: nv, start: 'finance' })));
    act(() => {});
    const el = container.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    expect(el).not.toBeNull();
    expect(document.activeElement).toBe(el);
  });

  const states = stepStates();
  it('the reference log reaches every targeted step of the script', () => {
    expect([...states.keys()].sort()).toEqual(steps.filter((s) => s.target).map((s) => s.id).sort());
  });

  for (const [id, v] of states) {
    for (const start of ['console', 'finance'] as Tab[]) {
      it(`${id}: from the ${start} tab, the spotlight's anchor is on screen and focused`, () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        cleanup = () => {
          act(() => root.unmount());
          container.remove();
        };
        act(() => root.render(createElement(Harness, { v, start })));
        act(() => {});
        const s = v.tutor!.step!;
        // A step that waits for the player to open a tab points at that tab's button until it's open.
        const want = s.opensTab && s.opensTab !== start ? `tab.${s.opensTab}` : s.target!;
        const el = container.querySelector<HTMLElement>(`[data-tour="${want}"]`);
        expect(el, `[data-tour="${want}"]`).not.toBeNull();
        expect(el!.closest('details:not([open])')).toBeNull();
        expect(document.activeElement).toBe(el);
      });
    }
  }
});
