// The prologue's spotlight (PRO-03, docs/prologue-design.md §6.1, §11.4): opens the target's tab and Change Desk
// section, scrolls the target into view, moves focus to it and outlines it with a label. Advisory only: the outline
// and the dimming never take a click.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Tab } from '../app/shortcuts';
import { anchorOf } from './anchors';

/** The anchor the spotlight shows: a step that waits for the player to open a tab points at that tab until it's open. */
export function spotlightTarget(target: string | null, opensTab: string | null, tab: Tab): string | null {
  if (opensTab && opensTab !== tab) return `tab.${opensTab}`;
  return target;
}

// Anchor ids are registry keys (letters, dots, colons, #), never quotes, so the selector needs no escaping.
const find = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`);

/** Open the target's Change Desk section (a closed `<details>` hides it). */
function openSection(section: string | undefined) {
  if (!section) return;
  const d = find(`changes.${section}`);
  if (d instanceof HTMLDetailsElement && !d.open) d.open = true;
}

export function Spotlight({ target, stepKey, tab, showTab }: { target: string | null; stepKey: string; tab: Tab; showTab: (t: Tab) => void }) {
  const anchor = target ? anchorOf(target) : null;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const focused = useRef('');
  const onTabBar = !!target?.startsWith('tab.');

  // The spotlight's own navigation is not the player's, so it goes through the plain tab setter (no TUTOR_NOTE).
  useEffect(() => {
    if (anchor && !onTabBar && anchor.tab !== tab) showTab(anchor.tab);
  }, [anchor, onTabBar, tab, showTab]);

  useLayoutEffect(() => {
    if (!target || !anchor) {
      setRect(null);
      return;
    }
    openSection(anchor.section);
    const key = `${stepKey}|${target}`;
    const el = find(target);
    if (el && focused.current !== key) {
      focused.current = key;
      el.scrollIntoView?.({ block: 'start' });
      if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    const update = () => {
      const e = find(target);
      setRect(e ? e.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    // Layout shifts (a report loading, a section opening) move the target without a scroll or resize.
    const timer = window.setInterval(update, 400);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.clearInterval(timer);
    };
  }, [target, anchor, stepKey, tab]);

  if (!anchor || !rect || rect.width === 0) return null;
  return (
    <div
      className="spotlight"
      aria-hidden="true"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      <span className={`spotlight-label${rect.top < 32 ? ' below' : ''}`}>▶ {anchor.label}</span>
    </div>
  );
}
