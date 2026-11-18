// Tab keys and speeds: Space pauses, 1-5 set the speed, Alt+1-8 switch tabs. Split from `App.tsx` (CL-38).

import { useEffect, useRef } from 'react';
import type { GameHandle } from '../useGame';

export type Tab = 'console' | 'monitor' | 'reports' | 'changes' | 'finance' | 'analytics' | 'codex' | 'inbox';

export const TABS: Tab[] = ['console', 'monitor', 'reports', 'changes', 'finance', 'analytics', 'codex', 'inbox'];
const SPEEDS = [0.5, 1, 2, 4, 8];

/** Space: pause/resume · 1–5: speed ½×…8× · Alt+1–8: tabs. Ignored while typing in a field. */
export function useShortcuts(game: GameHandle, setTab: (t: Tab) => void) {
  const resume = useRef(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (e.altKey && n >= 1 && n <= TABS.length) {
        setTab(TABS[n - 1]!);
        e.preventDefault();
      } else if (!e.altKey && n >= 1 && n <= SPEEDS.length) {
        game.send({ type: 'SET_SPEED', speed: SPEEDS[n - 1]! });
      } else if (e.key === ' ' && game.view?.phase === 'LIVE' && el?.tagName !== 'BUTTON') {
        if (game.speed > 0) resume.current = game.speed;
        game.send({ type: 'SET_SPEED', speed: game.speed > 0 ? 0 : resume.current });
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [game, setTab]);
}
