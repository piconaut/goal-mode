// Reporting of the existing monthly budget check in run.ts; no billing state is changed here.
export function budgetDelta(total: number, budget: number) {
  if (!Number.isFinite(total) || !Number.isFinite(budget) || budget <= 0) {
    return { deltaPct: null, overLimit: false, label: 'Budget comparison unavailable', compactLabel: 'No budget comparison' };
  }
  const overFrac = total / budget - 1;
  const deltaPct = overFrac * 100;
  const overLimit = overFrac > 0.25;
  const percent = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
  const warning = overLimit ? ' (over limit)' : '';
  return { deltaPct, overLimit, label: `${percent} vs budget${warning}`, compactLabel: `${percent}${warning}` };
}

export const R4HA_BILLING_NOTE = "Sub-capacity MLC is priced on the month's peak R4HA to date, so a cap or saving lowers the bill only once it lowers that peak. Under TFP, usage is billed against the committed baseline instead.";
export const BUDGET_MONTH_BOUNDARY_NOTE = "At a month boundary, software cost resets at 00:00 but CoD settles at 06:00. Until then the estimate combines the new month's software cost with the closing month's CoD; that night's CoD fee is charged to the closing month.";
