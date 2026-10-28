import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CODEX } from '../content/codex/entries';

/** Short name shown on the "?" pill; the Codex entry title is the fallback. */
const HINT_LABEL: Record<string, string> = {
  'service-class': 'service classes',
  importance: 'importance',
  'perf-index': 'PI',
  velocity: 'velocity',
  'delay-other': 'OTH delay',
  classification: 'classification',
  'system-classes': 'SYSOTHER',
  'policy-adjustment': 'policy adjustment',
  'blocked-workload': 'blocked workload',
  'cics-region-mode': 'region mode',
  'cics-transaction-goals': 'CICS goals',
  'cf-failure': 'CF failure',
  'swap-mpl': 'MPL delay',
  'mq-queues': 'MAXDEPTH',
  'io-priority': 'I/O priority',
  'resource-groups': 'resource groups',
  'report-classes': 'report classes',
  'service-policies': 'service policies',
  'lpar-weights': 'weights',
  hiperdispatch: 'polarity',
  'logical-physical': 'L:P ratio',
  r4ha: 'R4HA',
  mlc: 'MLC',
  tfp: 'TFP',
  ziip: 'zIIP',
  'ziip-eligibility': 'zIIP eligibility',
  'cics-sos': 'MXT and SOS',
  cod: 'CoD',
  'cf-sync-async': 'CF requests',
  hyperpav: 'HyperPAV',
  'qr-tcb': 'QR TCB',
  'db2-velocity': 'Db2 goals',
  rmf: 'RMF',
  'smf-volume': 'SMF volume',
  smf113: 'SMF 113',
  'sd-wlm-weights': 'SD weights',
  'cpsm-routing': 'CPSM routing',
  'storm-drain': 'storm drain',
  'absolute-capping': 'absolute capping',
  'arrival-bursts': 'bursts',
};

/** "? label" next to a panel title: the Codex entry for the concept, shown in place (SPEC §11.3). */
export function CodexHint({ id }: { id: string }) {
  const e = CODEX.find((x) => x.id === id);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !ref.current?.contains(ev.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);
  // Keep the card inside the viewport: clamp horizontally, flip above the "?" if it would run off the bottom.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const btn = ref.current?.querySelector('button')?.getBoundingClientRect();
    const c = card.current?.getBoundingClientRect();
    if (!btn || !c) return;
    const gutter = 8;
    const left = Math.max(gutter, Math.min(btn.left, window.innerWidth - c.width - gutter));
    const below = btn.bottom + 4;
    const top = below + c.height > window.innerHeight - gutter && btn.top - 4 - c.height >= gutter ? btn.top - 4 - c.height : below;
    setPos({ left, top });
  }, [open]);
  if (!e) return null;
  const label = HINT_LABEL[id] ?? e.title;
  return (
    <span className="codex-hint" ref={ref}>
      <button
        type="button"
        aria-label={`${label}: Codex entry, ${e.title}`}
        title={`Codex: ${e.title}`}
        aria-expanded={open}
        onClick={(ev) => {
          // Inside a <summary> the click would also toggle the section.
          ev.preventDefault();
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">?</span> {label}
      </button>
      {open && (
        <span
          className="codex-card"
          ref={card}
          role="dialog"
          aria-label={e.title}
          style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
          onClick={(ev) => ev.preventDefault()}
        >
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
  <span className="hints">
    {ids.map((id) => (
      <CodexHint key={id} id={id} />
    ))}
  </span>
);
