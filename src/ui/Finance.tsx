import { useEffect } from 'react';
import type { ViewModel } from '../game/view';
import { LineChart, type Series } from './LineChart';
import type { GameHandle } from './useGame';

const k$ = (x: number) => `$${Math.round(x / 1000).toLocaleString()}k`;

/** Software cost: the month's sub-capacity bill as SCRT computes it, and what drives it. */
export function Finance({ v, game }: { v: ViewModel; game: GameHandle }) {
  const hour = Math.floor(v.tickOfDay / 360);
  useEffect(() => {
    game.send({ type: 'GET_FINANCE' });
  }, [game, hour, v.day]);
  const f = game.finance;
  if (!f) return <div className="panel">Loading…</div>;
  const overTarget = f.cfoTarget !== null && f.monthToDate > f.cfoTarget;
  const zos = f.products[0];
  // The products move together (same LPARs, same R4HAs); chart the largest and keep the rest in the table.
  const series: Series[] = zos ? [{ id: zos.name, color: 'var(--series-1)', values: f.hourly.series[zos.id] ?? [] }] : [];
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel">
        <h3>Software cost: month {f.month + 1}</h3>
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="card" style={{ cursor: 'default' }}>
            <div className="muted">MLC month to date</div>
            <div style={{ fontSize: 22, fontFamily: 'var(--mono)' }}>{k$(f.monthToDate)}</div>
            <div className="muted" style={{ fontSize: 12 }}>at the peaks so far; a higher peak later raises it</div>
          </div>
          {f.cfoTarget !== null && (
            <div className="card" style={{ cursor: 'default', borderColor: overTarget ? 'var(--crit)' : 'var(--good)' }}>
              <div className="muted">CFO target (−10% vs last bill)</div>
              <div style={{ fontSize: 22, fontFamily: 'var(--mono)' }}>{k$(f.cfoTarget)}</div>
              <div className={`tag ${overTarget ? 'bad' : 'good'}`}>{overTarget ? `over by ${k$(f.monthToDate - f.cfoTarget)}` : 'on track'}</div>
            </div>
          )}
          <div className="card" style={{ cursor: 'default' }}>
            <div className="muted">Opex this month</div>
            <div style={{ fontSize: 22, fontFamily: 'var(--mono)' }}>
              {k$(f.opexSpent)} <span className="muted" style={{ fontSize: 13 }}>of {k$(f.opexBudget)}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>CoD and other temporary charges</div>
          </div>
        </div>
        <div className="help" style={{ marginTop: 8 }}>
          Each product is billed on its highest hourly sum of R4HA across the LPARs it runs on (defined capacity limits the R4HA, as SCRT does). Lowering the peak hour lowers the
          bill even if the day&apos;s total work is unchanged. Prices are fictional.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">peak MSU</th>
                <th>peak hour (ending)</th>
                <th>by LPAR at the peak</th>
                <th className="num">charge</th>
              </tr>
            </thead>
            <tbody>
              {f.products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{p.peakMsu.toFixed(0)}</td>
                  <td>{p.peakAt ?? '-'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {Object.keys(p.peakByLpar)
                      .sort()
                      .map((l) => `${l} ${p.peakByLpar[l]!.toFixed(0)}`)
                      .join(' · ') || '-'}
                  </td>
                  <td className="num">{k$(p.charge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h3>{zos?.name ?? 'Product'} MSU by hour this month</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          Sum of the LPARs&apos; R4HA each hour. The bill uses the highest point; batch nights can set it.
        </div>
        <div style={{ maxWidth: 820 }}>
        <LineChart title="Hourly product MSU" unit="MSU" xLabels={f.hourly.labels} series={series} reference={zos && zos.peakMsu > 0 ? { value: zos.peakMsu, label: `${zos.name} peak ${zos.peakMsu.toFixed(0)}` } : undefined} emptyText="Collecting hourly samples…" />
        </div>
      </div>
      <div className="panel">
        <h3>Bills</h3>
        {f.bills.length === 0 ? (
          <div className="muted">No bill yet: the first arrives at the end of month 1.</div>
        ) : (
          <table>
            <tbody>
              {f.bills.map((b) => (
                <tr key={b.month}>
                  <td>Month {b.month + 1}</td>
                  <td className="num">{k$(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details>
          <summary>SCRT-style report (month to date)</summary>
          <div className="green">{f.scrt}</div>
        </details>
      </div>
    </div>
  );
}
