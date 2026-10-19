import { useEffect, useRef, useState } from 'react';
import { CODEX } from '../content/codex/entries';

/** "?" next to a panel title: the Codex entry for the concept, shown in place (SPEC §11.3). */
export function CodexHint({ id }: { id: string }) {
  const e = CODEX.find((x) => x.id === id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!e) return null;
  return (
    <span className="codex-hint" ref={ref}>
      <button
        type="button"
        aria-label={`Codex: ${e.title}`}
        title={`Codex: ${e.title}`}
        aria-expanded={open}
        onClick={(ev) => {
          // Inside a <summary> the click would also toggle the section.
          ev.preventDefault();
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open && (
        <span className="codex-card" role="dialog" aria-label={e.title} onClick={(ev) => ev.preventDefault()}>
          <b>{e.title}</b>
          <span className="codex-body">{e.body}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            Sources:{' '}
            {e.sources.map((s, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                    {s.label}
                  </a>
                ) : (
                  s.label
                )}
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** Hints for several concepts, e.g. after a section title. */
export const CodexHints = ({ ids }: { ids: string[] }) => (
  <>
    {ids.map((id) => (
      <CodexHint key={id} id={id} />
    ))}
  </>
);
