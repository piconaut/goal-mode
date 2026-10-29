import type { ReactNode } from 'react';

/** What a panel shows when it has nothing: one muted line, same style everywhere. */
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty muted">{children}</div>;

/** "Analytics tab" as a button that switches to that tab, for notes about locked views. */
export const AnalyticsLink = ({ open }: { open: () => void }) => (
  <button type="button" className="linkbtn" onClick={open}>
    Analytics tab
  </button>
);
