import { useEffect, useState, type ReactNode } from 'react';
import { commandTarget } from '../../game/changeDesk';
import type { Command } from '../../sim/core/commands';
import type { Desk } from './shared';
import { num } from './shared';

export const draftFor = (desk: Desk, target: string): Command | undefined => desk.basket.find((c) => commandTarget(c) === target);

/**
 * "was <live value>" next to a drafted control. It is always rendered so table columns size for it up front and nothing
 * shifts when a draft starts; until then it is invisible and has no height (where a column is too narrow it wraps onto a
 * line of its own, which only takes room once the draft shows it).
 */
export const Was = ({ shown = true, children }: { shown?: boolean; children: ReactNode }) => (
  <span className={shown ? 'was' : 'was idle'} aria-hidden={!shown}>
    was {children}
  </span>
);

/**
 * One of a few values (or on/off). Picking a value drafts it into the change request; picking the live value again drops the
 * draft. Nothing is applied until the request is submitted, so the control needs no buttons or cost of its own.
 */
export function DraftChoice<T>({
  desk,
  live,
  options,
  make,
  read,
  label,
}: {
  desk: Desk;
  live: T;
  options: { value: T; text: string; disabled?: boolean }[];
  make: (value: T) => Command;
  read: (draft: Command) => T;
  label: string;
}) {
  const target = commandTarget(make(options[0]!.value));
  const d = draftFor(desk, target);
  const value = d ? read(d) : live;
  const liveText = options.find((o) => o.value === live)?.text;
  return (
    <span className={d ? 'seg drafted' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.text}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : undefined}
          disabled={o.disabled}
          onClick={() => desk.setDraft(target, o.value === live ? null : make(o.value))}
        >
          {o.text}
        </button>
      ))}
      {liveText && <Was shown={!!d}>{liveText}</Was>}
    </span>
  );
}

/** A number setting. A valid value that differs from the live one is drafted into the change request as you type. */
export function DraftNumber<T extends number | null = number>({
  desk,
  live,
  make,
  read,
  validate,
  label,
  size,
  format = String,
  blank,
}: {
  desk: Desk;
  live: T;
  make: (value: T) => Command;
  read: (draft: Command) => T;
  validate: (value: T) => string | null;
  label: string;
  size: number;
  format?: (value: T) => string;
  /** Placeholder when an empty field means "none" (null). */
  blank?: string;
}) {
  const target = commandTarget(make(live));
  const d = draftFor(desk, target);
  const show = (x: T) => (x === null ? '' : String(x));
  const parse = (t: string): T => (blank !== undefined && t.trim() === '' ? null : num(t)) as T;
  const [text, setText] = useState(show(d ? read(d) : live));
  const err = validate(parse(text));
  useEffect(() => {
    desk.setInvalid(target, err && `${label}: ${err}`);
    return () => desk.setInvalid(target, null);
  }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  // Submitted or cleared elsewhere: show the live value again.
  useEffect(() => {
    if (!d && !err && parse(text) !== live) setText(show(live));
  }, [d, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = (s: string) => {
    setText(s);
    const n = parse(s);
    desk.setDraft(target, validate(n) !== null || n === live ? null : make(n));
  };
  return (
    <span className={d ? 'draft drafted' : 'draft'}>
      <input aria-label={label} aria-invalid={err !== null} value={text} onChange={(e) => onChange(e.target.value)} size={size} inputMode="numeric" placeholder={blank} />
      <Was shown={!!d}>{live === null ? blank : format(live)}</Was>
      {err && <span className="err">{err}</span>}
    </span>
  );
}

/** A one-off action (not a setting): ticking it drafts it into the change request. */
export function DraftAction({ desk, command, disabled, label, title }: { desk: Desk; command: Command; disabled: boolean; label: string; title?: string }) {
  const target = commandTarget(command);
  const d = draftFor(desk, target);
  return (
    <label className={d ? 'draft-action drafted' : 'draft-action'} title={title}>
      <input type="checkbox" checked={!!d} disabled={disabled} onChange={(e) => desk.setDraft(target, e.target.checked ? command : null)} /> {label}
    </label>
  );
}

/**
 * A draft built from several fields (routing policy, routing shares, job class). Form state stays local; whenever it is
 * valid and differs from the live value its command is drafted, otherwise the draft is dropped.
 */
export function useDraftForm<S>(desk: Desk, target: string, label: string, init: (draft: Command | undefined) => S, build: (s: S) => { cmd: Command | null; error: string | null }) {
  const d = draftFor(desk, target);
  const [s, setS] = useState<S>(() => init(d));
  const { cmd, error } = build(s);
  useEffect(() => {
    desk.setInvalid(target, error && `${label}: ${error}`);
    return () => desk.setInvalid(target, null);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  // Submitted or cleared elsewhere: back to the live value.
  useEffect(() => {
    if (!d && !error && cmd) setS(init(undefined));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: S) => {
    setS(next);
    const b = build(next);
    desk.setDraft(target, b.error || !b.cmd ? null : b.cmd);
  };
  return { s, update, drafted: !!d, error };
}
