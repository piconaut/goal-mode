import type { Mon3View } from '../../game/mon3';
import { PinButton } from '../Evidence';
import type { GameHandle } from '../useGame';
import { n1 } from './shared';

export function Cpc({ m, system, game }: { m: Mon3View; system: string; game: GameHandle | null }) {
  const ids = [...new Set(m.cpc.map((c) => c.cpcId))];
  if (ids.length <= 1) return <CpcTables m={m} system={system} game={game} cpcId={null} />;
  return (
    <>
      {ids.map((id) => (
        <section key={id} style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 4px' }}>CPC {id}</h4>
          <CpcTables m={m} system={system} game={game} cpcId={id} />
        </section>
      ))}
    </>
  );
}

function CpcTables({ m, system, game, cpcId }: { m: Mon3View; system: string; game: GameHandle | null; cpcId: string | null }) {
  const inCpc = (x: { cpcId: string }) => cpcId === null || x.cpcId === cpcId;
  const heads = m.cpcHeaders.filter((h) => inCpc(h) && (system === '*PLEX' || h.lparId === system));
  const cpcRows = m.cpc.filter(inCpc);
  const ratio = cpcId === null ? m.logicalToPhysical : m.logicalToPhysicalByCpc[cpcId] ?? 0;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">CPC Capacity</th>
            <th className="num">Image Capacity</th>
            <th className="num">WLM Capping %</th>
            <th className="num">4h Avg</th>
            <th className="num">4h Max</th>
            <th>Group</th>
            <th className="num">Limit</th>
            <th className="num">Available</th>
          </tr>
        </thead>
        <tbody>
          {heads.map((h) => (
            <tr key={h.lparId}>
              <td>{h.lparId}</td>
              <td className="num">{h.cpcCapacityMsu.toFixed(0)}</td>
              <td className="num">{h.imageCapacityMsu.toFixed(0)}</td>
              <td className="num">{n1(h.wlmCappingPct)}</td>
              <td className="num">{h.r4haMsu.toFixed(0)}</td>
              <td className="num">{h.max4hMsu.toFixed(0)}</td>
              <td>{h.group ?? 'N/A'}</td>
              <td className="num">{h.groupLimitMsu !== null ? `${h.groupLimitMsu}${h.groupLimitNew ? '*' : ''}` : ''}</td>
              <td className="num">{h.groupAvailableMsu !== undefined ? h.groupAvailableMsu.toFixed(0) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cpcRows.some((c) => c.kind === 'ZOS') && (() => {
        const first = cpcRows.find((c) => c.kind === 'ZOS')!;
        const adj = first.capacityAdjPct ?? 0;
        return (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            CPC {first.cpcId}: capacity adjusted {adj.toFixed(1)} %
            <PinButton game={game} req={{ source: 'CPC', lparId: first.lparId, metric: 'CAPACITY_ADJ' }} label={`CPC ${first.cpcId} capacity adjusted`} />
          </div>
        );
      })()}
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">MSU Def</th>
            <th className="num">MSU Act</th>
            <th className="num">Proc Num</th>
            <th className="num">Logical Util % Effect</th>
            <th className="num">Total</th>
            <th className="num">Physical Util % LPAR</th>
            <th className="num">Effect</th>
            <th className="num">Total</th>
            <th className="num" title="Not an RMF field: RMF shows it only indirectly, as Avg MVS Util% above Avg CPU Util% in SYSINFO">PR/SM delay %*</th>
            <th className="num">capped %</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            // RMF groups the partitions by processor type (p.97-98): *CP, *IIP and *ICF, each with its summary row,
            // its partitions and a PHYSICAL line for physical time no partition can claim.
            const groups = [
              { kind: 'CP' as const, label: '*CP', rows: cpcRows.filter((c) => c.kind === 'ZOS') },
              { kind: 'IIP' as const, label: '*IIP', rows: cpcRows.filter((c) => c.iip) },
              { kind: 'ICF' as const, label: '*ICF', rows: cpcRows.filter((c) => c.kind === 'CF') },
            ];
            const cpcOf = cpcRows[0]?.cpcId ?? '';
            return groups.flatMap((g) => {
              if (g.rows.length === 0) return [];
              const vals = g.rows.map((c) => (g.kind === 'IIP' ? c.iip! : c));
              const sum = (f: (v: (typeof vals)[number]) => number) => vals.reduce((a, v) => a + f(v), 0);
              const physical = m.cpcPhysical.find((x) => x.cpcId === cpcOf && x.kind === g.kind);
              return [
                <tr key={g.kind}>
                  <td>{g.label}</td>
                  <td />
                  <td />
                  <td className="num">{n1(sum((v) => v.procNum))}</td>
                  <td />
                  <td />
                  <td className="num">{n1(sum((v) => v.physLparPct))}</td>
                  <td className="num">{n1(sum((v) => v.physEffectPct))}</td>
                  <td className="num">
                    {n1(sum((v) => v.physTotalPct))}
                    {g.kind === 'CP' && (
                      <PinButton game={game} req={{ source: 'CPC', lparId: g.rows[0]!.lparId, metric: 'CPC_BUSY' }} label={`CPC ${g.rows[0]!.cpcId} busy`} />
                    )}
                  </td>
                  <td />
                  <td />
                </tr>,
                ...g.rows.map((c, i) => {
                  const v = vals[i]!;
                  return (
                    <tr key={`${g.kind}-${c.lparId}`}>
                      <td>{c.lparId}</td>
                      <td className="num">{g.kind === 'CP' ? c.msuDef ?? 'N/A' : ''}</td>
                      <td className="num">{g.kind === 'CP' && c.msuAct !== null ? c.msuAct.toFixed(0) : ''}</td>
                      <td className="num">{n1(v.procNum)}</td>
                      <td className="num">{n1(v.logicalEffectPct)}</td>
                      <td className="num">
                        {n1(v.logicalTotalPct)}
                        {g.kind === 'CP' && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'LPAR_BUSY' }} label={`${c.lparId} busy`} />}
                      </td>
                      <td className="num">{n1(v.physLparPct)}</td>
                      <td className="num">{n1(v.physEffectPct)}</td>
                      <td className="num">{n1(v.physTotalPct)}</td>
                      <td className="num">
                        {g.kind === 'CP' && (
                          <>
                            {v.prsmDelayPct.toFixed(1)}
                            <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'PRSM_DELAY' }} label={`${c.lparId} PR/SM delay`} />
                          </>
                        )}
                      </td>
                      <td className="num">
                        {g.kind === 'CP' && (
                          <>
                            {v.cappedPct.toFixed(0)}
                            {v.cappedPct > 0 && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'CAPPED' }} label={`${c.lparId} capped`} />}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                }),
                ...(physical
                  ? [
                      <tr key={`${g.kind}-PHYSICAL`}>
                        <td>PHYSICAL</td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td />
                        <td className="num">{n1(physical.physPct)}</td>
                        <td className="num">{n1(0)}</td>
                        <td className="num">{n1(physical.physPct)}</td>
                        <td />
                        <td />
                      </tr>,
                    ]
                  : []),
              ];
            });
          })()}
        </tbody>
      </table>
      <div className={ratio > 2 ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 4 }}>
        Logical:physical (shared z/OS CPs) {ratio.toFixed(2)}:1{ratio > 2 ? ', above the 2:1 rule of thumb' : ''}. *PR/SM delay is the game's direct reading of the short-engine wait; on a real system you infer it from MVS Util% above CPU Util%. PHYSICAL lines are 0.0: every busy engine-second is charged to a partition (APPROX).
      </div>
    </>
  );
}
