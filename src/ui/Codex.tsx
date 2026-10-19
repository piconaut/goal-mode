import { useEffect, useMemo, useState } from 'react';
import { CODEX } from '../content/codex/entries';
import type { ViewModel } from '../game/view';

const KEY = 'goalmode.codex.v1';
const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/** Entries known from earlier runs plus this one; remembered in the browser (career Codex, SPEC §11.3). */
export function useCodexKnown(v: ViewModel): { known: Set<string>; fresh: Set<string> } {
  const [stored] = useState(load);
  const key = v.codex.join(',');
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...new Set([...load(), ...v.codex])].sort()));
    } catch {
      // Private mode or blocked storage: the Codex still works for this run.
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({ known: new Set([...stored, ...v.codex]), fresh: new Set(v.codex.filter((id) => !stored.includes(id))) }), [stored, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Codex({ v }: { v: ViewModel }) {
  const { known, fresh } = useCodexKnown(v);
  const [q, setQ] = useState('');
  const shown = CODEX.filter((e) => known.has(e.id) && (!q || `${e.title} ${e.body}`.toLowerCase().includes(q.toLowerCase())));
  const cats = [...new Set(CODEX.map((e) => e.category))];
  return (
    <div className="panel">
      <h3>
        Codex ({known.size}/{CODEX.length} discovered)
      </h3>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        The real z/OS concepts behind the game, with sources. New entries appear as you buy tools, open reports and meet events, and stay discovered across runs.
      </p>
      <div className="form">
        <input aria-label="Search the Codex" placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} size={24} />
      </div>
      {cats.map((c) => {
        const items = shown.filter((e) => e.category === c);
        const locked = CODEX.filter((e) => e.category === c && !known.has(e.id)).length;
        if (!items.length && !locked) return null;
        return (
          <div key={c} style={{ marginTop: 10 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)' }}>
              {c}
              {locked > 0 && ` · ${locked} undiscovered`}
            </h4>
            {items.map((e) => (
              <details key={e.id} className="codex" open={!!q}>
                <summary>
                  {e.title} {fresh.has(e.id) && <span className="tag good">new</span>}
                </summary>
                <p style={{ margin: '4px 0' }}>{e.body}</p>
                <div className="muted" style={{ fontSize: 12 }}>
                  Sources:{' '}
                  {e.sources.map((s, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                    </span>
                  ))}
                </div>
              </details>
            ))}
          </div>
        );
      })}
    </div>
  );
}
