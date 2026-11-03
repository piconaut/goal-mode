import { useState } from 'react';
import { routingPolicyLabel, validateRouting } from '../../game/changeDesk';
import type { RoutingPolicy } from '../../sim/workload/routing';
import { useDraftForm, Was } from './DraftControls';
import type { Desk } from './shared';
import { Now, num } from './shared';

export function Routing({ desk }: { desk: Desk }) {
  const routed = desk.cfg.routing.filter((r) => Object.keys(r.shares).length > 1);
  const [wid, setWid] = useState(routed[0]?.workloadId ?? '');
  const r = routed.find((x) => x.workloadId === wid);
  return (
    <>
      <div className="form">
        <label>
          Routing for{' '}
          <select value={wid} onChange={(e) => setWid(e.target.value)}>
            {routed.map((x) => (
              <option key={x.workloadId} value={x.workloadId}>
                {x.workloadId} ({x.name})
              </option>
            ))}
          </select>
        </label>
      </div>
      {r && <RoutingPolicyEditor key={`${wid}:p:${JSON.stringify(r.policy)}`} desk={desk} workloadId={wid} lpars={Object.keys(r.shares).sort()} current={r.policy} />}
      {r && r.policy.method === 'STATIC' && <RoutingEditor key={`${wid}:${JSON.stringify(r.shares)}`} desk={desk} workloadId={wid} current={r.shares} />}
      <div className="help">
        Static: fixed share of arriving work per LPAR (must add up to 100%). WLM weights: Sysplex Distributor follows each system's idle CP capacity
        (BASEWLM), or each server's capacity at the work's importance, CP and zIIP (SERVERWLM). CPSM goal: CICSPlex SM routes by each region's response time; set ABENDTHRESH/ABENDCRIT so a
        region that fails fast is not mistaken for a fast one, and quiesce a region to drain it.
      </div>
    </>
  );
}

function RoutingPolicyEditor({ desk, workloadId, lpars, current }: { desk: Desk; workloadId: string; lpars: string[]; current: RoutingPolicy }) {
  type Form = { method: RoutingPolicy['method']; distMethod: 'BASEWLM' | 'SERVERWLM'; thresh: string; crit: string; quiesced: string[] };
  const pct = (f: number | null | undefined) => (f != null ? String(Math.round(f * 100)) : '');
  const frac = (v: string) => (v.trim() === '' ? null : num(v) / 100);
  const bad = (v: string) => v.trim() !== '' && !(num(v) > 0 && num(v) <= 100);
  const { s: f, update, drafted, error } = useDraftForm<Form>(
    desk,
    `SET_ROUTING_POLICY:${workloadId}`,
    `${workloadId} routing policy`,
    (d) => {
      const p = d?.kind === 'SET_ROUTING_POLICY' ? d.policy : current;
      const cpsm = p.method === 'CPSM_GOAL' ? p : null;
      return { method: p.method, distMethod: p.method === 'WLM' ? p.distMethod : 'SERVERWLM', thresh: pct(cpsm?.abendThreshFrac), crit: pct(cpsm?.abendCritFrac), quiesced: cpsm?.quiesced ?? [] };
    },
    (f) => {
      const policy: RoutingPolicy =
        f.method === 'STATIC'
          ? { method: f.method }
          : f.method === 'WLM'
            ? { method: f.method, distMethod: f.distMethod }
            : { method: f.method, abendThreshFrac: frac(f.thresh), abendCritFrac: frac(f.crit), quiesced: [...f.quiesced].sort() };
      const error =
        f.method === 'CPSM_GOAL' && (bad(f.thresh) || bad(f.crit)) ? 'Abend limits are 1–100%' : f.method === 'CPSM_GOAL' && f.quiesced.length >= lpars.length ? 'Leave at least one region open' : null;
      return { cmd: JSON.stringify(policy) === JSON.stringify(current) ? null : { kind: 'SET_ROUTING_POLICY', workloadId, policy }, error };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      <select aria-label="Routing method" value={f.method} onChange={(e) => update({ ...f, method: e.target.value as RoutingPolicy['method'] })}>
        <option value="STATIC">Static weights</option>
        <option value="WLM">WLM weights (Sysplex Distributor)</option>
        <option value="CPSM_GOAL">CPSM goal routing</option>
      </select>
      {f.method === 'WLM' && (
        <select aria-label="DISTMETHOD" value={f.distMethod} onChange={(e) => update({ ...f, distMethod: e.target.value as 'BASEWLM' | 'SERVERWLM' })}>
          <option value="BASEWLM">BASEWLM (system CP capacity)</option>
          <option value="SERVERWLM">SERVERWLM (server, CP + zIIP)</option>
        </select>
      )}
      {f.method === 'CPSM_GOAL' && (
        <>
          <label>
            ABENDTHRESH <input value={f.thresh} onChange={(e) => update({ ...f, thresh: e.target.value })} size={3} inputMode="numeric" placeholder="off" />%
          </label>
          <label>
            ABENDCRIT <input value={f.crit} onChange={(e) => update({ ...f, crit: e.target.value })} size={3} inputMode="numeric" placeholder="off" />%
          </label>
          {lpars.map((l) => (
            <label key={l}>
              <input type="checkbox" checked={f.quiesced.includes(l)} onChange={(e) => update({ ...f, quiesced: e.target.checked ? [...f.quiesced, l] : f.quiesced.filter((x) => x !== l) })} /> quiesce {l}
            </label>
          ))}
        </>
      )}
      {drafted ? <Was>{routingPolicyLabel(current)}</Was> : <Now>{routingPolicyLabel(current)}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

function RoutingEditor({ desk, workloadId, current }: { desk: Desk; workloadId: string; current: Record<string, number> }) {
  const lpars = Object.keys(current).sort();
  const pct = (r: Record<string, number>) => Object.fromEntries(lpars.map((l) => [l, String(Math.round((r[l] ?? 0) * 100))]));
  const { s: vals, update, drafted, error } = useDraftForm<Record<string, string>>(
    desk,
    `SET_ROUTING:${workloadId}`,
    `${workloadId} routing`,
    (d) => pct(d?.kind === 'SET_ROUTING' ? d.routing : current),
    (vals) => {
      const routing = Object.fromEntries(lpars.map((l) => [l, num(vals[l] ?? '') / 100]));
      const same = lpars.every((l) => Math.round(routing[l]! * 100) === Math.round(current[l]! * 100));
      return { cmd: same ? null : { kind: 'SET_ROUTING', workloadId, routing }, error: validateRouting(routing) };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input aria-label={`${workloadId} share on ${l}`} value={vals[l]} onChange={(e) => update({ ...vals, [l]: e.target.value })} size={3} inputMode="numeric" />%
        </label>
      ))}
      {drafted ? <Was>{lpars.map((l) => `${Math.round(current[l]! * 100)}%`).join(' / ')}</Was> : <Now>{lpars.map((l) => `${Math.round(current[l]! * 100)}%`).join(' / ')}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function JobClasses({ desk }: { desk: Desk }) {
  const classes = desk.cfg.jobClasses;
  const [jc, setJc] = useState(classes[0]?.jobClass ?? '');
  const j = classes.find((x) => x.jobClass === jc);
  return (
    <>
      <div className="form">
        <label>
          Job class{' '}
          <select value={jc} onChange={(e) => setJc(e.target.value)}>
            {classes.map((x) => (
              <option key={x.jobClass}>{x.jobClass}</option>
            ))}
          </select>
        </label>
      </div>
      {j && <JobClassEditor key={`${jc}:${j.mode}:${JSON.stringify(j.initiators)}`} desk={desk} jobClass={jc} />}
      <div className="help">JES mode: a fixed number of initiators per system. WLM mode: WLM starts initiators to meet the batch goals, up to the limit shown per system.</div>
    </>
  );
}

function JobClassEditor({ desk, jobClass }: { desk: Desk; jobClass: string }) {
  const j = desk.cfg.jobClasses.find((x) => x.jobClass === jobClass)!;
  const lpars = desk.cfg.systems.map((s) => s.lparId).sort();
  type Form = { mode: 'JES' | 'WLM'; inits: Record<string, string> };
  const nowText = `${j.mode} ${Object.keys(j.initiators)
    .sort()
    .map((k) => `${k}:${j.initiators[k]}`)
    .join(' ')}`;
  const { s: f, update, drafted, error } = useDraftForm<Form>(
    desk,
    `SET_JOB_CLASS:${jobClass}`,
    `Class ${jobClass}`,
    (d) => {
      const mode = (d?.kind === 'SET_JOB_CLASS' ? d.mode : undefined) ?? j.mode;
      const initiators = (d?.kind === 'SET_JOB_CLASS' ? d.initiators : undefined) ?? j.initiators;
      return { mode, inits: Object.fromEntries(lpars.map((l) => [l, String(initiators[l] ?? 0)])) };
    },
    (f) => {
      const initiators = Object.fromEntries(lpars.map((l) => [l, num(f.inits[l] ?? '')]).filter(([, n]) => (n as number) > 0)) as Record<string, number>;
      const bad = lpars.some((l) => {
        const n = num(f.inits[l] ?? '');
        return !(Number.isInteger(n) && n >= 0 && n <= 99);
      });
      const error = bad ? 'Initiators are 0–99 per system' : Object.keys(initiators).length === 0 ? 'At least one system needs initiators' : null;
      const same = f.mode === j.mode && lpars.every((l) => (initiators[l] ?? 0) === (j.initiators[l] ?? 0));
      return { cmd: same ? null : { kind: 'SET_JOB_CLASS', jobClass, mode: f.mode, initiators }, error };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      <select aria-label="Initiator mode" value={f.mode} onChange={(e) => update({ ...f, mode: e.target.value as 'JES' | 'WLM' })}>
        <option value="JES">JES-managed</option>
        <option value="WLM">WLM-managed</option>
      </select>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input aria-label={`Class ${jobClass} initiators on ${l}`} value={f.inits[l]} onChange={(e) => update({ ...f, inits: { ...f.inits, [l]: e.target.value } })} size={2} inputMode="numeric" />
        </label>
      ))}
      {drafted ? <Was>{nowText}</Was> : <Now>{nowText}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}
