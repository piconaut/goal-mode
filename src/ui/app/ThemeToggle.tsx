// System, dark, light and 3270 green screen; styles.css keys the palette off `data-theme` on <html>.
// Split from `App.tsx` (CL-38).

import { useEffect } from 'react';
import { useStored } from '../useStored';

type Theme = 'system' | 'dark' | 'light' | '3270';
const NEXT_THEME: Record<Theme, Theme> = { system: 'dark', dark: 'light', light: '3270', '3270': 'system' };

/** System → dark → light → 3270 green screen; styles.css keys the palette off `data-theme` on <html>. */
export function ThemeToggle() {
  const [theme, setTheme] = useStored<Theme>('goalmode.theme', 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  return (
    <button title="Colour theme (click to change)" aria-label={`Theme: ${theme}`} onClick={() => setTheme(NEXT_THEME[theme])}>
      {theme === 'system' ? '◐ auto' : theme === 'dark' ? '● dark' : theme === 'light' ? '○ light' : '▮ 3270'}
    </button>
  );
}
