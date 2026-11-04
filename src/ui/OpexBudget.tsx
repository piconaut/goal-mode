import { budgetDelta, BUDGET_MONTH_BOUNDARY_NOTE, R4HA_BILLING_NOTE } from '../game/budget';

const k$ = (x: number) => `$${Math.round(x / 1000).toLocaleString()}k`;

export function OpexBudget({ mlc, cod, budget, compact = false }: { mlc: number; cod: number; budget: number; compact?: boolean }) {
  const total = mlc + cod;
  const comparison = budgetDelta(total, budget);
  const explanation = 'Current software estimate plus CoD already charged. Future usage and charges may raise the bill.';

  if (compact) {
    return (
      <span className="stat" aria-label="Monthly budget estimate" title={`${explanation} ${R4HA_BILLING_NOTE} ${BUDGET_MONTH_BOUNDARY_NOTE}`} style={{ maxWidth: '100%' }}>
        <span>Software + CoD estimate</span>
        <b>{k$(total)} vs {k$(budget)} budget</b>
        <span>{comparison.compactLabel}{' · >25% at bill ends run'}</span>
      </span>
    );
  }

  return (
    <div className="card" aria-label="Monthly budget estimate" style={{ cursor: 'default', minWidth: 0 }}>
      <div className="muted">Software + CoD estimate</div>
      <div style={{ fontSize: 22, fontFamily: 'var(--mono)' }}>
        {k$(total)} <span className="muted" style={{ fontSize: 13 }}>vs {k$(budget)} budget</span>
      </div>
      <div>{comparison.label}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Software estimate {k$(mlc)} + CoD accrued {k$(cod)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{explanation}</div>
      <p style={{ fontSize: 12 }}>At monthly billing, each positive percentage point over budget costs one Finance trust point, up to 40 points.</p>
      <div>At billing: over 25% ends the run</div>
      <details style={{ marginTop: 8 }}>
        <summary>Billing clues and month-boundary timing</summary>
        <p className="help">{R4HA_BILLING_NOTE}</p>
        <p className="help">{BUDGET_MONTH_BOUNDARY_NOTE}</p>
      </details>
    </div>
  );
}
