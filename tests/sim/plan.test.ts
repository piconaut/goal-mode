import { readFileSync } from 'node:fs';
import { HARBOURLINE } from '../../src/content/scenarios';
import { applyCommand, type Command } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import type { SimState } from '../../src/sim/core/types';
import { effectiveAddressSpaces, effectiveWorkloads } from '../../src/sim/core/tick/helpers';
import { buildLparPlan, lparPlan } from '../../src/sim/core/tick/plan';

// The lookup plan (src/sim/core/tick/plan.ts) is memoised on the identity of config, the WLM definition and the
// effective workload / address-space lists (routing and run additions). That is its only invalidation, so every
// command must leave those objects untouched and return new ones for whatever it changes.

const scenario = HARBOURLINE;
const planOf = (s: SimState) => lparPlan(scenario, s.config, s.wlm.definition, effectiveWorkloads(scenario, s), effectiveAddressSpaces(scenario, s));
const keyObjects = (s: SimState) => ({
  config: s.config,
  definition: s.wlm.definition,
  routing: s.routing,
  extraWorkloads: s.extraWorkloads,
  extraAddressSpaces: s.extraAddressSpaces,
});

let base = initState(42, scenario);
for (let i = 0; i < 3; i++) base = step(base, [], scenario);

const zos = base.config.lpars.find((l) => l.id === 'PRDA')!;
const cpc = base.config.cpcs.find((c) => c.id === zos.cpcId)!;
const aor = base.config.cics[0]!;
const as = scenario.addressSpaces.find((a) => a.lparId === 'PRDA' && a.role === 'CICS.AOR')!;
const wl = scenario.workloads.find((w) => w.id === 'MKTORD')!;
const mqWl = scenario.workloads.find((w) => w.mq)!;
const staticWl = scenario.workloads.find((w) => !base.routingPolicies?.[w.id])!;
const structure = base.config.cfStructures.find((x) => x.cfLparId === 'CF01')!;

/** Commands that change one of the plan's key objects, with what they change. */
const EDITS: { cmd: Command; changes: (keyof ReturnType<typeof keyObjects>)[] }[] = [
  { cmd: { kind: 'ACTIVATE_POLICY', definition: { ...base.wlm.definition, policyName: 'OTHER' } }, changes: ['definition'] },
  { cmd: { kind: 'SET_WEIGHT', lparId: zos.id, pool: 'CP', weight: 451 }, changes: ['config'] },
  { cmd: { kind: 'SET_LOGICAL', lparId: zos.id, pool: 'CP', logical: 6 }, changes: ['config'] },
  { cmd: { kind: 'SET_DEFINED_CAPACITY', lparId: zos.id, msu: 900 }, changes: ['config'] },
  { cmd: { kind: 'SET_CAPACITY_GROUP', groupId: 'GRP1', limitMsu: 1500, members: ['PRDA', 'PRDB'] }, changes: ['config'] },
  { cmd: { kind: 'SET_ABSOLUTE_CAP', lparId: zos.id, engines: 5.5 }, changes: ['config'] },
  { cmd: { kind: 'SET_IEAOPT', lparId: zos.id, changes: { blwlinthdSec: 30 } }, changes: ['config'] },
  { cmd: { kind: 'SET_RMF_INTERVAL', minutes: 30 }, changes: ['config'] },
  { cmd: { kind: 'SET_CPC_ENGINES', cpcId: cpc.id, pool: 'CP', engines: cpc.engines.CP + 1 }, changes: ['config'] },
  { cmd: { kind: 'ADD_CPC_ENGINES', cpcId: cpc.id, pool: 'ZIIP', delta: 1 }, changes: ['config'] },
  { cmd: { kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: 6 }, changes: ['config'] },
  { cmd: { kind: 'SET_CPC_MEMORY', cpcId: cpc.id, memoryGb: cpc.memoryGb + 256 }, changes: ['config'] },
  { cmd: { kind: 'SET_LPAR_MEMORY', lparId: zos.id, memoryGb: zos.memoryGb - 8 }, changes: ['config'] },
  { cmd: { kind: 'SET_DB2', ssid: base.config.db2[0]!.ssid, bufferPoolGb: 50, maxDbat: 300 }, changes: ['config'] },
  { cmd: { kind: 'SET_CICS', name: aor.name, maxTasks: 150 }, changes: ['config'] },
  { cmd: { kind: 'ADD_AOR', lparId: zos.id, name: 'CICSAOR9', maxTasks: 100, qrFrac: 0.5 }, changes: ['config', 'extraAddressSpaces'] },
  { cmd: { kind: 'SET_JOB_CLASS', jobClass: 'A', mode: 'WLM' }, changes: ['config'] },
  { cmd: { kind: 'SET_CF', lparId: 'CF01', thinInterrupts: false }, changes: ['config'] },
  { cmd: { kind: 'MOVE_STRUCTURE', name: structure.name, cfLparId: 'CF02' }, changes: ['config'] },
  { cmd: { kind: 'FAIL_CF', lparId: 'CF01', failed: true }, changes: ['config'] },
  { cmd: { kind: 'SET_DUPLEX', name: structure.name, on: true }, changes: ['config'] },
  { cmd: { kind: 'SET_DASD', changes: { spareAliases: 4 } }, changes: ['config'] },
  { cmd: { kind: 'SET_LCU', lcuId: base.config.dasd.lcus[0]!.id, hotSkew: 2 }, changes: ['config'] },
  { cmd: { kind: 'SET_ROUTING', workloadId: staticWl.id, routing: { PRDA: 1, PRDB: 1 } }, changes: ['routing'] },
  { cmd: { kind: 'ADD_WORKLOAD', workload: { ...wl, id: 'NEWWL' } }, changes: ['extraWorkloads'] },
  { cmd: { kind: 'ADD_ADDRESS_SPACE', addressSpace: { ...as, jobname: 'CICSNEW' } }, changes: ['extraAddressSpaces'] },
  { cmd: { kind: 'REMOVE_ADDRESS_SPACE', jobname: as.jobname, lparId: as.lparId }, changes: ['extraAddressSpaces'] },
];
/** Commands that touch none of the plan's key objects. SET_ROUTING_POLICY only edits `routingPolicies`; the shares it
 * produces arrive as a new `routing` object from `updateRouting`. */
const NO_PLAN_INPUT: Command['kind'][] = ['SET_ROUTING_POLICY', 'SET_MODIFIER', 'SET_LOCK_BOOST', 'ABEND_JOB', 'RESTART_JOB', 'SET_MQ', 'SET_PRICING', 'SET_MLC_PRICE', 'NOTE'];

describe('lookup plan invalidation', () => {
  it('covers every command kind', () => {
    const kinds = [...readFileSync('src/sim/core/commands.ts', 'utf8').matchAll(/^ {4}case '([A-Z_0-9]+)':/gm)].map((m) => m[1]);
    const covered = new Set<string>([...EDITS.map((e) => e.cmd.kind), ...NO_PLAN_INPUT]);
    expect(kinds.filter((k) => !covered.has(k!))).toEqual([]);
  });

  for (const { cmd, changes } of EDITS) {
    it(`${cmd.kind} replaces what it changes and never edits in place`, () => {
      const before = keyObjects(base);
      const snapshot = structuredClone(before);
      const planBefore = planOf(base);
      const r = applyCommand(base, cmd);
      expect(r.ok, r.message).toBe(true);
      // The old objects are untouched, so the old plan still describes them.
      expect(keyObjects(base)).toEqual(snapshot);
      const after = keyObjects(r.state);
      for (const k of changes) expect(after[k], k).not.toBe(before[k]);
      // A plan built before the command is never returned after it.
      const planAfter = planOf(r.state);
      expect(planAfter).not.toBe(planBefore);
      expect(planAfter).toEqual(buildLparPlan(r.state.config, effectiveWorkloads(scenario, r.state), effectiveAddressSpaces(scenario, r.state)));
      // And the next tick runs on the new plan without touching the old or the new objects.
      const newSnapshot = structuredClone(after);
      step(r.state, [], scenario);
      expect(keyObjects(base)).toEqual(snapshot);
      expect(keyObjects(r.state)).toEqual(newSnapshot);
    });
  }

  it('commands without plan inputs leave its key objects as they are', () => {
    const cmds: Command[] = [
      { kind: 'SET_ROUTING_POLICY', workloadId: wl.id, policy: { method: 'WLM', distMethod: 'BASEWLM' } },
      { kind: 'SET_MODIFIER', mod: 'rate', key: wl.id, value: 1.2 },
      { kind: 'SET_LOCK_BOOST', value: 1 },
      { kind: 'NOTE', text: 'x' },
      { kind: 'ABEND_JOB', critical: false },
      { kind: 'SET_MQ', workloadId: mqWl.id, maxDepthMsgs: 50_000 },
      { kind: 'SET_MLC_PRICE', mult: 1.1 },
    ];
    for (const cmd of cmds) {
      const r = applyCommand(base, cmd);
      // A refusal (no job to abend at this hour, say) leaves the state as it is, which is just as good here.
      if (cmd.kind !== 'ABEND_JOB') expect(r.ok, r.message).toBe(true);
      const was = keyObjects(base);
      for (const [k, v] of Object.entries(keyObjects(r.state))) expect(v, `${cmd.kind} ${k}`).toBe(was[k as keyof typeof was]);
      expect(planOf(r.state)).toBe(planOf(base));
    }
  });

  it('is reused while nothing changes and rebuilt when routing moves', () => {
    // Harbourline's CPSM goal routing replaces `routing` every few ticks; between those ticks the plan is shared.
    let s = base;
    let reused = 0;
    let rebuilt = 0;
    for (let i = 0; i < 30; i++) {
      const next = step(s, [], scenario);
      const same = Object.entries(keyObjects(next)).every(([k, v]) => v === keyObjects(s)[k as keyof ReturnType<typeof keyObjects>]);
      if (same) {
        expect(planOf(next)).toBe(planOf(s));
        reused++;
      } else {
        expect(planOf(next)).not.toBe(planOf(s));
        rebuilt++;
      }
      s = next;
    }
    expect(reused).toBeGreaterThan(0);
    expect(rebuilt).toBeGreaterThan(0);
  });
});
