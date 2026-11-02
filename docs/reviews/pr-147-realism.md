# PR #147 realism audit — 2026-11-02

Audited with the repository's [zos-docs skill](../../.claude/skills/zos-docs/SKILL.md).
The book PDFs and their committed text caches were located with `books.py` and read with
`pdf_find.py` in this session. Sources are z/OS 3.1 and CICS TS for z/OS Version 6.

## Verdict

The ordinary resource-accounting split is supported. The first implementation's work manager
labels were not accurate enough to merge. The corrections below make it a documented analytic
simplification, rather than a reproduction of CICS monitoring notifications.

## Findings and corrections

| Finding | IBM definition | Correction |
| --- | --- | --- |
| ACTIVE was total transaction population | ACTIVE means a program executing from the work manager perspective; it need not be active to the BCP (RMF p.536). CICS calls its tasks Running (Monitoring CICS p.55). | ACTIVE is an estimated Running-state weight, including BCP CPU waits, not the sum of all states. SUB/APPL are combined explicitly because the model does not distinguish them. |
| READY was copied from CPU delay | READY means another work request has precedence in the work manager (RMF p.536); CICS calls these tasks Dispatchable (Monitoring CICS p.55). | Only modeled CICS QR dispatch contention contributes to READY. A z/OS CPU shortage alone does not become CICS READY. |
| State fields were displayed as transaction counts | RMF reports STATE SAMPLES BREAKDOWN (%) (RMF p.536). | Analytic state weights accumulate and merge before normalization to percentages. The report explicitly says these are estimates. |
| BTE was described as pre-execution, with a zero value | BTE is begin-to-end. In the CICS routing example it belongs to the first region, normally the TOR; EXE summarizes AOR execution. They are separate views, not successive queue stages (Monitoring CICS p.58). | Report the estimated AOR EXE breakdown. Show BTE/TOR and EXE response-time coverage as unavailable, never measured zero. IDLE task populations are also unavailable. |
| Mixed/BOTH classes could display Execution Velocity Actual despite subsystem data | RMF shows N/A whenever subsystem delays are available (RMF p.237). | Guard on reported work manager data, independent of the goal kind or region-management mode. Non-CICS resource workflow remains available separately. |
| The wording implied that CICS transactions can never report processor usage | Optional processor reporting via IWM4RPT/IWM4MNTF is charged to transaction service/report classes and deducted from regions as TRANS-APPL% (RMF p.531). | Explicitly document that optional accounting as unmodeled. This change attributes ordinary resource usage and state samples to regions. |

Ordinary resource usage and state samples belong to the regions' service classes (WLM p.113),
and the CICS transaction-class WLMGL example explicitly excludes ordinary service consumption and
execution delays (RMF p.524). Equal attribution across the image's AORs is a simulation assumption,
not an IBM allocation rule. The projection assumes the modeled transactions are routed to AORs; it does not emulate TOR-only
non-routed requests or product-specific monitoring state switches;
known I/O waits are estimated as I/O, and remaining unclassified suspension is MISC (RMF p.537).

REGION suppresses transaction **service-class response-time data** while retaining transaction
report-class response-time data; BOTH retains that response-time reporting (WLM pp.122–123).
The report projection retains its analytic state estimates independently of that RT-tracking rule;
this is a model choice, not a claim that the cited pages specify every state-notification detail.

## Validation

Regression coverage checks CPU shortage versus QR READY, state percentage rendering, BTE terminology,
zero-arrival backlog, mixed/BOTH velocity, REGION RT tracking, resource conservation, report-class and
sysplex aggregation, old saves, sample expiry and region evidence relevance. WLM's internal management
samples and transaction execution remain independent of the reporting projection.

Final validation: typecheck and all 527 tests in 60 files pass; the production build passes.
Subsystem state metadata expires when its retained samples expire, so historical CICS membership
does not suppress a later non-CICS velocity forever. Current zero-weight subsystem data is retained.
Final check results are recorded in PROGRESS.md and the PR. Goldens change because reporting state
is persisted, not because the simulation's resource allocation changes.

## Sources

[z/OS 3.1 MVS Planning: Workload Management (SC34-2662), p.113 — Defining report classes](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=113)

[z/OS 3.1 MVS Planning: Workload Management (SC34-2662), p.122 — Modifications of transaction response time management](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=122)

[z/OS 3.1 MVS Planning: Workload Management (SC34-2662), p.123 — REGION/BOTH reporting](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=123)

[z/OS 3.1 RMF Report Analysis (SC34-2665), p.237 — Monitor III SYSSUM, Execution Velocity Actual](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=237)

[z/OS 3.1 RMF Report Analysis (SC34-2665), p.524 — WLMGL Service Class Period report with subsystem data](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=524)

[z/OS 3.1 RMF Report Analysis (SC34-2665), p.531 — Transaction Application Time (TRANS-APPL%)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=531)

[z/OS 3.1 RMF Report Analysis (SC34-2665), p.536 — Work Manager/Resource Manager](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=536)

[z/OS 3.1 RMF Report Analysis (SC34-2665), p.537 — WAITING FOR states](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=537)

[CICS TS for z/OS Version 6, Monitoring CICS, p.55 — Monitoring using RMF, terms](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=55)

[CICS TS for z/OS Version 6, Monitoring CICS, p.58 — Interpreting RMF workload activity data, BTE/EXE](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=58)
