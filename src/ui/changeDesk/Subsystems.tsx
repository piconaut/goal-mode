import { useState, type ReactNode } from 'react';
import { DASD_REBALANCE } from '../../content/hardware-catalog';
import { commandTarget, nextAorName, spareAfterBasket } from '../../game/changeDesk';
import { cfUsedGb, duplexSecondary, type CfConfig, type CfStructureConfig } from '../../sim/cf/cf';
import type { Command } from '../../sim/core/commands';
import { LCU_MAX_DEVICES } from '../../sim/io/dasd';
import { Empty } from '../Empty';
import { DraftAction, DraftChoice, draftFor, DraftNumber } from './DraftControls';
import type { Desk } from './shared';

export function Systems({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  return (
    <>
      <div className="form">
        RMF interval
        <DraftChoice
          desk={desk}
          label="RMF interval"
          live={cfg.rmfIntervalMin}
          options={[5, 15, 30].map((m) => ({ value: m, text: `${m} min` }))}
          make={(m) => ({ kind: 'SET_RMF_INTERVAL', minutes: m })}
          read={(c) => (c.kind === 'SET_RMF_INTERVAL' ? c.minutes : cfg.rmfIntervalMin)}
        />
      </div>
      <div className="help">Shorter intervals give finer reports at the cost of SMF volume.</div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>System</th>
              <th>BLWLINTHD</th>
              <th>IIPHONORPRIORITY</th>
            </tr>
          </thead>
          <tbody>
            {cfg.systems.map((s) => (
              <tr key={s.lparId}>
                <td>{s.lparId}</td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${s.lparId} BLWLINTHD`}
                    live={s.blwlinthdSec}
                    options={[5, 20].map((sec) => ({ value: sec, text: `${sec}s` }))}
                    make={(sec) => ({ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { blwlinthdSec: sec } })}
                    read={(c) => (c.kind === 'SET_IEAOPT' ? c.changes.blwlinthdSec ?? s.blwlinthdSec : s.blwlinthdSec)}
                  />
                </td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${s.lparId} IIPHONORPRIORITY`}
                    live={s.iipHonorPriority}
                    options={[
                      { value: true, text: 'YES' },
                      { value: false, text: 'NO' },
                    ]}
                    make={(on) => ({ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { iipHonorPriority: on } })}
                    read={(c) => (c.kind === 'SET_IEAOPT' ? c.changes.iipHonorPriority ?? s.iipHonorPriority : s.iipHonorPriority)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">BLWLINTHD: seconds a starved unit of work waits before blocked-workload promotion. IIPHONORPRIORITY=YES lets zIIP work overflow to CPs.</div>
    </>
  );
}

export function CouplingFacilities({ desk }: { desk: Desk }) {
  const up = desk.cfg.cfs.filter((x) => !x.failed).map((x) => x.lparId);
  const used = cfUsedGb(desk.cfg.cfStructures, up);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>CF</th>
              <th>Thin interrupts</th>
              <th className="num">share of requests</th>
              <th className="num">storage used</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.cfs.map((c) => {
              const share = desk.cfg.cfStructures.filter((x) => x.cfLparId === c.lparId && !x.lost).reduce((a, x) => a + x.requestShare, 0);
              const mem = desk.cfg.lpars.find((l) => l.id === c.lparId)?.memoryGb ?? 0;
              return (
                <tr key={c.lparId}>
                  <td>
                    <b>{c.lparId}</b> {c.failed && <span className="tag bad">DOWN</span>}
                  </td>
                  <td>
                    <DraftChoice
                      desk={desk}
                      label={`${c.lparId} thin interrupts`}
                      live={c.thinInterrupts}
                      options={[
                        { value: true, text: 'on' },
                        { value: false, text: 'off' },
                      ]}
                      make={(on) => ({ kind: 'SET_CF', lparId: c.lparId, thinInterrupts: on })}
                      read={(x) => (x.kind === 'SET_CF' ? x.thinInterrupts ?? c.thinInterrupts : c.thinInterrupts)}
                    />
                  </td>
                  <td className="num">{Math.round(share * 100)}%</td>
                  <td className="num">
                    {(used[c.lparId] ?? 0).toFixed(0)} of {mem} GB
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">Thin interrupts let a CF on shared engines wake on demand instead of waiting for a dispatch interval.</div>
      <Structures desk={desk} />
    </>
  );
}

function structureStatus(st: CfStructureConfig, cfs: readonly CfConfig[], tick: number): ReactNode {
  if (st.lost) return <span className="tag bad">LOST</span>;
  if (st.rebuildUntilTick !== undefined && st.rebuildUntilTick > tick) return <span className="tag warn">rebuilding</span>;
  const sec = duplexSecondary(st, cfs.filter((c) => !c.failed).map((c) => c.lparId));
  return sec ? <span className="tag good">duplexed into {sec}</span> : <span className="muted">simplex</span>;
}

/** Structure placement (SETXCF START,REBUILD): which CF each structure lives in. */
function Structures({ desk }: { desk: Desk }) {
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Structure</th>
              <th>Type</th>
              <th className="num">share of requests</th>
              <th className="num">size</th>
              <th>status</th>
              <th>in CF</th>
              <th>duplex</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.cfStructures.map((st) => (
              <tr key={st.name}>
                <td>{st.name}</td>
                <td>{st.type}</td>
                <td className="num">{Math.round(st.requestShare * 100)}%</td>
                <td className="num">{st.sizeGb ?? '-'} GB</td>
                <td>{structureStatus(st, desk.cfg.cfs, desk.v.tick)}</td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${st.name} CF`}
                    // A lost structure is in no CF: any CF that is up rebuilds it.
                    live={st.lost ? null : st.cfLparId}
                    options={desk.cfg.cfs.map((c) => ({ value: c.lparId, text: c.lparId, disabled: c.failed }))}
                    make={(cf) => ({ kind: 'MOVE_STRUCTURE', name: st.name, cfLparId: cf ?? st.cfLparId })}
                    read={(c) => (c.kind === 'MOVE_STRUCTURE' ? c.cfLparId : st.cfLparId)}
                  />
                </td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${st.name} duplexing`}
                    live={!!st.duplexed}
                    options={[
                      { value: false, text: 'off', disabled: !!st.lost },
                      { value: true, text: 'on', disabled: !!st.lost },
                    ]}
                    make={(on) => ({ kind: 'SET_DUPLEX', name: st.name, on })}
                    read={(c) => (c.kind === 'SET_DUPLEX' ? c.on : !!st.duplexed)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">
        Rebuilding a structure moves its requests to the other CF. Requests that get slow are converted to asynchronous (lock requests a little later than cache and list), so a lock
        structure on a slow or shared CF makes every Db2 transaction spin or wait. The CF Activity report shows each structure. If a CF fails, its structures are rebuilt into the other CF only if it has white space
        for them; a structure that doesn&apos;t fit is lost (lock or SCA: Db2 is down; GBP: pages in recovery; MQ admin: shared queues stop). Duplexing keeps a copy in the other CF, so a
        failure costs nothing, but every request then waits for both CFs.
      </div>
    </>
  );
}

export function Dasd({ desk }: { desk: Desk }) {
  const { lcus, spareAliases } = desk.cfg.dasd;
  return (
    <>
      <div className="form">
        <span>
          Spare aliases: <b>{spareAliases}</b>
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Lower an LCU to free aliases and raise another to use them; both edits go into the same change request.
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>LCU</th>
              <th className="num">Vols</th>
              <th>Aliases</th>
              <th className="num">max</th>
              <th>Hot data sets</th>
            </tr>
          </thead>
          <tbody>
            {lcus.map((l) => {
              // Aliases freed by drafts on other LCUs count as spare here.
              const spare = spareAfterBasket(desk.cfg, desk.basket, l.id);
              const max = Math.min(LCU_MAX_DEVICES - l.volumes, l.aliases + spare);
              const skew = Math.max(DASD_REBALANCE.minSkew, l.hotSkew * DASD_REBALANCE.skewFactor);
              return (
                <tr key={l.id}>
                  <td>
                    <b>LCU {l.id}</b> <span className="muted">{l.label}</span>
                  </td>
                  <td className="num">{l.volumes}</td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`LCU ${l.id} aliases`}
                      live={l.aliases}
                      size={3}
                      make={(n) => ({ kind: 'SET_LCU', lcuId: l.id, aliases: n })}
                      read={(c) => (c.kind === 'SET_LCU' ? c.aliases ?? l.aliases : l.aliases)}
                      validate={(n) =>
                        !(Number.isInteger(n) && n >= 0) ? 'Whole number ≥ 0' : n > LCU_MAX_DEVICES - l.volumes ? `Max ${LCU_MAX_DEVICES - l.volumes} (256 devices per LCU)` : n - l.aliases > spare ? `Only ${spare} spare` : null
                      }
                    />
                  </td>
                  <td className="num">{max}</td>
                  <td>
                    <DraftAction
                      desk={desk}
                      label="rebalance"
                      command={{ kind: 'SET_LCU', lcuId: l.id, hotSkew: skew }}
                      disabled={l.hotSkew <= DASD_REBALANCE.minSkew}
                      title={l.hotSkew <= DASD_REBALANCE.minSkew ? 'Already balanced' : 'Move hot data sets off the busiest volumes'}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">
        HyperPAV aliases are pooled per logical control unit (LCU) and cannot be borrowed across LCUs; an LCU addresses at most {LCU_MAX_DEVICES} devices
        (volumes + aliases). IOSQ in the DASD Activity LCU summary means an LCU has run out. Rebalancing moves hot data sets off its busiest volumes.
      </div>
    </>
  );
}

export function Db2Section({ desk }: { desk: Desk }) {
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Subsystem</th>
              <th>Buffer pools (GB)</th>
              <th>MAXDBAT</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.db2.map((d) => {
              const lpar = desk.cfg.lpars.find((l) => l.id === d.lparId);
              return (
                <tr key={d.ssid}>
                  <td>
                    <b>{d.ssid}</b> <span className="muted">({d.lparId})</span>
                  </td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`${d.ssid} buffer pools (GB)`}
                      live={d.bufferPoolGb}
                      size={4}
                      make={(n) => ({ kind: 'SET_DB2', ssid: d.ssid, bufferPoolGb: n })}
                      read={(c) => (c.kind === 'SET_DB2' ? c.bufferPoolGb ?? d.bufferPoolGb : d.bufferPoolGb)}
                      validate={(n) => (!(n > 0) ? 'Must be > 0 GB' : lpar && n > lpar.memoryGb * 0.6 ? `More than 60% of ${d.lparId}'s ${lpar.memoryGb} GB` : null)}
                    />
                  </td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`${d.ssid} MAXDBAT`}
                      live={d.maxDbat}
                      size={5}
                      make={(n) => ({ kind: 'SET_DB2', ssid: d.ssid, maxDbat: n })}
                      read={(c) => (c.kind === 'SET_DB2' ? c.maxDbat ?? d.maxDbat : d.maxDbat)}
                      validate={(n) => (Number.isInteger(n) && n >= 1 ? null : 'Whole number ≥ 1')}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">Bigger buffer pools raise the hit ratio (fewer sync I/Os) but use LPAR memory. MAXDBAT caps concurrent DDF threads; above it requests queue.</div>
    </>
  );
}

export function MqSection({ desk }: { desk: Desk }) {
  const { mq } = desk.cfg;
  if (mq.length === 0) return <Empty>No MQ queues in this estate.</Empty>;
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>MAXDEPTH</th>
            </tr>
          </thead>
          <tbody>
            {mq.map((q) => (
              <tr key={q.workloadId}>
                <td>
                  <b>{q.queue}</b> <span className="muted">({q.workloadId})</span>
                </td>
                <td>
                  <DraftNumber
                    desk={desk}
                    label={`${q.queue} MAXDEPTH`}
                    live={q.maxDepth}
                    size={9}
                    format={(n) => n.toLocaleString()}
                    make={(n) => ({ kind: 'SET_MQ', workloadId: q.workloadId, maxDepthMsgs: n })}
                    read={(c) => (c.kind === 'SET_MQ' ? c.maxDepthMsgs : q.maxDepth)}
                    validate={(n) => (Number.isInteger(n) && n >= 0 && n <= 999_999_999 ? null : 'Whole number 0–999999999')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">
        Messages wait on the queue instead of timing out, so a slow consumer shows up as queue depth and end-to-end latency. Past MAXDEPTH, puts fail (MQRC 2053) and the
        sender retries. A deeper queue rides out longer bursts but holds more messages in memory.
      </div>
    </>
  );
}

export function CicsSection({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  const prodLpars = [...new Set(cfg.cics.map((r) => r.lparId))].sort();
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th>LPAR</th>
              <th className="num">QR share</th>
              <th>MXT</th>
            </tr>
          </thead>
          <tbody>
            {cfg.cics.map((r) => (
              <tr key={r.name}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td className="muted">{r.lparId}</td>
                <td className="num">{Math.round(r.qrFrac * 100)}%</td>
                <td>
                  <DraftNumber
                    desk={desk}
                    label={`${r.name} MXT`}
                    live={r.maxTasks}
                    size={4}
                    make={(n) => ({ kind: 'SET_CICS', name: r.name, maxTasks: n })}
                    read={(c) => (c.kind === 'SET_CICS' ? c.maxTasks ?? r.maxTasks : r.maxTasks)}
                    validate={(n) => (Number.isInteger(n) && n >= 10 && n <= 2000 ? null : 'MXT is 10–2000')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>New region</h4>
      <AddAor desk={desk} lpars={prodLpars} />
      <div className="help">MXT limits concurrent tasks per region. The QR share is CPU that must run on the single QR TCB (non-threadsafe code), so one region tops out near one engine.</div>
    </>
  );
}

function AddAor({ desk, lpars }: { desk: Desk; lpars: string[] }) {
  const [lpar, setLpar] = useState(lpars[0] ?? '');
  const names = desk.cfg.cics.map((r) => r.name);
  const [name, setName] = useState('');
  const effective = name || nextAorName(names);
  const err = !/^[A-Z][A-Z0-9#@$]{0,7}$/.test(effective) ? '1–8 chars, starts with a letter' : names.includes(effective) ? 'Region exists' : null;
  const cmd: Command = { kind: 'ADD_AOR', lparId: lpar, name: effective, maxTasks: 200, qrFrac: 0.6 };
  const drafted = !!draftFor(desk, commandTarget(cmd));
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (err === null) desk.setDraft(commandTarget(cmd), cmd);
      }}
    >
      <label>
        LPAR{' '}
        <select aria-label="LPAR for the new region" value={lpar} onChange={(e) => setLpar(e.target.value)}>
          {lpars.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Name <input aria-label="Region name" placeholder={nextAorName(names)} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} size={9} />
      </label>
      <button type="submit" disabled={err !== null || drafted}>
        {drafted ? 'In the change request' : 'Add to change request'}
      </button>
      {err && <span className="err">{err}</span>}
    </form>
  );
}
