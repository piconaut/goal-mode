// Plain-English reading of a WLM activity-log line. Split from `mon3.ts` (CL-33): moved unchanged.
const BTLNK_TEXT: Record<string, string> = {
  CPU: 'waiting for a general CP',
  ZIIP: 'waiting for a zIIP',
  IO: 'waiting for I/O',
  STORAGE: 'delayed by paging or swapping',
  QUEUE: 'queued for an initiator or MPL slot',
  OTHER: 'waiting on a server or subsystem',
};

/** Plain-English reading of one WLM activity-log line ("why did ONLHI move?"). */
export function explainWlmLog(line: string): string {
  const head = /(\S+) RCVR=(\S+)(?: \(regions (\S+)\))? PI=([\d.]+) BTLNK=(\S+) (.*)$/.exec(line);
  if (head) {
    const [, sys, rcvr, server, pi, btl, action] = head as unknown as [string, string, string, string | undefined, string, string, string];
    // A served CICS class is helped through its regions' server period (WT-09), so the moves name that period.
    const regions = server
      ? ` Its transactions run in CICS regions that WLM manages as server period ${server}, so WLM moves that period, and every transaction class those regions serve moves with it.`
      : '';
    const why = `On ${sys}, ${rcvr} was the most important period missing its goal (PI ${pi}, mostly ${BTLNK_TEXT[btl] ?? btl}).${regions}`;
    const plan = [...action.matchAll(/(?:^|; )(UP|CARRY|DONOR) (\S+) DP (\w+)→(\w+)(?: \(above (\S+)\))?/g)];
    if (plan.length) {
      const steps = plan.map(([, kind, key, from, to, above]) => {
        const role = kind === 'CARRY' ? `carried secondary receiver ${key}` : kind === 'DONOR' ? `lowered donor ${key}` : `raised ${key}`;
        return above ? `${role} above ${above} (stored DP ${to})` : `${role} from DP ${from} to ${to}`;
      });
      return `${why} WLM committed one plan: ${steps.join('; ')}. The complete plan gave the receiver enough improvement while passing the net-value checks.`;
    }
    const donor = /^DONOR (\S+) DP (\w+)→(\w+)/.exec(action);
    if (donor) return `${why} WLM lowered donor ${donor[1]} from DP ${donor[2]} to ${donor[3]} so the receiver gets the CPU first.`;
    const up = /DP (\w+)→(\w+)/.exec(action);
    if (up) return `${why} WLM raised its dispatch priority from ${up[1]} to ${up[2]}; the projection said the receiver gains more than donors lose.`;
    return why;
  }
  const prot = /(\S+) CPU PROTECTION (.*)$/.exec(line);
  if (prot)
    return `On ${prot[1]}, less important work held a dispatch priority equal to or above a CPU-protected period (CPU Critical or IEAOPT CCIMP), so WLM lowered it: ${prot[2]}. CPU protection is enforced before WLM helps any receiver.`;
  const waiting = /(\S+) (\S+) PI=([\d.]+) mostly waiting, CPU delay (\d+) %: not WLM-fixable/.exec(line);
  if (waiting)
    return `On ${waiting[1]}, ${waiting[2]} misses its goal (PI ${waiting[3]}) but spends most of its time waiting on a server, lock or subsystem, not in a delay WLM manages (CPU delay only ${waiting[4]} % of its samples): dispatching priority can't fix that, so WLM leaves it. Look at what it waits for (DELAY, ENCLAVE, the server's own class).`;
  const notFix = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) not WLM-fixable/.exec(line);
  if (notFix)
    return `On ${notFix[1]}, ${notFix[2]} misses its goal (PI ${notFix[3]}) but is mostly ${BTLNK_TEXT[notFix[4]!] ?? notFix[4]}: dispatching priority can't fix that, so WLM skips it. Look at the delay's real cause.`;
  const noNet = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) no action with net value(?: \((.+) rejected: (.+)\))?/.exec(line);
  if (noNet) {
    const tried = noNet[5] ? ` First move tried: ${noNet[5]}, rejected ${noNet[6]}.` : '';
    return `On ${noNet[1]}, ${noNet[2]} misses its goal (PI ${noNet[3]}) but WLM found no complete plan with enough receiver improvement that passed the net-value checks.${tried}`;
  }
  return line;
}
