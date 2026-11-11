import { type Mon3Cpc, type Mon3View } from '../../game/mon3';
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
  const zos = cpcRows.filter((c) => c.kind === 'ZOS');
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
              <td className="num">{h.groupLimitMsu ?? ''}</td>
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
          </tr>
        </thead>
        <tbody>
          {(['ZOS', 'CF'] as const).map((kind) => {
            const part = cpcRows.filter((c) => c.kind === kind);
            if (part.length === 0) return null;
            const sum = (f: (c: Mon3Cpc) => number) => part.reduce((a, c) => a + f(c), 0);
            const anyPart = part[0];
            return [
              <tr key={kind}>
                <td>{kind === 'ZOS' ? '*CP' : '*ICF'}</td>
                <td />
                <td />
                <td className="num">{n1(sum((c) => c.procNum))}</td>
                <td />
                <td />
                <td className="num">{n1(sum((c) => c.physLparPct))}</td>
                <td className="num">{n1(sum((c) => c.physEffectPct))}</td>
                <td className="num">
                  {n1(sum((c) => c.physTotalPct))}
                  {kind === 'ZOS' && anyPart && (
                    <PinButton game={game} req={{ source: 'CPC', lparId: anyPart.lparId, metric: 'CPC_BUSY' }} label={`CPC ${anyPart.cpcId} busy`} />
                  )}
                </td>
              </tr>,
              ...part.map((c) => (
                <tr key={c.lparId}>
                  <td>{c.lparId}</td>
                  <td className="num">{c.kind === 'CF' ? '' : c.msuDef ?? 'N/A'}</td>
                  <td className="num">{c.msuAct === null ? '' : c.msuAct.toFixed(0)}</td>
                  <td className="num">{n1(c.procNum)}</td>
                  <td className="num">{n1(c.logicalEffectPct)}</td>
                  <td className="num">{n1(c.logicalTotalPct)}</td>
                  <td className="num">{n1(c.physLparPct)}</td>
                  <td className="num">{n1(c.physEffectPct)}</td>
                  <td className="num">{n1(c.physTotalPct)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">weight</th>
            <th>polarity</th>
            <th className="num" title="The image's CP engines as a share of its logical CPs">busy %</th>
            <th className="num" title="Not an RMF field: RMF shows it only indirectly, as Avg MVS Util% above Avg CPU Util% in SYSINFO">PR/SM delay %*</th>
            <th className="num">capped %</th>
          </tr>
        </thead>
        <tbody>
          {zos.map((c) => (
            <tr key={c.lparId}>
              <td>{c.lparId}</td>
              <td className="num">{c.weight}</td>
              <td>{c.polarity}</td>
              <td className="num">
                {c.busyPct.toFixed(1)}
                <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'LPAR_BUSY' }} label={`${c.lparId} busy`} />
              </td>
              <td className="num">
                {c.prsmDelayPct.toFixed(1)}
                <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'PRSM_DELAY' }} label={`${c.lparId} PR/SM delay`} />
              </td>
              <td className="num">
                {c.cappedPct.toFixed(0)}
                {c.cappedPct > 0 && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'CAPPED' }} label={`${c.lparId} capped`} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={ratio > 2 ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 4 }}>
        Logical:physical (shared z/OS CPs) {ratio.toFixed(2)}:1{ratio > 2 ? ', above the 2:1 rule of thumb' : ''}. *PR/SM delay is the game's direct reading of the short-engine wait; on a real system you infer it from MVS Util% above CPU Util%.
      </div>
    </>
  );
}
