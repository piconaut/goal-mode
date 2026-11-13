// Codex: short explanations of the real z/OS concepts the game uses, with sources (SPEC §18).
// Entries are discovered as the player meets them (tools, reports, events) and persist across runs.

export interface CodexSource {
  label: string;
  url?: string;
}

export interface CodexEntry {
  id: string;
  title: string;
  category: 'WLM' | 'PR/SM' | 'Capacity & cost' | 'Subsystems' | 'I/O & CF' | 'Measurement';
  body: string;
  sources: CodexSource[];
  /** How it is discovered: known from the start, or on buying a tool, opening a report kind, or an event. */
  discover: { start?: boolean; tools?: string[]; reports?: string[]; events?: string[]; flags?: CodexFlag[] };
}

const ABCS_WLM: CodexSource = { label: 'IBM Redbook SG24-7621, ABCs of z/OS System Programming Vol. 12 (WLM)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf' };
const PAICE_WLM: CodexSource = { label: 'Colin Paice, One Minute MVS performance: looking at WLM reports', url: 'https://colinpaice.blog/2021/06/27/one-minute-mvs-performance-work-load-manager-looking-at-wlm-reports/' };
const IEAOPT: CodexSource = { label: 'IBM docs: IEAOPTxx parameters', url: 'https://www.ibm.com/support/knowledgecenter/SSLTBW_2.1.0/com.ibm.zos.v2r1.ieae200/spi.htm' };
const GROUP_CAP: CodexSource = { label: 'IBM docs: Group capacity', url: 'https://www.ibm.com/support/knowledgecenter/SSLTBW_2.1.0/com.ibm.zos.v2r1.ieaw100/grcap.htm' };
const WLM_SERVICES_SMF99: CodexSource = { label: 'IBM z/OS 3.1 MVS Programming: Workload Management Services, receivers, donors, net value, priority unbunching (pp. 137–139)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=137' };
const WLM_GUIDE_PA: CodexSource = { label: 'IBM Redbook SG24-6472-03, System Programmer’s Guide to: Workload Manager (Mar 2008), §2.3.2 policy adjustment (pp. 59–60)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=59' };
/** Run milestones that reveal entries (not events or tools). */
export type CodexFlag = 'TFP_OFFER' | 'DB2_CONNECT_FAIL';

const MLC_CAPPING: CodexSource = { label: 'IntelliMagic (John Baker), MLC Capping 101', url: 'https://www.intellimagic.com/?p=7302' };
const HORNE: CodexSource = {
  label: "Cheryl Watson's Tuning Letter 2022 No. 1 (Jim Horne), A Different Way to Define LPAR Weights",
  url: 'https://tuningletter.planetmainframe.com/wp-content/uploads/samples/Reprint-of-Jims-LPAR-Management-article.pdf',
};

export const CODEX: CodexEntry[] = [
  {
    id: 'service-class',
    title: 'Service classes and periods',
    category: 'WLM',
    body: 'WLM manages work in service classes. Each class has one or more periods; work that consumes more service units than a period’s duration ages into the next period, which usually has a looser goal and lower importance. That is how long-running DDF queries and TSO commands drop out of the way of short ones.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'importance',
    title: 'Importance',
    category: 'WLM',
    body: 'Importance 1 (highest) to 5 tells WLM whose goal to protect first when not everyone can meet theirs. It does not make work run faster when there is capacity to spare; it decides who gives up resources when there is not.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'perf-index',
    title: 'Performance index (PI)',
    category: 'WLM',
    body: 'PI compares actual service with the goal: below 1 the goal is beaten, above 1 it is missed. For response-time goals it is actual ÷ goal; for percentile goals WLM uses its response-time buckets (so PI is clamped between 0.5 and 4.0); for velocity goals it is goal velocity ÷ actual velocity. Discretionary work is reported at 0.81.',
    sources: [ABCS_WLM, PAICE_WLM],
    discover: { start: true },
  },
  {
    id: 'velocity',
    title: 'Execution velocity',
    category: 'WLM',
    body: 'Velocity = using ÷ (using + delay) × 100, from WLM’s state samples. It suits work without meaningful transactions, such as started tasks and batch. It only counts delays WLM can manage (CPU, zIIP, I/O, storage, capping); time waiting for a server or a lock shows as “other” and does not lower velocity.',
    sources: [ABCS_WLM, PAICE_WLM],
    discover: { start: true },
  },
  {
    id: 'delay-other',
    title: 'OTH delay: waits WLM cannot manage',
    category: 'Measurement',
    body: 'Delay samples in the WLMGL report and Monitor III DELAY are split into states WLM can act on (CPU, zIIP, I/O, storage, capping; Monitor III DELAY shows capping only inside DLY %) and the rest. In this game OTH collects the rest: Db2 lock waits, synchronous CF requests, CICS QR TCB waits and waiting for a server address space (Db2, CICS, MQ) that is itself slow. A large OTH share is normal for Db2 and CICS work and harmless while the PI is below 1; it matters when it grows. WLM cannot fix it by raising priority, so look in the subsystem data (Db2 accounting, CICS monitoring) and CF Activity for which wait it is. Real RMF reports these as unknown, idle or subsystem-specific states; the single OTH column is a simplification.',
    sources: [ABCS_WLM, PAICE_WLM],
    discover: { start: true },
  },
  {
    id: 'classification',
    title: 'Classification rules',
    category: 'WLM',
    body: 'Incoming work is matched against rules for its subsystem type (STC, JES, CICS, DDF, TSO, OMVS…) by qualifiers such as transaction name, userid or package. Rules are checked top to bottom and the first match wins; nested rules refine their parent. Work that matches nothing gets the subsystem default — SYSOTHER (discretionary) for most types — which is how a new application can silently end up last in line.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'system-classes',
    title: 'SYSTEM, SYSSTC and SYSOTHER',
    category: 'WLM',
    body: 'SYSTEM and SYSSTC run at fixed, very high dispatching priorities outside goal management; z/OS forces key address spaces into SYSTEM. SYSOTHER catches unclassified work with a discretionary goal. Putting busy work into SYSSTC protects it but takes it out of WLM’s hands.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'policy-adjustment',
    title: 'Policy adjustment',
    category: 'WLM',
    body: 'Every 10 seconds WLM looks for one period to help, the receiver: the most important period missing its goal, sysplex PI before local PI, worst first. It finds the receiver’s bottleneck and, for CPU, works out a plan on the dispatching priority ladder: raise the receiver, lower one or more donors, or both, and sometimes move another period with it. Each step is projected from what WLM knows about the work, and the plan is made only if it helps the receiver enough to matter (receiver value) and does not hurt donors more than it helps (net value). WLM helps only one receiver per interval, though it may assess several before finding one it can help. “No action” is a normal outcome: the bottleneck may be something priority cannot fix (a lock, a server, I/O), every plan may harm more important work, or the gain may be too small. A receiver that could not be helped is skipped for a while (the skip clock). In GOAL MODE the WLM activity log shows each plan and, when nothing was done, the first move tried and why it was rejected. The sim projects with its own dispatcher model rather than IBM’s sampled plots, and limits a plan to six moves.',
    sources: [WLM_GUIDE_PA, WLM_SERVICES_SMF99, ABCS_WLM],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'donors-net-value',
    title: 'Donors and net value',
    category: 'WLM',
    body: 'To give a receiver CPU, WLM takes priority from donors: periods running at or above the receiver’s dispatching priority that use the processor. It tries “happy” periods first, those meeting their goals, from the lowest PI up, and importance does not matter among them: a well-overachieving importance-1 class can donate to an importance-3 one if it is projected to stay comfortably within its goal. Donors are taken in the reverse of the receiver order, so periods missing their goals come last, least important first. Each donation must have net value: the projected harm to the donors may not exceed the projected improvement to the receiver. More important work must not be badly affected, and when the receiver and donor have the same importance and both miss their goals, WLM moves them closer together rather than trading one failure for another. A plan with too little receiver value is rejected so WLM can move on to other problems. In GOAL MODE more important work at its goal may not be pushed past it, a period missing its goal is never passed by less important work, at most three donors are tried for one receiver, and CPU protection is checked before anything is projected.',
    sources: [WLM_GUIDE_PA, { label: 'IBM Redbook SG24-6472-03, §2.3.3 CPU management: no more important class badly affected (p. 66)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=66' }, WLM_SERVICES_SMF99, { label: 'IBM z/OS 3.1 MVS Programming: Workload Management Services, SMF 99 donor example (p. 147)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=147' }],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'skip-clock',
    title: 'The skip clock',
    category: 'WLM',
    body: 'If WLM assesses a receiver and every action that could help it is rejected, it sets a skip clock on that period, and the period is not selected as a receiver again until the clock expires: three policy adjustment cycles. That is done for efficiency and to help other work. Since z/OS 1.11 the clock is not honoured while five or fewer service class periods miss their goals: with so few problems, conditions in the next cycle might make it possible to help the period after all. In GOAL MODE a period that was helped gets no clock, the count of missing periods is per system, and the WLM activity log’s “no action” note for a clocked period ends with “next look” and the time it will be assessed again.',
    sources: [
      { label: 'IBM z/OS 3.1 MVS Programming: Workload Management Services, action trace example (p. 145)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=145' },
      { label: 'Horst Sinram (IBM), z/OS Workload Management Update for z/OS V1.11 and V1.12, SHARE 2010 session 7777 (p. 11)', url: 'https://github.com/piconaut/ibm-zos-books/blob/main/products/share/115/S7777_WLM_Update.pdf' },
    ],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'dispatching-priorities',
    title: 'Dispatching priorities and unbunching',
    category: 'WLM',
    body: 'A dispatching priority (DP) is a number from 0 to 255 on an address space or enclave; in goal mode WLM sets it, not the installation. Since z/OS 1.8 the table is: 255 (FF) SYSTEM, 254 (FE) SYSSTC, 253–249 reserved, 248 (F8) small consumers, 247–203 (F7–CB) dynamically managed, 201–192 (C9–C0) discretionary, 191 quiesce. Only the order of the managed priorities matters: work at a higher DP is dispatched first, and work at the same DP takes turns. After a priority change WLM may renumber the periods so that an unoccupied priority sits between each occupied one (priority unbunching), which leaves room to move a period above or below another without moving everyone. A number can therefore change without the order changing. GOAL MODE shows DPs in hex in the WLM activity log; its managed levels are F6, F4, F2 and down, unbunched after every interval, and small consumers are not modelled.',
    sources: [
      { label: 'IBM Redbook SG24-6472-03, System Programmer’s Guide to: Workload Manager (Mar 2008), Table 2-2 dispatching priorities as of z/OS 1.8, rotation at one priority (pp. 65–66)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=65' },
      { label: 'IBM z/OS 3.1 MVS Programming: Workload Management Services, priority unbunching (p. 139)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=139' },
    ],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'equal-dp-sharing',
    title: 'Work at the same dispatching priority',
    category: 'WLM',
    body: 'Work at one dispatching priority waits in one dispatcher queue, and every ready TCB or SRB gets its turn. So a period’s share of the CPU left at its priority depends on how many units it has ready, not on how much work it has queued: an address space with a dozen lightly loaded SRBs, such as Db2, keeps most of what it needs, and a transaction class with a large backlog cannot take it away just by having more work waiting. Raising a class above the servers it ties with removes that protection, so the servers can starve and the class ends up waiting on them.',
    sources: [ABCS_WLM],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'blocked-workload',
    title: 'Blocked workload support',
    category: 'WLM',
    body: 'Work starved of CPU for BLWLINTHD seconds is briefly promoted so it can release resources (locks, enqueues) others are waiting for. BLWLTRPCT caps how much capacity promotion may use. The IBM default of 20 s is often lowered to 5 s on busy systems.',
    sources: [IEAOPT, { label: 'IBM WSC: Blocked workload support', url: 'https://www.ibm.com/support/pages/system/files/inline-files/blocked_v3.pdf' }],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'ccimp',
    title: 'Implicit CPU protection (CCIMP)',
    category: 'WLM',
    body: 'IEAOPT CCIMP gives the first (or only) period of every class up to that importance the same long-term CPU protection as CPU Critical: WLM never lets less important work reach an equal or higher dispatching priority. CCIMP=1 is the z/OS 3.1 default; 0 is the older behaviour. Protection costs WLM donors, so less important work can wait longer when the system is short of CPU.',
    sources: [IEAOPT],
    discover: { tools: ['RMF_MON3'] },
  },
  {
    id: 'cics-region-mode',
    title: 'Manage Region Using Goals Of (TRANSACTION, REGION, BOTH)',
    category: 'Subsystems',
    body: 'CICS transactions are classified into service classes, but they run inside region address spaces, and WLM can only set a region’s dispatching priority. “Manage Region Using Goals Of” is a column of the STC and JES classification rules that catch the regions, so each region can have its own setting. TRANSACTION (the default): the region is a transaction server, managed to the goals of the transaction classes it serves. It runs at the priority the most demanding of them needs, so less important transactions in the same region get a “free ride”, and the region’s own service class is still reported but not used to manage it. Time a transaction spends waiting for a starved TRANSACTION region shows as its own CPU delay, so WLM helps the transaction class. REGION: the region is managed to its own service class goal, like any started task, and its transactions run at that priority; their response times are no longer reported in any service class (only in report classes), so WLM can’t manage the transaction classes. BOTH: managed to its own goal like REGION, but transaction completions are still tracked so the transaction classes keep their response-time management; IBM: “Option BOTH should be used only for CICS TORs. All AORs should remain at the default TRANSACTION.” IBM warns that using this option “limits WLM’s ability to manage the system” and may reduce overall throughput. Separating important and less important work into different regions is the usual fix for the free ride. In GOAL MODE every region is managed to TRANSACTION goals; the setting isn’t one of your levers.',
    sources: [{ label: 'IBM z/OS MVS Planning: Workload Management, “Manage Region Using Goals Of” (pp. 102, 191)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=122' }, { label: 'IBM Redbook SG24-7621, §3.31 CICS/IMS address space server topology (p. 126)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=138' }],
    discover: { start: true },
  },
  {
    id: 'server-topology',
    title: 'Server topology and the free ride ($SRMS001)',
    category: 'WLM',
    body: 'WLM never gives a CICS transaction a priority: it gives one to the regions the transaction runs in. It watches which external service classes each TRANSACTION-managed region serves, and groups the regions that serve the same set of classes into a dynamic internal service class period, named $SRMS001, $SRMS002 and so on, rebuilt about once a minute. That internal period holds the regions’ dispatching priority and collects their samples. The transaction classes are the goal receivers and donors, and the internal period is the resource receiver or donor: when ONLHI misses its goal, WLM raises $SRMS001, and every transaction class those regions serve moves with it. A less important class in the same regions gets a “free ride” on the priority the more important one needs. As a donor it is judged by the classes it serves: it counts as meeting its goal only while all of them do. The regions’ own service class (STCHI here) is ignored for them while they serve transactions. In z/OS the internal periods are visible only in SMF 99 trace data. GOAL MODE has one per system and shows it in the WLM activity log (“RCVR=ONLMED#1 (regions $SRMS001)”), while RMF reports show every served class at its regions’ priority. In real z/OS, routing important and less important transactions to different regions ends the free ride, because each set of regions gets its own internal period; GOAL MODE does not split a workload’s transactions between regions, so it has no such lever.',
    sources: [
      { label: 'IBM Redbook SG24-6472-03, System Programmer’s Guide to: Workload Manager (Mar 2008), §2.3.2 goal and resource receivers, the free ride (pp. 62–63)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=62' },
      { label: 'IBM Redbook SG24-6472-03, §2.4.3 Dynamic Internal Service Class Period, server management (pp. 86–89)', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=86' },
      { label: 'IBM z/OS MVS Programming: Workload Management Services, resource receiver/donor (p. 138)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=138' },
    ],
    discover: { start: true },
  },
  {
    id: 'cics-transaction-goals',
    title: 'Goals for CICS transaction classes',
    category: 'WLM',
    body: 'A service class that CICS (or IMS) transactions are classified into should have one period with a response-time goal, average or percentile. Velocity is not supported because using and delay samples are accounted to the regions, not the transactions, and multiple periods are not supported because service units go to the region address spaces, so WLM cannot tell when a transaction has used up a period. A resource group on such a class is refused outright when you install the definition. Velocity goals still belong on the regions themselves, in their started-task class, which WLM uses when there are no transaction goals or region management is set to REGION.',
    sources: [
      { label: 'IBM z/OS MVS Planning: Workload Management (CICS and IMS goals)', url: 'https://www.ibm.com/docs/en/SSLTBW_2.5.0/pdf/ieaw100_v2r5.pdf' },
      { label: 'IBM Redbook SG24-6472, System Programmer’s Guide to: Workload Manager', url: 'https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf' },
    ],
    discover: { start: true },
  },
  {
    id: 'cf-failure',
    title: 'CF failure, structure rebuild and duplexing',
    category: 'I/O & CF',
    body: 'If a coupling facility fails, z/OS rebuilds its structures into another CF on each structure’s CFRM preference list, but only where there is enough free CF storage (“white space”). A structure that cannot be rebuilt is lost: losing the Db2 lock or SCA structure stops the data sharing group, losing a group buffer pool leaves pages needing recovery. Duplexing keeps a second copy in another CF so a failure costs nothing, but every request then waits for both CFs, so it costs CF CPU and response time all the time.',
    sources: [{ label: 'IBM: System-Managed Coupling Facility Structure Duplexing (white paper)' }, { label: 'IBM Redbook: Parallel Sysplex Application Considerations / CF structure rebuild' }],
    discover: { events: ['CF_FAILURE'], tools: ['CF_DASD'] },
  },
  {
    id: 'swap-mpl',
    title: 'Swapping and MPL delay',
    category: 'WLM',
    body: 'When the work on an LPAR needs more real storage than it has, z/OS swaps whole address spaces out rather than let everything page. Swappable work (batch jobs, TSO users) goes first, least important first; CICS regions, Db2 and other started tasks are non-swappable. A swapped-out job is ready but does nothing, which RMF reports as swap/MPL delay against its service class. The work left in storage pages less.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'mq-queues',
    title: 'MQ queue depth and MAXDEPTH',
    category: 'Subsystems',
    body: 'Message-driven work does not time out like an online request: messages wait on a queue until a consumer (here the CICS bridge) gets them. A slow consumer therefore shows up as rising queue depth (DISPLAY QLOCAL CURDEPTH) and end-to-end latency rather than failed transactions. When a queue reaches its MAXDEPTH, further puts fail with reason code 2053 (MQRC_Q_FULL) and senders retry. Deep queues also hold more messages in buffer pools, page sets and memory.',
    sources: [{ label: 'IBM MQ documentation: ALTER QLOCAL MAXDEPTH; reason code 2053 (MQRC_Q_FULL)' }],
    discover: { start: true },
  },
  {
    id: 'io-priority',
    title: 'I/O priority management',
    category: 'I/O & CF',
    body: 'A service definition option. With it on, z/OS orders the I/O queued for a device (IOSQ) by the dispatching priority WLM gives each period, so important work waits less when aliases run short; the average wait is unchanged, it is only reordered. I/O using and delay samples also count in execution velocity, so velocity goals for I/O-heavy work read lower. With it off, IOSQ is first come, first served and velocity reflects CPU only.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'resource-groups',
    title: 'Resource groups (minimum and maximum)',
    category: 'WLM',
    body: 'A resource group limits or protects the CPU of the service classes in it. The maximum is always enforced, so work above it waits (capping delay) even when the CPC is idle. The minimum is honoured only while the group’s work misses its goals, and then even at the expense of more important work. Type 1 is service units per second across the sysplex, type 2 a percentage of the LPAR’s share, type 3 a number of CPs × 100. Service units are hard to judge: one MSU is a million service units per hour, about 277.8 SU/s, and a general CP delivers its MSU rating × 277.8 SU/s. A 100-MSU CP therefore provides about 27,800 SU/s, so a 100 SU/s limit is only ≈ 0.36 MSU, a fraction of one CP; the editor shows the MSU and per-CPC CP equivalents for type 1 limits.',
    sources: [
      ABCS_WLM,
      { label: 'IBM, z/OS 3.1 MVS Planning: Workload Management, p.251', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=251' },
    ],
    discover: { start: true },
  },
  {
    id: 'report-classes',
    title: 'Report classes',
    category: 'WLM',
    body: 'A report class is a reporting-only label assigned by the same classification rules as the service class. WLM never manages to it, so it costs nothing, but it lets RMF show one workload on its own row even when it shares a service class with others. A report class is homogeneous when all its work runs in one service class; a heterogeneous one mixes service classes, and its response times and velocities then mean little because the goals differ.',
    sources: [
      { label: 'IBM, z/OS Workload Manager: Service classes and report classes', url: 'https://www.ibm.com/docs/en/SSGMCP_5.4.0/fundamentals/workload/workload_lp_classes.html' },
      { label: 'Colin Paice, One Minute MVS performance: looking at WLM reports', url: 'https://colinpaice.blog/2021/06/27/one-minute-mvs-performance-work-load-manager-looking-at-wlm-reports/' },
    ],
    discover: { tools: ['RC_ADVISOR'] },
  },
  {
    id: 'service-policies',
    title: 'Service policies',
    category: 'WLM',
    body: 'A service definition can hold several service policies; the operator (or automation) switches between them with V WLM,POLICY=name, for example a night policy that favours batch. Only one is active at a time across the sysplex.',
    sources: [ABCS_WLM],
    discover: { start: true },
  },
  {
    id: 'lpar-weights',
    title: 'LPAR weights and entitlement',
    category: 'PR/SM',
    body: 'PR/SM shares the shared physical CPs among LPARs in proportion to their weights when the machine is busy: an LPAR is entitled to weight ÷ total weight of the pool. Unused entitlement (white space) flows to LPARs that want more. Weights only matter under contention.',
    sources: [HORNE],
    discover: { start: true },
  },
  {
    id: 'hiperdispatch',
    title: 'HiperDispatch polarity (VH, VM, VL)',
    category: 'PR/SM',
    body: 'With HiperDispatch, an LPAR’s logical CPs become vertical high (a whole physical engine, good cache affinity), vertical medium or vertical low (only white space, often parked) according to its entitlement. Work running on VM/VL engines loses cache affinity and costs more cycles per instruction.',
    sources: [HORNE],
    discover: { tools: ['PARTITION_DATA'] },
  },
  {
    id: 'logical-physical',
    title: 'Logical:physical ratio and short engines',
    category: 'PR/SM',
    body: 'Defining many more logical CPs than physical ones raises PR/SM overhead and makes logical CPs wait to be dispatched (“short engines”). A common rule of thumb is to stay under about 2:1 logical to physical for the shared pool.',
    sources: [{ label: 'IBM z/VM performance tips: Managing PR/SM overhead', url: 'https://www.vm.ibm.com/perf/tips/prsmovhd.html' }],
    discover: { tools: ['PARTITION_DATA'] },
  },
  {
    id: 'r4ha',
    title: 'Rolling 4-hour average (R4HA) and soft capping',
    category: 'Capacity & cost',
    body: 'Sub-capacity software is billed on the peak rolling 4-hour average of MSU consumption, not the instantaneous peak. A defined capacity (or group capacity) soft-caps an LPAR when its R4HA exceeds the limit, saving cost at the risk of CAP delay for the work running there.',
    sources: [GROUP_CAP, MLC_CAPPING],
    discover: { start: true },
  },
  {
    id: 'mlc',
    title: 'Monthly License Charge (MLC)',
    category: 'Capacity & cost',
    body: 'For sub-capacity pricing, the monthly bill is driven by the highest hourly sum of R4HAs across the LPARs running each product (the “peak of sums”), as reported by IBM’s SCRT tool. Shifting work out of the peak hour lowers the bill even if total work is the same. Prices in this game are fictional.',
    sources: [MLC_CAPPING, { label: 'Planet Mainframe, Sub-capacity pricing and capping 101', url: 'https://planetmainframe.com/?p=1640' }],
    discover: { start: true },
  },
  {
    id: 'tfp',
    title: 'Tailored Fit Pricing (consumption)',
    category: 'Capacity & cost',
    body: 'IBM’s Tailored Fit Pricing Enterprise Consumption model bills total MSU consumption against a baseline set from past usage, with growth above it charged at a discount. Peaks and the R4HA stop mattering, so capping no longer saves money; only doing the same work with fewer MSU does. Real contracts are multi-year and roll unused MSUs over; the game simplifies this to a monthly commitment, and its prices are fictional.',
    sources: [
      { label: 'IBM, What is Tailored Fit Pricing for IBM Z?', url: 'https://www.ibm.com/support/knowledgecenter/SSLTBW_2.3.0/com.ibm.zos.v2r3.izsc100/containerPricingOverview.htm' },
      { label: 'Precisely, IBM Tailored Fit Pricing: optimise mainframe costs', url: 'https://www.precisely.com/blog/mainframe/ibm-tailored-fit-pricing-optimize-mainframe/' },
    ],
    discover: { flags: ['TFP_OFFER'] },
  },
  {
    id: 'ziip',
    title: 'zIIPs and IIPHONORPRIORITY',
    category: 'Capacity & cost',
    body: 'zIIP specialty engines run eligible work (much of DDF, Java, some utilities) without adding to software MSU. With IIPHONORPRIORITY=YES, zIIP-eligible work that cannot get a zIIP may run on general CPs (IIPCP), which protects response times but costs MSU.',
    sources: [IEAOPT, { label: 'IBM Db2 12: Configuring zIIPs for Db2', url: 'https://www.ibm.com/docs/SSEPEK_12.0.0/perf/src/tpc/db2z_ibmziip.html' }],
    discover: { start: true },
  },
  {
    id: 'ziip-eligibility',
    title: 'What makes DDF work zIIP-eligible',
    category: 'Capacity & cost',
    body: 'Db2 work arriving through DDF runs under enclave SRBs, and a share of that time is zIIP-eligible. Native SQL procedures run in the DDF enclave and keep that eligibility; external stored procedures run on TCBs in WLM-managed stored procedure address spaces and are not zIIP-eligible. Moving work between the two moves CPU between zIIPs and general CPs without changing the total.',
    sources: [{ label: 'IBM Db2 12: Configuring zIIPs for Db2', url: 'https://www.ibm.com/docs/SSEPEK_12.0.0/perf/src/tpc/db2z_ibmziip.html' }],
    discover: { events: ['ZIIP_LOSS'] },
  },
  {
    id: 'capacity-change',
    title: 'Capacity change (CHANGE REASON, SMF70CAI/SMF70CCR)',
    category: 'Capacity & cost',
    body: 'A CPC can run below its normal capacity without losing engines. SMF type 70 records it: SMF70CAI is 100 at normal capacity and 1 to 99 when capacity is reduced (temporary capacity such as CBU or On/Off CoD is not counted), and SMF70CCR gives the reason: 1 for a manual control, above 1 for a machine condition or an external exception. RMF prints the reason as CHANGE REASON in the CPU Activity report header: NONE, POWERSAVE (power-save mode, set by the user) or MACHINE (cycle steering, initiated by the machine). Every LPAR on the machine delivers less MSU at the same busy, so CPU delay rises everywhere at once. In this game the line appears on Partition Data, as the CPU Activity report is not rendered.',
    sources: [
      { label: 'IBM z/OS 3.1 MVS System Management Facilities (SMF), p.589: SMF70CAI, SMF70CCR', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf#page=589' },
      { label: 'IBM z/OS 3.1 RMF Report Analysis, p.391–392: CPU Activity report, CHANGE REASON', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=391' },
    ],
    discover: { events: ['POWER_CAP'] },
  },
  {
    id: 'cics-sos',
    title: 'CICS MXT and short-on-storage (SOS)',
    category: 'Subsystems',
    body: 'MXT caps how many user tasks a CICS region runs at once; work beyond it waits to be attached, which shows as queue time rather than CPU. Each task also needs dynamic storage, so EDSALIM (default 800 MB) has to hold the region\'s base storage plus its in-flight tasks. When the extended DSAs run short (SOS, message DFHSM0133), CICS defers new task attaches and stops new input until storage frees up, so it looks like an MXT wall. The storage manager statistics show it: EDSA peak at EDSALIM and time spent SOS. Fixes: find the leak and recycle the region, raise EDSALIM while the region runs, lower MXT to what storage holds (fewer concurrent tasks use less storage), or move work elsewhere. A very large EDSALIM delays the SOS warning until a leak is hard to resolve.',
    sources: [
      { label: 'IBM CICS TS 6: Performance (performance_pdf), p.73 EDSALIM, p.76–78 SOS', url: 'https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/performance_pdf.pdf#page=76' },
      { label: 'IBM CICS TS: Short-on-storage conditions in dynamic storage areas', url: 'https://www.ibm.com/docs/en/cics-ts/6.x?topic=storage-short-conditions-in-dynamic-areas' },
    ],
    discover: { events: ['CICS_SOS'] },
  },
  {
    id: 'cod',
    title: 'On/Off Capacity on Demand and Capacity Provisioning',
    category: 'Capacity & cost',
    body: 'On/Off CoD temporarily activates spare engines for a daily fee. z/OS Capacity Provisioning Manager can activate it automatically by rule, but it should not be combined with hard-capped LPARs.',
    sources: [{ label: 'IBM: z/OS Capacity Provisioning', url: 'https://www-03.ibm.com/systems/z/os/zos/features/cpm' }],
    discover: { tools: ['AUTOMATION'] },
  },
  {
    id: 'cf-sync-async',
    title: 'CF requests: sync, async and lock structures',
    category: 'I/O & CF',
    body: 'A synchronous coupling-facility request spins the z/OS CP until the answer returns; when the CF is slow, z/OS converts suitable requests to asynchronous to stop the spin, at the price of longer elapsed time. Since z/OS 1.2 the heuristic covers lock requests too, so a lock structure on a slow or shared-engine CF either burns CPU on every Db2 transaction or, once converted, makes every lock request wait much longer. Thin interrupts help shared CF engines respond quickly.',
    sources: [
      { label: 'IBM docs: sync to async conversion of CF requests', url: 'https://www.ibm.com/support/knowledgecenter/en/SSLTBW_2.2.0/com.ibm.zos.v2r2.ieaf100/huer.htm' },
      { label: 'IBM: Sync/Async heuristic', url: 'https://www.ibm.com/support/pages/system/files/inline-files/Sync_Async_Heuristic.pdf' },
    ],
    discover: { reports: ['CF'], events: ['CF_LINK'] },
  },
  {
    id: 'hyperpav',
    title: 'DASD response time, IOSQ and HyperPAV',
    category: 'I/O & CF',
    body: 'DASD response time splits into IOSQ (queued in z/OS for the device), PEND, DISC (cache misses) and CONN (data transfer). HyperPAV lets a volume borrow alias devices from its logical control unit’s pool so several I/Os can run at once; IOSQ appears when an LCU runs out of aliases.',
    sources: [{ label: 'Colin Paice, One Minute MVS performance: DASD', url: 'https://colinpaice.blog/2021/06/19/one-minute-mvs-performance-dasd/' }],
    discover: { reports: ['DASD'], events: ['DASD_DEGRADED', 'REORG_OVERRUN'] },
  },
  {
    id: 'qr-tcb',
    title: 'CICS QR TCB and threadsafe programs',
    category: 'Subsystems',
    body: 'Non-threadsafe CICS application code runs on the region’s single quasi-reentrant (QR) TCB, so one region can use only about one engine for it however many CPs exist. Making programs threadsafe moves work to open TCBs; adding regions spreads the QR load.',
    sources: [{ label: 'IBM: CICS threadsafe white paper', url: 'https://public.dhe.ibm.com/software/uk/itsolutions/leveragingmiddleware/new-face-of-cics/cics-threadsafe-whitepaper.pdf' }],
    discover: { tools: ['CICS_MON'] },
  },
  {
    id: 'db2-velocity',
    title: 'Db2 address spaces and their goals',
    category: 'Subsystems',
    body: 'Db2’s system address spaces (MSTR, DBM1, IRLM, DIST) serve all of its users: starving them slows every transaction even though the transactions themselves show no CPU delay. IBM recommends high importance and velocity goals for them, with IRLM in SYSSTC.',
    sources: [{ label: 'IBM Db2 12: Velocity goals for Db2 address spaces', url: 'https://www.ibm.com/docs/en/SSEPEK_12.0.0/perf/src/tpc/db2z_determinevelocitygoals.html' }],
    discover: { tools: ['DB2_ACCT'] },
  },
  {
    id: 'rmf',
    title: 'RMF Postprocessor and Monitor III',
    category: 'Measurement',
    body: 'RMF Postprocessor reports (Workload Activity/WLMGL, Partition Data, CF and DASD Activity) summarise SMF records per interval, typically 15 or 30 minutes, after the fact. CICS transaction classes show response-time goals and work manager states; their ordinary resource usage and using/delay samples appear on the regions’ service classes. IBM also supports optional transaction processor accounting (TRANS-APPL%), which this game does not model. Follow the region class links in WLMGL when pinning CPU delay for a CICS incident. In Monitor III, the Work Manager Delays view (SYSWKM) shows a CICS class’s state breakdown and the AORs serving it, with their velocity, processor use and capping; a slow CICS class whose AORs show low velocity is short of CPU, while healthy AORs and a large WAITING FOR LOCK or PROD point past WLM. The game estimates EXE state percentages: ACTIVE combines subsystem and application activity, including z/OS processor waits; READY estimates CICS QR dispatch waits. BTE means begin-to-end in the first region, normally a TOR; that timeline and idle task populations are not modelled. Monitor III samples continuously and shows the last minutes live: SYSSUM (goals versus actuals and PI), SYSINFO, DELAY, PROCU, ENCLAVE, CPC and the WFEX exception list. Its using and delay percentages are shares of state samples: a job waiting on something RMF does not monitor (a Db2 thread, a CICS task slot) is in the unknown state (UKN), not delayed. DELAY’s % Delayed for columns are PRC (CPs and zIIPs together), DEV, STR, SUB, OPR and ENQ; WLM capping has no column, so DLY % can exceed their sum, and a capped job shows Primary Reason RG-Cap. Otherwise Primary Reason names the job that used the processor most (or *ENCLAVE), the device, or the paging type (LOCL). This game shows one DELAY row per service-class period, not per job. Monitor III also keeps its samples in VSAM data sets, one set per MINTIME (100 s by default; this shop runs 120 s), so you can step back (BREF) to an earlier range; here it keeps 48 hours.',
    sources: [{ label: 'IBM RMF Report Analysis 3.1 pp.237, 524, 531, 536–537', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=536' }, { label: 'IBM CICS TS 6 Monitoring CICS pp.55, 58', url: 'https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=55' }, { label: 'IBM z/OS WLM Planning 3.1 p.113: CICS/IMS reporting', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=113' }, { label: 'IBM z/OS RMF Report Analysis (SC34-2665), ch. 2: Monitor III', url: 'https://www.ibm.com/docs/en/SSLTBW_2.5.0/pdf/erbb500_v2r5.pdf' }, PAICE_WLM],
    discover: { start: true },
  },
  {
    id: 'smf-volume',
    title: 'SMF record volume and its CPU cost',
    category: 'Measurement',
    body: 'Every SMF record is built by the component that cuts it and written by the SMF address space to log streams or MANx data sets. Interval records (types 30, 70-79) are cheap; per-transaction records such as Db2 accounting (101) and CICS performance class (110) scale with the transaction rate, so keeping them all costs CPU in SMF and storage behind it. Sites usually sample or summarise them outside an investigation.',
    sources: [{ label: 'IBM z/OS MVS System Management Facilities (SMF)', url: 'https://www.ibm.com/docs/en/zos/3.1.0?topic=mvs-zos-system-management-facilities-smf' }],
    discover: { events: ['SMF_AUDIT'] },
  },
  {
    id: 'smf101',
    title: 'Db2 accounting (SMF 101)',
    category: 'Measurement',
    body: 'Db2 writes a type 101 accounting record when a transaction\'s processing completes, so it times each thread rather than the WLM service class. Class 1 elapsed is the whole accounting interval (application time, including the front end and Db2); class 2 elapsed is time spent in the Db2 thread; class 3 suspensions split out the waits inside Db2 for locks and latches, synchronous database and log I/O, and other I/O. Class 2 not accounted is class 2 elapsed minus class 2 CPU and class 3; not-in-Db2 is class 1 minus class 2. A rising CPU per transaction against a healthy baseline points at an access-path change, while growing lock or I/O suspension points at concurrency or I/O. Package rows need accounting trace classes 7 and 8 (class 10 adds detail at more CPU and SMF volume). A request queued for a database access thread (DBAT) waits before the thread exists, so that wait is not in the accounting record (Db2 reports the queue count in IFCID 73); RMF enclave queue time does include it.',
    sources: [
      { label: 'IBM z/OS 3.1 MVS SMF p.1133: record type 101 (Db2 accounting)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf#page=1133' },
      { label: 'IBM Db2 13 for z/OS Managing Performance pp.709, 726, 729–731: class 1/2/3 times', url: 'https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf#page=729' },
      { label: 'IBM Db2 13 for z/OS Managing Performance pp.143, 476, 660, 703: DBAT queue and package accounting', url: 'https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf#page=143' },
    ],
    discover: { tools: ['DB2_ACCT'] },
  },
  {
    id: 'smf110',
    title: 'CICS monitoring (SMF 110)',
    category: 'Measurement',
    body: 'CICS writes performance class records to SMF type 110, at least one per transaction and normally covering attach to detach; the record is built at event monitoring points and passed to SMF. Response time is stop time minus start time. Dispatch time is the time the task was dispatched, CPU time is the part of it using processor cycles, and suspend time covers first dispatch delay (including MXT and transaction-class limits), dispatch wait, and I/O or other waits. QRMODDLY is the redispatch wait on the QR TCB, MXTDELAY is the part of first dispatch delay caused by MXT, and USRDISPT minus USRCPUT is time dispatched but not on a CP. The table compares CPU per transaction with a healthy baseline and shows those QR, MXT and DISP−CPU waits plus the failed share (transactions that ended with an abend; the record carries the original and current abend codes). A CICS class can meet its WLM goal while transactions stall, because response times are for ended transactions.',
    sources: [
      { label: 'IBM CICS TS 6 Monitoring CICS pp.19, 25: performance class records and SMF', url: 'https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=19' },
      { label: 'IBM CICS TS 6 Monitoring CICS pp.251–254, 280, 287, 290, 295–296: response, dispatch, QR, MXT and abend fields', url: 'https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=251' },
      { label: 'IBM z/OS 3.1 MVS SMF p.1183: record type 110 (CICS TS)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf#page=1183' },
    ],
    discover: { tools: ['CICS_MON'] },
  },
  {
    id: 'smf113',
    title: 'CPU MF counters (SMF 113), RNI and LSPR categories',
    category: 'Measurement',
    body: 'The CPU Measurement Facility counts cycles, instructions and cache misses. Relative Nest Intensity (RNI) and the L1 miss rate place a workload in an LSPR category (LOW, AVERAGE, HIGH), which decides which capacity ratings apply when you size new hardware.',
    sources: [
      { label: 'IBM: Relating production workloads to LSPR workloads', url: 'https://www.ibm.com/support/pages/relating-production-workloads-lspr-workloads' },
      { label: 'IBM: CPU MF formulas', url: 'https://www.ibm.com/support/pages/system/files/inline-files/CPU%20MF%20Formulas%20April%202025_0.pdf' },
    ],
    discover: { tools: ['SMF113'] },
  },
  {
    id: 'sd-wlm-weights',
    title: 'Sysplex Distributor: SERVERWLM and BASEWLM weights',
    category: 'Subsystems',
    body: 'Sysplex Distributor spreads incoming TCP connections across the stacks of a sysplex. BASEWLM, the default distribution method, uses WLM system weights: the most available capacity gets the highest weight, and that counts general-purpose CP capacity unless PROCTYPE is set to count zAAP and zIIP capacity too. SERVERWLM asks WLM about each target server instead: the weight comes from the capacity that work of that server’s importance could use or displace, combined across processor types in proportion to the server’s own use of each, so a system with idle zIIPs is not penalised for busy CPs when the work is zIIP-eligible. PROCXCOST can also lower the weight of servers whose zIIP work is crossing over to CPs (not modelled). The game models this as per-system shares that are refreshed every minute, with a small floor so no system drops to zero.',
    sources: [
      { label: 'z/OS 3.1 IP Configuration Guide, ch. 8: BASEWLM and SERVERWLM weights (PDF p.555–556)', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/halz002_v3r1.pdf#page=555' },
      { label: 'IBM support: distribution methods available to the distributing TCP/IP stack (VIPADISTRIBUTE DISTMETHOD)', url: 'https://www.ibm.com/support/pages/what-are-different-distribution-methods-available-distributing-tcpip-stack' },
    ],
    discover: { start: true },
  },
  {
    id: 'cpsm-routing',
    title: 'CICSPlex SM dynamic routing: goal and queue algorithms',
    category: 'Subsystems',
    body: 'CICSPlex SM workload management routes each eligible transaction to a target region (AOR) when it arrives. With the goal algorithm it picks the AOR expected to best meet the transaction’s WLM response-time goal, using WLM and CPSM data on region health and load. With the queue algorithm it picks the AOR with the lowest load, based on the number of tasks queued against its MAXTASKS limit, and ignores the goal. Either way it can only route to regions it believes are healthy, so what it measures decides where work goes.',
    sources: [{ label: 'IBM CICS TS 6: CICSPlex SM Managing Workloads (routing algorithms)', url: 'https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf' }],
    discover: { start: true },
  },
  {
    id: 'storm-drain',
    title: 'The storm drain: abends look fast',
    category: 'Subsystems',
    body: 'A CICS region that abends transactions almost at once shows excellent response times, so goal or queue routing reads it as the best target and sends it even more work. CICSPlex SM counters this with abend thresholds in the workload specification or transaction group: After an abend a region is unhealthy and avoided while its abend probability ages; once it is below ABENDCRIT it is healthy again but its load counts double, and below ABENDTHRESH it competes normally. Abends caught by HANDLE ABEND never reach CICSPlex SM. Fixes: set the thresholds, quiesce the region, or recycle it.',
    sources: [{ label: 'IBM CICS TS: Abend probabilities and workload management', url: 'https://www.ibm.com/docs/en/cics-ts/5.5.0?topic=workload-abend-probabilities-management' }],
    discover: { events: ['SICK_AOR'] },
  },
  {
    id: 'absolute-capping',
    title: 'PR/SM absolute capping',
    category: 'PR/SM',
    body: 'Absolute capping (ABSCAPP in the image profile, set in the HMC) limits an LPAR to a fixed amount of processing power expressed in physical CPs, for example 4.5. Unlike weight capping, which only bites when the CPC is contended, and defined capacity, which limits the four-hour average, it is enforced all the time, even when the CPC has spare capacity. It is a hard ceiling: a spike that could have used idle engines still waits, so it protects software cost but can starve a busy LPAR.',
    sources: [{ label: 'IBM Z and LinuxONE PR/SM Planning Guide (SB10-7184): absolute capping', url: 'https://www.ibm.com/docs/en/module_1721331501652/pdf/SB10-7184-00.pdf' }, { label: 'IBM: Topics in LPAR Performance (absolute capping behaviour)', url: 'http://www.vm.ibm.com/perf/tips/lparwt.pdf' }],
    discover: { start: true },
  },
  {
    id: 'arrival-bursts',
    title: 'Bursty arrivals and averaged intervals',
    category: 'Measurement',
    body: 'Real online work is not smooth: market open, a flash sale or a payday batch of requests can send arrivals many times above the hourly mean for a few minutes. Queues and CPU delay build inside the peak and WLM must react within its policy interval, but a 15 or 30 minute RMF Postprocessor interval averages the peak into the quiet minutes around it and looks mild. Monitor III, with its short range, shows the spike. Headroom, percentile goals and MAXTASKS tuning matter for the peak, not the average.',
    sources: [{ label: 'IBM z/OS RMF Report Analysis (SC34-2665): Monitor III', url: 'https://www.ibm.com/docs/en/SSLTBW_2.5.0/pdf/erbb500_v2r5.pdf' }],
    discover: { events: ['MARKET_OPEN_SURGE'] },
  },
  {
    id: 'end-rate',
    title: 'END/S: reading the transaction rate',
    category: 'Measurement',
    body: 'END/S is the number of transactions that ended per second in the interval; ENDED is the count, reported per service-class period. Neither number says whether the work is healthy: read END/S against the same hour on an earlier day and against what each transaction costs. CPU per transaction is APPL% CP divided by END/S, then by 100 for seconds (CICS transaction rows report resource usage with their region classes, so use those rows or CICS monitoring). A higher END/S at the same CPU per transaction means more transactions arriving at the same cost each: real demand growth, or clients resending requests that timed out, since each retry is another ended transaction. The same rate at more CPU per transaction means each request does more work, such as a changed access path. A falling rate while CPU stays high means work is waiting, not going away. A 15-30 minute interval averages a short burst away; Monitor III\'s short range shows the spike.',
    sources: [{ label: 'IBM z/OS RMF Report Analysis (SC34-2665): WLMGL field descriptions', url: 'https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=530' }],
    discover: { reports: ['WLM_SUMMARY'] },
  },
  {
    id: 'ABEND_S0C7',
    title: 'S0C7: a data exception, not a tuning problem',
    category: 'Subsystems',
    body: 'A system completion code 0C7 is a program check for a data exception: a decimal instruction met a field that is not valid packed decimal, usually bad input data or an uninitialised field in the program. No WLM policy, capping or capacity change prevents it. The job has to be fixed or the bad record bypassed, then restarted; while it is down its successors are held, so a critical one can miss the batch window. In an RCA the trigger is APPLICATION_ERROR and the mechanism JOB_FAILURE.',
    sources: [{ label: 'IBM docs: z/OS MVS System Codes (0C7)', url: 'https://www.ibm.com/docs/en/zos/2.5.0?topic=codes-0c7' }],
    discover: { events: ['JOB_ABEND'] },
  },
  {
    id: 'DB2_CONNECT_DSNE100I',
    title: 'DSNE100I: a Db2 job on an image without Db2',
    category: 'Subsystems',
    body: 'A batch job running TSO DSN under IKJEFT01 connects to a Db2 subsystem on the z/OS image where it runs. A job without system affinity starts wherever an initiator for its class is free, and nothing in that choice checks for Db2. If the image has no Db2, DSN has no subsystem to attach to: the connect fails and makes no more attempts (modelled as DSNE100I ssid NOT OPERATIONAL, RETRY COUNT IS ZERO, the message the book documents for a named ssid that is not active; APPROX, because an image with no Db2 defined may report a slightly different connect error). The job ends without doing its work, its successors stay held, and it needs a rerun. The clue is in the Operations log: which job, on which system. Fix: take that job class\'s initiators off the image without Db2, then restart the job. In an RCA the mechanism is JOB_FAILURE and the trigger POLICY (the initiator setup sent it there).',
    sources: [{ label: 'IBM Db2 13 for z/OS Messages, DSNE100I (p.140)', url: 'https://www.ibm.com/docs/en/db2-for-zos/13?topic=messages-dsne100i' }],
    discover: { flags: ['DB2_CONNECT_FAIL'] },
  },
];

export const codexEntry = (id: string): CodexEntry | undefined => CODEX.find((e) => e.id === id);
