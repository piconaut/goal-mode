// The prologue's target registry (PRO-03, docs/prologue-design.md §6.1, §11.4): a step's `target` names an anchor
// here, and the component it points at carries `data-tour="<id>"`. The spotlight opens the anchor's tab (and Change
// Desk section) before it looks for the element.
import type { Tab } from '../app/shortcuts';
import { TABS } from '../app/shortcuts';

export interface Anchor {
  tab: Tab;
  /** The Change Desk `Section` id to open first, if the target sits inside one. */
  section?: string;
  /** What the outline's label says. */
  label: string;
}

const TAB_LABELS: Record<Tab, string> = {
  console: 'Ops Console', monitor: 'Monitor III', reports: 'RMF Reports', changes: 'Change Desk',
  finance: 'Finance', analytics: 'Analytics', codex: 'Codex', inbox: 'Inbox',
};

/** The Change Desk sections (their `Section` ids in `Actions.tsx`). */
const SECTIONS: Record<string, string> = {
  wlm: 'WLM policy', policies: 'WLM service policies', hmc: 'HMC: LPAR image profile', hardware: 'Hardware orders',
  cf: 'Coupling facilities', systems: 'z/OS options', dasd: 'DASD', mq: 'MQ', db2: 'Db2', cics: 'CICS regions',
  ops: 'Operations', routing: 'Routing and batch initiators', projects: 'Projects',
};

export const ANCHORS: Record<string, Anchor> = {
  ...Object.fromEntries(TABS.map((t) => [`tab.${t}`, { tab: t, label: TAB_LABELS[t] }])),
  ...Object.fromEntries(Object.entries(SECTIONS).map(([id, label]) => [`changes.${id}`, { tab: 'changes' as Tab, section: id, label }])),
  'console.pi-heatmap': { tab: 'console', label: 'PI heat map' },
};

/** The anchor a target names. A parameterised target (`reports.wlmgl.row:ONLHI#1`) falls back to its prefix's. */
export function anchorOf(target: string): Anchor | null {
  return ANCHORS[target] ?? ANCHORS[target.split(':')[0]!] ?? null;
}
