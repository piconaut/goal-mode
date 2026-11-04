const k$ = (x: number) => `$${Math.round(x / 1000).toLocaleString()}k`;

export function OpexBudget({ mlc, cod, budget, compact = false }: { mlc: number; cod: number; budget: number; compact?: boolean }) {
  const total = mlc + cod;
  const deltaPct = budget > 0 ? ((total - budget) / budget) * 100 : null;
  const comparison = deltaPct === null ? 'Budget comparison unavailable' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs budget`;
  const explanation = 'Current software estimate plus CoD already charged. Future usage and charges may raise the bill.';

  if (compact) {
    return (
      <span className="stat" aria-label="Monthly budget estimate" title={explanation} style={{ maxWidth: '100%' }}>
        <span>MLC + CoD estimate</span>
        <b>{k$(total)} vs {k$(budget)} budget</b>
        <span>{comparison}</span>
        <span>At billing: over 25% ends the run</span>
      </span>
    );
  }

  return (
    <div className="card" aria-label="Monthly budget estimate" style={{ cursor: 'default', minWidth: 0 }}>
      <div className="muted">MLC + CoD estimate</div>
      <div style={{ fontSize: 22, fontFamily: 'var(--mono)' }}>
        {k$(total)} <span className="muted" style={{ fontSize: 13 }}>vs {k$(budget)} budget</span>
      </div>
      <div>{comparison}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>MLC estimate {k$(mlc)} + CoD accrued {k$(cod)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{explanation}</div>
      <p style={{ fontSize: 12 }}>At monthly billing, each positive percentage point over budget costs one Finance trust point, up to 40 points.</p>
      <div>At billing: over 25% ends the run</div>
    </div>
  );
}
