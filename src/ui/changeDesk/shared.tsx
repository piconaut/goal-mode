import { type ReactNode } from 'react';
import { previewChange, type ChangePreview } from '../../game/catalog';
import type { ConfigView, ViewModel } from '../../game/view';
import type { Command } from '../../sim/core/commands';

/** Everything a control needs to preview, stage or apply a change. */
export interface Desk {
  v: ViewModel;
  cfg: ConfigView;
  basket: Command[];
  apply: (label: string, commands: Command[]) => void;
  stage: (commands: Command[]) => void;
  /** Put a draft for one target into the change request, or drop it (null). */
  setDraft: (target: string, cmd: Command | null) => void;
  /** Report a field whose typed value is invalid (or null when it is fixed or gone), so the request can't be submitted past it. */
  setInvalid: (target: string, message: string | null) => void;
  invalid: Record<string, string>;
}

// Only the command kind matters for the hours estimate.
export const ACTIVATE_PREVIEW = [{ kind: 'ACTIVATE_POLICY' } as Command];

export const costText = (p: ChangePreview): string => {
  const parts = [`${p.hours}h`];
  if (p.capex) parts.push(`$${Math.round(p.capex / 1000)}k`);
  if (p.emergency && p.trustCostEach > 0) parts.push(`EMERG −${p.trustCostEach} trust each`);
  if (p.failRisk > 0) parts.push(`${(p.failRisk * 100).toFixed(0)}% fail risk`);
  return parts.join(' · ');
};

export const preview = (v: ViewModel, req: Parameters<typeof previewChange>[1]) => previewChange(v.previewCtx, req);

export const Now = ({ children }: { children: ReactNode }) => <span className="now">now {children}</span>;

export const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
