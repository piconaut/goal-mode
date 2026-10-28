import { useState, type FormEvent } from 'react';
import { AUTOMATION } from '../content/alerts';
import type { AutoAction, AutoTrigger } from '../game/automation';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';

type TriggerKind = 'ALERT' | 'JOB_ABEND';
type ActionKind = AutoAction['kind'];

/** Automation rules (tool AUTOMATION): IF alert/abend THEN action, pre-approved but fallible. */
export function Automation({ v, game }: { v: ViewModel; game: GameHandle }) {
  const a = v.automation;
  const alerts = v.alerts?.rules ?? [];
  const policies = v.policies.saved.map((p) => p.name);
  const [tk, setTk] = useState<TriggerKind>('ALERT');
  const [alertId, setAlertId] = useState('');
  const [critical, setCritical] = useState(true);
  const [ak, setAk] = useState<ActionKind>('ACTIVATE_POLICY');
  const [policy, setPolicy] = useState('');
  const [max, setMax] = useState(String(AUTOMATION.maxPerDayDefault));
  if (!a) return null;
  const action: ActionKind = tk === 'JOB_ABEND' ? 'RESTART_JOB' : ak === 'RESTART_JOB' ? 'ACTIVATE_POLICY' : ak;
  const aId = alerts.some((x) => String(x.id) === alertId) ? Number(alertId) : alerts[0]?.id;
  const pol = policies.includes(policy) ? policy : policies[0];
  const blocker =
    tk === 'ALERT' && aId === undefined ? 'Add an alert rule first' : action === 'ACTIVATE_POLICY' && !pol ? 'Save a policy first (Change Desk › WLM service policies)' : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (blocker) return;
    const trigger: AutoTrigger = tk === 'ALERT' ? { kind: 'ALERT', alertId: aId! } : { kind: 'JOB_ABEND', criticalOnly: critical };
    const act: AutoAction = action === 'ACTIVATE_POLICY' ? { kind: 'ACTIVATE_POLICY', policyName: pol! } : action === 'COD' ? { kind: 'COD' } : { kind: 'RESTART_JOB' };
    game.send({ type: 'AUTO_ADD', rule: { trigger, action: act, maxPerDay: Number(max) || 1 } });
  };
  return (
    <div className="panel">
      <h3>
        Automation ({a.rules.length}/{AUTOMATION.maxRules})
      </h3>
      <div className="help">
        Actions run as pre-approved standard changes: no engineer-hours and no emergency trust cost, but each can misfire ({Math.round(AUTOMATION.misfireFrac * 100)}%). On/Off CoD
        still costs opex per day, and Capacity Provisioning refuses to act while any LPAR is hard-capped.
      </div>
      <ul className="diff">
        {a.rules.map((r) => (
          <li key={r.id}>
            <span>
              {r.text} <span className="muted">· {r.doneToday} today</span>
            </span>
            <button aria-label={`Remove automation ${r.text}`} onClick={() => game.send({ type: 'AUTO_REMOVE', id: r.id })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={submit}>
        IF
        <select aria-label="Trigger" value={tk} onChange={(e) => setTk(e.target.value as TriggerKind)}>
          <option value="ALERT">an alert fires</option>
          <option value="JOB_ABEND">a batch job abends</option>
        </select>
        {tk === 'ALERT' ? (
          <select aria-label="Alert rule" value={aId ?? ''} onChange={(e) => setAlertId(e.target.value)}>
            {alerts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.text}
              </option>
            ))}
          </select>
        ) : (
          <label>
            <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> critical jobs only
          </label>
        )}
        THEN
        {tk === 'ALERT' ? (
          <select aria-label="Action" value={action} onChange={(e) => setAk(e.target.value as ActionKind)}>
            <option value="ACTIVATE_POLICY">activate a saved policy</option>
            <option value="COD">activate On/Off CoD (+1 CP)</option>
          </select>
        ) : (
          <span>restart it once</span>
        )}
        {action === 'ACTIVATE_POLICY' && (
          <select aria-label="Policy" value={pol ?? ''} onChange={(e) => setPolicy(e.target.value)}>
            {policies.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        )}
        <label>
          at most <input aria-label="Max per day" value={max} onChange={(e) => setMax(e.target.value)} size={2} inputMode="numeric" />
          /day
        </label>
        <button type="submit" disabled={blocker !== null || a.rules.length >= AUTOMATION.maxRules}>
          Add
        </button>
        {blocker && <span className="err">{blocker}</span>}
      </form>
      {a.log.length > 0 && (
        <div className="log" style={{ marginTop: 6 }}>
          {[...a.log].reverse().map((e, i) => (
            <div key={i} style={e.text.includes('MISFIRE') || e.text.includes('refused') ? { color: 'var(--crit)' } : undefined}>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
