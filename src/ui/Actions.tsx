import { useState } from 'react';
import { HARDWARE } from '../content/hardware-catalog';
import { FIXES } from '../game/catalog';
import type { ViewModel } from '../game/view';
import type { Command } from '../sim/core/commands';
import type { Goal, Importance, Qualifier, SubsystemType } from '../sim/wlm/types';
import type { GameHandle } from './useGame';

export function Actions({ v, game }: { v: ViewModel; game: GameHandle }) {
  const change = (label: string, commands: Command[]) => game.send({ type: 'CHANGE', req: { label, commands } });
  const live = v.phase === 'LIVE';
  return (
    <div className="grid">
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <h3>Change board</h3>
        <div className="muted">
          {live
            ? 'Live day: changes are EMERGENCY changes, applied within seconds, at a trust cost.'
            : v.phase === 'BRIEFING'
              ? 'Briefing: changes are planned and take effect at 06:00 when the day starts.'
              : 'Changes can be made during the briefing or the live day.'}{' '}
          {v.constraints.includes('FREEZE') && <span className="tag bad">CHANGE FREEZE</span>} Hours left: {v.hoursLeft.toFixed(1)}
        </div>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {[...v.changes].reverse().map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="muted">day {c.activateDay + 1}</td>
                <td className="muted">{c.hours}h</td>
                <td>
                  <span className={`tag ${c.status === 'APPLIED' ? 'good' : c.status === 'FAILED' ? 'bad' : 'warn'}`}>{c.status}</span>
                  {c.emergency && <span className="tag bad"> EMERG</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Prsm v={v} change={change} />
      <Wlm v={v} game={game} />
      <Systems v={v} change={change} />
      <Hardware v={v} game={game} />
      <Ops v={v} game={game} change={change} />
    </div>
  );
}

type ChangeFn = (label: string, commands: Command[]) => void;

function Prsm({ v, change }: { v: ViewModel; change: ChangeFn }) {
  const zos = v.lpars.filter((l) => l.kind === 'ZOS');
  const [lpar, setLpar] = useState(zos[0]?.id ?? '');
  const l = v.lpars.find((x) => x.id === lpar);
  const [weight, setWeight] = useState(String(l?.weight ?? 100));
  const [lcp, setLcp] = useState(String(l?.logicalCps ?? 1));
  const [dc, setDc] = useState('');
  const [ziip, setZiip] = useState('1');
  return (
    <div className="panel">
      <h3>HMC: LPAR image profile</h3>
      <div className="form">
        <select
          value={lpar}
          onChange={(e) => {
            setLpar(e.target.value);
            const x = v.lpars.find((y) => y.id === e.target.value);
            setWeight(String(x?.weight ?? 100));
            setLcp(String(x?.logicalCps ?? 1));
          }}
        >
          {zos.map((x) => (
            <option key={x.id}>{x.id}</option>
          ))}
        </select>
        <span className="muted">{l?.polarity}</span>
      </div>
      <div className="form">
        CP weight <input value={weight} onChange={(e) => setWeight(e.target.value)} size={4} />
        <button onClick={() => change(`${lpar} CP weight ${weight}`, [{ kind: 'SET_WEIGHT', lparId: lpar, pool: 'CP', weight: Number(weight) }])}>Set</button>
      </div>
      <div className="form">
        Logical CPs <input value={lcp} onChange={(e) => setLcp(e.target.value)} size={3} />
        <button onClick={() => change(`${lpar} logical CPs ${lcp}`, [{ kind: 'SET_LOGICAL', lparId: lpar, pool: 'CP', logical: Number(lcp) }])}>Set</button>
      </div>
      <div className="form">
        Logical zIIPs <input value={ziip} onChange={(e) => setZiip(e.target.value)} size={3} />
        <button onClick={() => change(`${lpar} logical zIIPs ${ziip}`, [{ kind: 'SET_LOGICAL', lparId: lpar, pool: 'ZIIP', logical: Number(ziip) }])}>Set</button>
      </div>
      <div className="form">
        Defined capacity (MSU, blank = none) <input value={dc} onChange={(e) => setDc(e.target.value)} size={5} />
        <button onClick={() => change(`${lpar} defined capacity ${dc || 'none'}`, [{ kind: 'SET_DEFINED_CAPACITY', lparId: lpar, msu: dc ? Number(dc) : null }])}>Set</button>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        Weight shares the shared pool under contention; HiperDispatch polarity follows entitlement. Logical CPs beyond online + reserved need an IPL.
      </div>
    </div>
  );
}

const IMPS: Importance[] = [1, 2, 3, 4, 5];

function Wlm({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [cls, setCls] = useState(v.serviceClasses[0]?.id ?? '');
  const [period, setPeriod] = useState(0);
  const [kind, setKind] = useState<Goal['kind']>('VEL');
  const [val, setVal] = useState('50');
  const [pct, setPct] = useState('95');
  const [imp, setImp] = useState<Importance>(2);
  const [ss, setSs] = useState<SubsystemType>('STC');
  const [q, setQ] = useState<Qualifier>('TN');
  const [pattern, setPattern] = useState('');
  const [target, setTarget] = useState('STCHI');
  const [newId, setNewId] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState('');
  const goal = (): Goal => (kind === 'VEL' ? { kind, velocity: Number(val) } : kind === 'AVG' ? { kind, rtSec: Number(val) } : kind === 'PCT' ? { kind, rtSec: Number(val), pct: Number(pct) } : { kind: 'DISC' });
  return (
    <div className="panel">
      <h3>WLM policy ({v.policyName})</h3>
      <table>
        <tbody>
          {v.serviceClasses.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td className="muted" style={{ fontSize: 12 }}>{c.periods.map((p, i) => `P${i + 1}: ${p}`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form">
        <select value={cls} onChange={(e) => setCls(e.target.value)}>
          {v.serviceClasses.map((c) => (
            <option key={c.id}>{c.id}</option>
          ))}
        </select>
        P<input value={period + 1} onChange={(e) => setPeriod(Math.max(0, Number(e.target.value) - 1))} size={2} />
        <select value={kind} onChange={(e) => setKind(e.target.value as Goal['kind'])}>
          <option value="VEL">velocity</option>
          <option value="PCT">percentile RT</option>
          <option value="AVG">average RT</option>
          <option value="DISC">discretionary</option>
        </select>
        {kind === 'PCT' && <input value={pct} onChange={(e) => setPct(e.target.value)} size={3} title="percentile" />}
        {kind !== 'DISC' && <input value={val} onChange={(e) => setVal(e.target.value)} size={5} title={kind === 'VEL' ? 'velocity' : 'seconds'} />}
        imp
        <select value={imp} onChange={(e) => setImp(Number(e.target.value) as Importance)}>
          {IMPS.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <button onClick={() => game.send({ type: 'WLM_EDIT', edit: { op: 'SET_PERIOD', classId: cls, period, goal: goal(), importance: imp } })}>Edit period</button>
      </div>
      <div className="form">
        New class <input value={newId} onChange={(e) => setNewId(e.target.value.toUpperCase())} size={8} />
        <button onClick={() => game.send({ type: 'WLM_EDIT', edit: { op: 'ADD_CLASS', classId: newId, description: newId, goal: goal(), importance: imp, cpuCritical: false } })}>Add (uses goal above)</button>
        <button onClick={() => game.send({ type: 'WLM_EDIT', edit: { op: 'SET_FLAGS', classId: cls, cpuCritical: true } })}>CPU critical on {cls}</button>
      </div>
      <div className="form">
        Rule
        <select value={ss} onChange={(e) => setSs(e.target.value as SubsystemType)}>
          {(['STC', 'JES', 'CICS', 'DDF', 'TSO', 'OMVS'] as SubsystemType[]).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={q} onChange={(e) => setQ(e.target.value as Qualifier)}>
          {(['TN', 'UI', 'TC', 'PK', 'CI', 'SY'] as Qualifier[]).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="DB1*" size={8} />→
        <input value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} size={8} />
        <button onClick={() => game.send({ type: 'WLM_EDIT', edit: { op: 'ADD_RULE', subsystem: ss, qualifier: q, pattern, serviceClass: target } })}>Add rule (first)</button>
      </div>
      <div className="form">
        <button
          onClick={() => {
            game.send({ type: 'GET_POLICY' });
            setShowJson(true);
          }}
        >
          Review pending policy
        </button>
        <button className="primary" onClick={() => game.send({ type: 'ACTIVATE_JSON', json: json || game.policy })} disabled={!game.policy && !json}>
          Install &amp; activate
        </button>
      </div>
      {showJson && <textarea rows={14} value={json || game.policy} onChange={(e) => setJson(e.target.value)} />}
    </div>
  );
}

function Systems({ v, change }: { v: ViewModel; change: ChangeFn }) {
  const [bp, setBp] = useState('60');
  const [ssid, setSsid] = useState('DB1A');
  const [aorLpar, setAorLpar] = useState('PROD1');
  return (
    <div className="panel">
      <h3>z/OS, subsystems, I/O</h3>
      <div className="form">
        RMF interval
        {[5, 15, 30].map((m) => (
          <button key={m} onClick={() => change(`RMF interval ${m} min`, [{ kind: 'SET_RMF_INTERVAL', minutes: m }])}>
            {m}m
          </button>
        ))}
      </div>
      <div className="form">
        BLWLINTHD 5s on
        {v.lpars
          .filter((l) => l.kind === 'ZOS')
          .map((l) => (
            <button key={l.id} onClick={() => change(`${l.id} BLWLINTHD=5`, [{ kind: 'SET_IEAOPT', lparId: l.id, changes: { blwlinthdSec: 5 } }])}>
              {l.id}
            </button>
          ))}
      </div>
      <div className="form">
        CF02 <button onClick={() => change('CF02 thin interrupts', [{ kind: 'SET_CF', lparId: 'CF02', thinInterrupts: true }])}>thin interrupts on</button>
        <button onClick={() => change('Move structures: CF01 90%', [{ kind: 'SET_CF', lparId: 'CF01', requestShare: 0.9 }])}>move structures to CF01</button>
      </div>
      <div className="form">
        Db2
        <select value={ssid} onChange={(e) => setSsid(e.target.value)}>
          {['DB1A', 'DB1B', 'DB1T'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        buffer pools GB <input value={bp} onChange={(e) => setBp(e.target.value)} size={4} />
        <button onClick={() => change(`${ssid} BP ${bp} GB`, [{ kind: 'SET_DB2', ssid, bufferPoolGb: Number(bp) }])}>Set</button>
      </div>
      <div className="form">
        New CICS AOR on
        <select value={aorLpar} onChange={(e) => setAorLpar(e.target.value)}>
          {['PROD1', 'PROD2'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button onClick={() => change(`New AOR on ${aorLpar}`, [{ kind: 'ADD_AOR', lparId: aorLpar, name: `CICSAOR${aorLpar.slice(-1)}${Math.floor(Math.random() * 90 + 10)}`, maxTasks: 200, qrFrac: 0.6 }])}>Start region</button>
      </div>
      <div className="form">
        Batch class A initiators
        <button onClick={() => change('Class A WLM-managed', [{ kind: 'SET_JOB_CLASS', jobClass: 'A', mode: 'WLM', initiators: { PROD1: 30, PROD2: 30 } }])}>WLM-managed</button>
        <button onClick={() => change('Class A JES 8/6', [{ kind: 'SET_JOB_CLASS', jobClass: 'A', mode: 'JES', initiators: { PROD1: 8, PROD2: 6 } }])}>JES 8/6</button>
      </div>
      <div className="form">
        Mobile routing
        <button onClick={() => change('MOBILE routing 60/40 → PROD1', [{ kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PROD1: 0.6, PROD2: 0.4 } }])}>60% PROD1</button>
        <button onClick={() => change('MOBILE routing 40/60', [{ kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PROD1: 0.4, PROD2: 0.6 } }])}>reset</button>
      </div>
    </div>
  );
}

function Hardware({ v, game }: { v: ViewModel; game: GameHandle }) {
  return (
    <div className="panel">
      <h3>Hardware orders (capex ${Math.round(v.capexRemaining / 1000)}k left)</h3>
      {HARDWARE.map((h) => (
        <div className="row" key={h.id}>
          <span>
            {h.name}
            <div className="muted" style={{ fontSize: 12 }}>
              {h.description} {h.leadDays > 0 ? `Lead time ${h.leadDays} days.` : 'Immediate.'}
            </div>
          </span>
          <button onClick={() => game.send({ type: 'CHANGE', req: { label: h.name, hardwareId: h.id } })}>
            {h.capex > 0 ? `$${Math.round(h.capex / 1000)}k` : `$${Math.round(h.opexPerDay / 1000)}k/day`}
          </button>
        </div>
      ))}
    </div>
  );
}

function Ops({ v, game, change }: { v: ViewModel; game: GameHandle; change: ChangeFn }) {
  return (
    <div className="panel">
      <h3>Operations</h3>
      {v.batch.abended.map((a) => (
        <div className="row" key={a.name}>
          <span>Restart {a.name}</span>
          <button onClick={() => change(`Restart ${a.name}`, [{ kind: 'RESTART_JOB', day: a.day, name: a.name }])}>Restart</button>
        </div>
      ))}
      {FIXES.map((f) => (
        <div className="row" key={f.id}>
          <span>
            {f.name}
            <div className="muted" style={{ fontSize: 12 }}>{f.description}</div>
          </span>
          <button onClick={() => game.send({ type: 'CHANGE', req: { label: f.name, fixId: f.id } })}>{f.hours}h</button>
        </div>
      ))}
    </div>
  );
}
