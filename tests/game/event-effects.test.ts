import { matchesEventEffect } from '../../src/game/run/eventEffects';

const session = { kind: 'DDF_THREAD', id: 'thread1', workloadId: 'MOBILE', lparId: 'PROD1', day: 3 } as const;
const job = { kind: 'CANCEL_JOB', jobname: 'SETTLE', lparId: 'PROD1', day: 3 } as const;
const utility = { kind: 'TERM_UTILITY', id: 'REORG', member: 'DB1', day: 3 } as const;

describe('matchesEventEffect', () => {
  it('matches address spaces by jobname and LPAR', () => {
    const effect = { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'CICSXLOG', lparId: 'PROD1' } as const;
    expect(matchesEventEffect(effect, { ...effect })).toBe(true);
    expect(matchesEventEffect(effect, { ...effect, jobname: 'OTHER' })).toBe(false);
    expect(matchesEventEffect(effect, { ...effect, lparId: 'PROD2' })).toBe(false);
    expect(matchesEventEffect(effect, job)).toBe(false);
  });

  it('matches a session only when it is the final remaining culprit with the same full identity', () => {
    const effect = { kind: 'CANCEL_SESSION' } as const;
    const op = { kind: 'CANCEL_SESSION', target: session } as const;
    expect(matchesEventEffect(effect, op, { sessions: [session] })).toBe(true);
    expect(matchesEventEffect(effect, op)).toBe(false);
    expect(matchesEventEffect(effect, op, { sessions: [] })).toBe(false);
    expect(matchesEventEffect(effect, op, { sessions: [session, { ...session, id: 'thread2' }] })).toBe(false);
    for (const target of [
      { ...session, kind: 'TSO_USER' as const },
      { ...session, id: 'thread2' },
      { ...session, workloadId: 'OTHER' },
      { ...session, lparId: 'PROD2' },
      { ...session, day: 4 },
    ]) expect(matchesEventEffect(effect, { ...op, target }, { sessions: [session] })).toBe(false);
    expect(matchesEventEffect(effect, job, { sessions: [session] })).toBe(false);
  });

  it('matches the bound job by jobname, day and LPAR', () => {
    const effect = { kind: 'CANCEL_JOB' } as const;
    expect(matchesEventEffect(effect, job, { job })).toBe(true);
    expect(matchesEventEffect(effect, job)).toBe(false);
    expect(matchesEventEffect(effect, { ...job, jobname: 'OTHER' }, { job })).toBe(false);
    expect(matchesEventEffect(effect, { ...job, day: 4 }, { job })).toBe(false);
    expect(matchesEventEffect(effect, { ...job, lparId: 'PROD2' }, { job })).toBe(false);
    expect(matchesEventEffect(effect, utility, { job })).toBe(false);
  });

  it('matches the bound utility by id, member and day', () => {
    const effect = { kind: 'TERM_UTILITY' } as const;
    expect(matchesEventEffect(effect, utility, { utility })).toBe(true);
    expect(matchesEventEffect(effect, utility)).toBe(false);
    expect(matchesEventEffect(effect, { ...utility, id: 'COPY' }, { utility })).toBe(false);
    expect(matchesEventEffect(effect, { ...utility, member: 'DB2' }, { utility })).toBe(false);
    expect(matchesEventEffect(effect, { ...utility, day: 4 }, { utility })).toBe(false);
    expect(matchesEventEffect(effect, job, { utility })).toBe(false);
  });

  it('requires a recycle to cover every required region on its LPAR', () => {
    const a = { name: 'AOR1', lparId: 'PROD1' };
    const b = { name: 'AOR2', lparId: 'PROD2' };
    const effect = { kind: 'RECYCLE_CICS' as const, targets: [a, b] };
    expect(matchesEventEffect(effect, { kind: 'RECYCLE_CICS', targets: [b, a] })).toBe(true);
    expect(matchesEventEffect(effect, { kind: 'RECYCLE_CICS', targets: [a, b, { name: 'AOR3', lparId: 'PROD1' }] })).toBe(true);
    expect(matchesEventEffect(effect, { kind: 'RECYCLE_CICS', targets: [a] })).toBe(false);
    expect(matchesEventEffect(effect, { kind: 'RECYCLE_CICS', targets: [a, { ...b, lparId: 'PROD1' }] })).toBe(false);
    expect(matchesEventEffect(effect, { kind: 'RECYCLE_CICS', targets: [a, { ...b, name: 'OTHER' }] })).toBe(false);
    expect(matchesEventEffect(effect, job)).toBe(false);
  });

  it('matches the gateway channel and mode, but not an off operation', () => {
    const effect = { kind: 'SET_GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' } as const;
    expect(matchesEventEffect(effect, { ...effect })).toBe(true);
    expect(matchesEventEffect(effect, { ...effect, workloadId: 'OTHER' })).toBe(false);
    expect(matchesEventEffect(effect, { ...effect, mode: 'BACKOFF' })).toBe(false);
    expect(matchesEventEffect(effect, { ...effect, mode: null })).toBe(false);
    expect(matchesEventEffect(effect, job)).toBe(false);
  });

  it('matches only the bound change for a backout', () => {
    const effect = { kind: 'BACKOUT_CHANGE' } as const;
    const op = { kind: 'BACKOUT_CHANGE', changeId: 'release1' } as const;
    expect(matchesEventEffect(effect, op, { changeId: 'release1' })).toBe(true);
    expect(matchesEventEffect(effect, op)).toBe(false);
    expect(matchesEventEffect(effect, op, { changeId: 'release2' })).toBe(false);
    expect(matchesEventEffect(effect, job, { changeId: 'release1' })).toBe(false);
  });
});
