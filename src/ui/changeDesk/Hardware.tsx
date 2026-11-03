import { useState } from 'react';
import { HARDWARE } from '../../content/hardware-catalog';
import { validateDefinedCapacity, validateLogical, validateMemory, validateWeight } from '../../game/changeDesk';
import type { ViewModel } from '../../game/view';
import { entitlements, polarity } from '../../sim/hw/prsm';
import type { GameHandle } from '../useGame';
import { draftFor, DraftNumber } from './DraftControls';
import type { Desk } from './shared';
import { costText, preview } from './shared';

export function Prsm({ desk }: { desk: Desk }) {
  const zos = desk.cfg.lpars.filter((l) => l.kind === 'ZOS');
  const cpcIds = [...new Set(zos.map((x) => x.cpcId))];
  const [lpar, setLpar] = useState(zos[0]?.id ?? '');
  return (
    <>
      <div className="form">
        <label>
          LPAR{' '}
          <select value={lpar} onChange={(e) => setLpar(e.target.value)}>
            {cpcIds.length > 1
              ? cpcIds.map((id) => (
                  <optgroup key={id} label={`CPC ${id}`}>
                    {zos.filter((x) => x.cpcId === id).map((x) => (
                      <option key={x.id}>{x.id}</option>
                    ))}
                  </optgroup>
                ))
              : zos.map((x) => <option key={x.id}>{x.id}</option>)}
          </select>
        </label>
        <span className="muted">{desk.v.lpars.find((x) => x.id === lpar)?.polarity}</span>
      </div>
      <LparProfile key={`${lpar}:${JSON.stringify(desk.cfg.lpars.find((x) => x.id === lpar))}`} desk={desk} lparId={lpar} />
      <div className="help">
        Weight shares the shared pool under contention; HiperDispatch polarity follows entitlement. Logical CPs beyond online + reserved need an IPL. Defined capacity soft-caps the
        LPAR when its R4HA exceeds the limit.
      </div>
    </>
  );
}

function LparProfile({ desk, lparId }: { desk: Desk; lparId: string }) {
  const l = desk.cfg.lpars.find((x) => x.id === lparId);
  if (!l) return null;
  const draftWeight = draftFor(desk, `SET_WEIGHT:${lparId}:CP`);
  const draftLogical = draftFor(desk, `SET_LOGICAL:${lparId}:CP`);
  const weight = draftWeight?.kind === 'SET_WEIGHT' ? draftWeight.weight : l.weight;
  const logical = draftLogical?.kind === 'SET_LOGICAL' ? draftLogical.logical : l.cpLogical;
  return (
    <>
      <PolarityPreview v={desk.v} lpar={lparId} weight={weight} logical={logical} />
      <div style={{ overflowX: 'auto' }}>
        <table>
          <tbody>
            <tr>
              <td>CP weight</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} CP weight`}
                  live={l.weight}
                  size={4}
                  make={(n) => ({ kind: 'SET_WEIGHT', lparId, pool: 'CP', weight: n })}
                  read={(c) => (c.kind === 'SET_WEIGHT' ? c.weight : l.weight)}
                  validate={validateWeight}
                />
              </td>
              <td />
            </tr>
            <tr>
              <td>Logical CPs</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} logical CPs`}
                  live={l.cpLogical}
                  size={3}
                  make={(n) => ({ kind: 'SET_LOGICAL', lparId, pool: 'CP', logical: n })}
                  read={(c) => (c.kind === 'SET_LOGICAL' ? c.logical : l.cpLogical)}
                  validate={(n) => validateLogical(desk.cfg, lparId, 'CP', n)}
                />
              </td>
              <td className="muted">
                {l.cpLogical} online + {l.cpReserved} reserved
              </td>
            </tr>
            <tr>
              <td>Logical zIIPs</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} logical zIIPs`}
                  live={l.ziipLogical}
                  size={3}
                  make={(n) => ({ kind: 'SET_LOGICAL', lparId, pool: 'ZIIP', logical: n })}
                  read={(c) => (c.kind === 'SET_LOGICAL' ? c.logical : l.ziipLogical)}
                  validate={(n) => validateLogical(desk.cfg, lparId, 'ZIIP', n)}
                />
              </td>
              <td className="muted">
                {l.ziipLogical} online + {l.ziipReserved} reserved
              </td>
            </tr>
            <tr>
              <td>Defined capacity (MSU)</td>
              <td>
                <DraftNumber<number | null>
                  desk={desk}
                  label={`${lparId} defined capacity (MSU)`}
                  live={l.definedCapacity}
                  size={5}
                  blank="none"
                  make={(n) => ({ kind: 'SET_DEFINED_CAPACITY', lparId, msu: n })}
                  read={(c) => (c.kind === 'SET_DEFINED_CAPACITY' ? c.msu : l.definedCapacity)}
                  validate={validateDefinedCapacity}
                />
              </td>
              <td className="muted">blank = none</td>
            </tr>
            <tr>
              <td>Memory (GB)</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} memory (GB)`}
                  live={l.memoryGb}
                  size={5}
                  make={(n) => ({ kind: 'SET_LPAR_MEMORY', lparId, memoryGb: n })}
                  read={(c) => (c.kind === 'SET_LPAR_MEMORY' ? c.memoryGb : l.memoryGb)}
                  validate={(n) => validateMemory(desk.cfg, lparId, n)}
                />
              </td>
              <td className="muted">{desk.cfg.unassignedMemoryGb} GB unassigned</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Live HiperDispatch preview while editing a weight or logical count (SPEC §5.3.3). */
function PolarityPreview({ v, lpar, weight, logical }: { v: ViewModel; lpar: string; weight: number; logical: number }) {
  const shared = v.lpars.filter((l) => l.kind === 'ZOS');
  const claims = shared.map((l) => ({
    weight: l.id === lpar ? weight : l.weight,
    logical: l.id === lpar ? logical : l.logicalCps,
    demandEngines: 0,
    capEngines: Infinity,
  }));
  const ents = entitlements(claims, v.cpcEngines.CP);
  const totalLogical = claims.reduce((a, c) => a + c.logical, 0);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ margin: '6px 0' }}>
        <thead>
          <tr>
            <th>LPAR</th>
            <th className="num">weight</th>
            <th className="num">entitled CPs</th>
            <th>polarity (preview)</th>
          </tr>
        </thead>
        <tbody>
          {shared.map((l, i) => {
            const p = polarity(ents[i] ?? 0, claims[i]!.logical);
            const changed = l.id === lpar;
            return (
              <tr key={l.id} style={changed ? { color: 'var(--accent)' } : undefined}>
                <td>{l.id}</td>
                <td className="num">{claims[i]!.weight}</td>
                <td className="num">{(ents[i] ?? 0).toFixed(2)}</td>
                <td>
                  {p.vh}VH {p.vm}VM {p.vl}VL
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} className="muted" style={{ fontSize: 12 }}>
              Logical:physical {totalLogical}:{v.cpcEngines.CP} = {(totalLogical / v.cpcEngines.CP).toFixed(2)}
              {totalLogical / v.cpcEngines.CP > 2 ? ' (above the 2:1 rule of thumb)' : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Hardware({ v, game }: { v: ViewModel; game: GameHandle }) {
  const cpcs = v.previewCtx.cpcs ?? [];
  const [cpcId, setCpcId] = useState(cpcs[0]?.id ?? '');
  return (
    <>
      {cpcs.length > 1 && (
        <div className="row">
          <span>Engines, memory and capacity go on</span>
          <select value={cpcId} onChange={(e) => setCpcId(e.target.value)}>
            {cpcs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.generation}, setting {c.capacitySetting})
              </option>
            ))}
          </select>
        </div>
      )}
      {HARDWARE.map((h) => {
        const target = h.perCpc && cpcs.length > 1 ? cpcId : undefined;
        const p = preview(v, { hardwareId: h.id, ...(target ? { cpcId: target } : {}) });
        const label = target ? `${h.name} on ${target}` : h.name;
        return (
          <div className="row" key={h.id}>
            <span>
              {label}
              <div className="muted" style={{ fontSize: 12 }}>
                {h.description} {p.leadDays > 0 ? `Lead time ${p.leadDays} days.` : 'Immediate.'}
                {h.opexPerDay > 0 ? ` $${Math.round(h.opexPerDay / 1000)}k/day while active.` : ''}
              </div>
              {p.reason && <div className="err">{p.reason}</div>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? costText(p)} onClick={() => game.send({ type: 'CHANGE', req: { label, hardwareId: h.id, ...(target ? { cpcId: target } : {}) } })}>
              {p.capex > 0 ? `$${Math.round(p.capex / 1000)}k` : `$${Math.round(h.opexPerDay / 1000)}k/day`} · {p.hours}h
            </button>
          </div>
        );
      })}
    </>
  );
}
