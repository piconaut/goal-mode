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
/** Run milestones that reveal entries (not events or tools). */
export type CodexFlag = 'TFP_OFFER';

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
    body: 'Delay samples in the WLMGL report and Monitor III DELAY are split into states WLM can act on (CPU, zIIP, I/O, storage, capping) and the rest. In this game OTH collects the rest: Db2 lock waits, synchronous CF requests, CICS QR TCB waits and waiting for a server address space (Db2, CICS, MQ) that is itself slow. A large OTH share is normal for Db2 and CICS work and harmless while the PI is below 1; it matters when it grows. WLM cannot fix it by raising priority, so look in the subsystem data (Db2 accounting, CICS monitoring) and CF Activity for which wait it is. Real RMF reports these as unknown, idle or subsystem-specific states; the single OTH column is a simplification.',
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
    body: 'Every 10 seconds WLM picks the most important period missing its goal (the receiver), finds its bottleneck, projects what raising its dispatching priority or lowering a donor’s would do, and makes at most one change that helps the receiver more than it hurts others. If the bottleneck is not something priority can fix (a lock, a server, I/O), WLM can only watch.',
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
    id: 'cics-region-mode',
    title: 'CICS region management (TRANSACTION vs REGION)',
    category: 'Subsystems',
    body: 'CICS transactions are classified into service classes, but they run inside region address spaces, and WLM can only set a region’s dispatching priority. With TRANSACTION goals, WLM manages each region to the most demanding transaction class it serves, so less important transactions in the same region get a “free ride”. With REGION goals, the regions are managed to their own started-task class and transaction goals are only reported. Separating important and less important work into different regions is the usual fix for the free ride.',
    sources: [ABCS_WLM],
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
    body: 'A resource group limits or protects the CPU of the service classes in it. The maximum is always enforced, so work above it waits (capping delay) even when the CPC is idle. The minimum is honoured only while the group’s work misses its goals, and then even at the expense of more important work. Type 1 is service units per second across the sysplex, type 2 a percentage of the LPAR’s share, type 3 a number of CPs × 100.',
    sources: [ABCS_WLM],
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
    body: 'A synchronous coupling-facility request spins the z/OS CP until the answer returns; when the CF is slow, z/OS converts suitable requests to asynchronous to stop the spin, at the price of longer elapsed time. Lock requests are not converted, so a lock structure on a slow or shared-engine CF burns CPU on every Db2 transaction. Thin interrupts help shared CF engines respond quickly.',
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
    body: 'RMF Postprocessor reports (Workload Activity/WLMGL, Partition Data, CF and DASD Activity) summarise SMF records per interval, typically 15 or 30 minutes, after the fact. Monitor III samples continuously and shows the last minutes live: SYSINFO, DELAY, PROCU, ENCLAVE and the WFEX exception list.',
    sources: [{ label: 'IBM: RMF Monitor III reports', url: 'https://www.ibm.com/docs/SSLTBW_2.2.0/com.ibm.zos.v2r2.erbb500/toc.htm' }, PAICE_WLM],
    discover: { start: true },
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
];

export const codexEntry = (id: string): CodexEntry | undefined => CODEX.find((e) => e.id === id);
