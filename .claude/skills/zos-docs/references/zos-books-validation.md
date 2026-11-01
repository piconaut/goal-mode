# IBM book catalog validation — 2026-11-01

This audit compared all 24 PDFs in `piconaut/ibm-zos-books` (local clone at audit
 time) with `zos-books.md` and searched IBM's public documentation and Redbooks
pages for the remaining entries. This is an identity/title/form audit, not a
validation of every book's technical content.

Evidence levels differ: a PDF title page or an observed IBM PDF result establishes
an exact filename; a library table establishes title/form only. A stored local PDF
also establishes its local alias, which need not be IBM's filename. Many IBM Docs
pages returned HTTP 403 on direct open; their indexed IBM search results were used
where available. No blocked or absent result was counted as a successful download,
and no missing search result was treated as proof that a book does not exist.
Unverified file names remain candidates, requiring confirmation before fetching.

## Performance and operations

[IBM's 3.1 MVS library](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-mvs)
confirms the catalog's MVS titles and base form numbers, including all ten message
volumes. [IBM's RMF library](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-rmf)
confirms the four RMF books, including the previously omitted Programmer's Guide.
[IBM's system-level library](https://www.ibm.com/docs/en/zos/3.1.0?topic=zos-system-level)
confirms Problem Management, SC23-6844.

| IDs | Evidence and limitation |
|---|---|
| `ieag200`, `erbru00`, `erbb500`, `grbdp00`, `ieaw100`, `ieae100`, `ieae200` | Stored 3.1 PDF covers confirm title, exact local filename, and form. IBM library tables independently confirm title/form. |
| `erbrp00` | [Exact 3.1 IBM PDF search result](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbrp00_v3r1.pdf) confirms RMF Programmer's Guide, GC27-4937-60. Corrects the previous claim that no separate book was found. |
| `erba200` | RMF library confirms title/form SC34-2666. [Observed 2.3 PDF](https://www.ibm.com/docs/en/SSLTBW_2.3.0/pdf/erba200_v2r3.pdf) confirms historical ID; exact 3.1 filename not independently confirmed. |
| `ieaw200` | MVS library confirms title/form SC34-2663. [Observed 2.4 PDF](https://www.ibm.com/docs/en/SSLTBW_2.4.0/pdf/ieaw200_v2r4.pdf) confirms historical ID; exact 3.1 filename not independently confirmed. |
| `ieag100`, `ieab600`, `ieab100` | Observed IBM 3.1 PDF search results confirm exact IDs for System Commands, JCL Reference, and Program Management: User's Guide and Reference; forms match the MVS library. |
| `ieag300` | [IBM support discussion](https://community.ibm.com/community/user/question/anyone-using-zos-message-flood-automation) explicitly links the 3.1 PDF to MVS Planning: Operations. MVS library confirms SA23-1390. |
| `ieab500` | MVS library confirms JCL User's Guide, SA23-1386. [Observed 2.4 PDF](https://www.ibm.com/docs/en/SSLTBW_2.4.0/pdf/ieab500_v2r4.pdf) confirms historical ID; exact 3.1 filename not independently confirmed. |
| `ieah700`, `ieam100`, `ieam200`, `ieam300`, `ieam400`, `ieam500`, `ieam600`, `ieam700`, `ieam900`, `ieama00`, `ieab200`, `ieav200` | Titles/forms confirmed by MVS library; exact current PDF filenames not independently confirmed in this audit. Retain existing IDs, without claiming current URL verification. |
| `ieam800` | [Observed 3.1 PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieam800_v3r1.pdf) confirms Volume 8 (IEF–IGD); library confirms SA38-0675-60. |
| `ieac600` | [Observed 3.2 PDF](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/ieac600_v3r2.pdf) confirms IPCS User's Guide; library supplies missing form SA23-1384. |
| `ieaf200` | [IBM APAR OA61750](https://www.ibm.com/support/pages/apar/OA61750) explicitly maps title, form SA38-0679 and 2.5 content ID. Exact 3.1 PDF filename not independently confirmed. |
| `e0zk100` | System-level library confirms Problem Management, SC23-6844. [IBM support article](https://www.ibm.com/support/pages/connectdirect-zos-getting-saba001i-dmvsamfh-s002-and-iec036i-002-a4-when-copying-pds-e-pds-e) links historical 2.3 content ID; exact 3.1 PDF filename not independently confirmed. |

Direct 3.1 PDF search results:
[System Commands](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag100_v3r1.pdf),
[JCL Reference](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab600_v3r1.pdf),
[Program Management](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieab100_v3r1.pdf).

## Sysplex, JES2, storage, UNIX, security, TSO/ISPF and other base books

## Reliable changes / caveats

- Fill idai500 form with **SC23-6856**; IBM current title is **DFSMS Using the Interactive Storage Management Facility** (catalog shorthand “DFSMS Using ISMF” is still recognizable). Current 3.2 form SC23-6856-70; 3.1 SC23-6856-60. Exact short ID independently appears in IBM-authored 2015 documentation presentation (primary author, hosted by SHARE), but current 3.2 ID was not independently observed on IBM domain.
- Fill halu101 form with **SC27-3661**. IBM APAR PH70091 explicitly maps the title to exact 3.2 PDF URL.
- izso100 is confirmed: IBM indexed exact 3.2 PDF title **zCX Guide**, content says this is a collection about IBM z/OS Container Extensions; no form number observed. Keep em dash, do not invent one.
- icha400 is confirmed historically as RACF Command Language Reference by IBM Copy Services Manager documentation and IBM Redbook; current RACF landing confirms SA23-2292-70. No evidence of a correction needed.
- f54ug00 exact 3.2 PDF/title observed; current ISPF landing confirms SC19-3627-70. No correction needed.
- e0zh300 exact current ID remains **unverified**. IBM landing confirms Release Upgrade Reference Summary SA23-2300-70 (3.2), SA23-2300-60 (3.1); historical IBM support links e0zh300 to message/interface changes material but does not establish current PDF mapping.
- Add halz002 — Communications Server: IP Configuration Guide — **SC27-3650**. Exact URL/title mapped by IBM APAR PH70091: https://www.ibm.com/docs/en/SSLTBW_3.2.0/pdf/halz002_v3r2.pdf . Form from Communications Server element table.
- Preserve local alias e0zs100 for SCRT **30.1 Using the Sub-Capacity Reporting Tool**, **SC23-6845-22**, but exact IBM filename observed is **scrt-30-1-0.pdf**, not e0zs100_v3r2.pdf: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/scrt-30-1-0.pdf . Search did not establish a 3.2-domain copy; local 3.2 storage is not proof of z/OS release applicability. The tool's own version is 30.1.

## Per-row status

Forms are base form numbers, with 3.2 edition suffix -70 and 3.1 -60 shown by IBM current element tables, unless otherwise noted. 'ID not independently verified' does not mean incorrect; retain pending stronger evidence rather than claim full verification.

| Catalog ID | Catalog title | Verified base form | Title/form evidence | Exact ID evidence/status |
|---|---|---|---|---|
| `ieaf100` | MVS Setting Up a Sysplex | SA23-1399 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-mvs) | [IBM hardware documentation explicit 3.2 ieaf100/title](https://www.ibm.com/docs/en/systems-hardware/zsystems/9176-ME2?topic=introduction-site-planning-checklist) |
| `ieai600` | MVS Programming: Sysplex Services Guide | SA23-1400 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-mvs) | ID not independently verified on current IBM release |
| `ieai700` | MVS Programming: Sysplex Services Reference | SA38-0658 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-mvs) | ID not independently verified on current IBM release |
| `hasa300` | JES2 Initialization and Tuning Guide | SA32-0991 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-jes2) | [IBM APAR OA61231 explicit 2.5 ID/title/form](https://www.ibm.com/support/pages/apar/OA61231) |
| `hasa400` | JES2 Initialization and Tuning Reference | SA32-0992 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-jes2) | [IBM APAR OA61231 explicit 2.5 ID/title/form](https://www.ibm.com/support/pages/apar/OA61231) |
| `idad400` | DFSMS Using Data Sets | SC23-6855 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idad500` | DFSMS Macro Instructions for Data Sets | SC23-6852 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idac100` | DFSMS Managing Catalogs | SC23-6853 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idac700` | DFSMS Installation Exits | SC23-6850 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idas300` | DFSMSdfp Advanced Services | SC23-6861 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idai500` | DFSMS Using ISMF | SC23-6856 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `idarr00` | DFSMSrmm Reporting | SC23-6875 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsms) | ID not independently verified on current IBM release |
| `icet100` | DFSORT Tuning Guide | SC23-6882 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-dfsort) | ID not independently verified on current IBM release |
| `bpxa500` | UNIX System Services Command Reference | SA23-2280 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-unix-system-services) | ID not independently verified on current IBM release |
| `bpxa400` | UNIX System Services User's Guide | SA23-2279 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-unix-system-services) | [Observed PDF/title](https://www.ibm.com/docs/en/SSLTBW_3.2.0/pdf/bpxa400_v3r2.pdf) |
| `bpxb200` | UNIX System Services Planning | GA32-0884 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-unix-system-services) | ID not independently verified on current IBM release |
| `bpxa600` | UNIX System Services Programming Tools | SA23-2282 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-unix-system-services) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/bpxa600_v3r2.pdf) |
| `bpxb600` | Using REXX and z/OS UNIX System Services | SA23-2283 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-unix-system-services) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/bpxb600_v3r2.pdf) |
| `ioea700` | File System Administration (zFS) | SC23-6887 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.1.0?topic=SSLTBW_3.1.0%2Fcom.ibm.zos.v3r1.pdf%2Fallpubs.htm) | ID not independently verified on current IBM release |
| `ioea500` | File System Messages and Codes | SC23-6885 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.1.0?topic=SSLTBW_3.1.0%2Fcom.ibm.zos.v3r1.pdf%2Fallpubs.htm) | ID not independently verified on current IBM release |
| `idan400` | Network File System Guide and Reference | SC23-6883 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-nfs) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/idan400_v3r2.pdf) |
| `icha400` | RACF Command Language Reference | SA23-2292 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-security-server-racf) | [IBM CSM documentation explicit icha400 Command Reference URL (2.2)](https://www.ibm.com/docs/en/SSESK4_6.3.15/pdf/csm-6.3.15-documentation.pdf) |
| `icha700` | RACF Security Administrator's Guide | SA23-2289 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-security-server-racf) | ID not independently verified on current IBM release |
| `icha100` | RACF General User's Guide | SA23-2298 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-security-server-racf) | ID not independently verified on current IBM release |
| `icha600` | RACF Messages and Codes | SA23-2291 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-security-server-racf) | ID not independently verified on current IBM release |
| `ichc600` | RACROUTE Macro Reference | SA23-2294 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-security-server-racf) | ID not independently verified on current IBM release |
| `ikjc500` | TSO/E Command Reference | SA32-0975 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-tsoe) | [Observed PDF/title](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ikjc500_v3r1.pdf) |
| `f54ug00` | ISPF User's Guide Vol I | SC19-3627 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/f54ug00_v3r2.pdf) |
| `f54u200` | ISPF User's Guide Vol II | SC19-3628 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | ID not independently verified on current IBM release |
| `f54sg00` | ISPF Services Guide | SC19-3626 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | ID not independently verified on current IBM release |
| `f54em00` | ISPF Edit and Edit Macros | SC19-3621 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | ID not independently verified on current IBM release |
| `f54pc00` | ISPF Planning and Customizing | GC19-3623 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/f54pc00_v3r2.pdf) |
| `f54rs00` | ISPF Reference Summary | SC19-3624 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=ispf) | ID not independently verified on current IBM release |
| `ceea300` | Language Environment Programming Reference | SA38-0683 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-language-environment) | ID not independently verified on current IBM release |
| `gim1000` | SMP/E Commands | SA23-2275 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-smpe) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/gim1000_v3r2.pdf) |
| `e0zb100` | Planning for Installation | GA32-0890 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-system-level) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/e0zb100_v3r2.pdf) |
| `e0zh300` | Release Upgrade Reference Summary | SA23-2300 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-system-level) | ID not independently verified on current IBM release |
| `izso100` | z/OS Container Extensions Guide | — (no form observed) | [IBM title/form](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/izso100_v3r2.pdf) | [Observed PDF/title](https://www.ibm.com/docs/SSLTBW_3.2.0/pdf/izso100_v3r2.pdf) |
| `izua700` | z/OSMF Programming Guide | SC27-8420 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-management-facility) | [Observed PDF/title](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/izua700_v3r1.pdf) |
| `halu101` | Communications Server IP System Administrator's Commands | SC27-3661 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-communications-server) | [IBM APAR PH70091 exact PDF/title](https://www.ibm.com/support/pages/apar/PH70091) |
| `halz002` | Communications Server IP Configuration Guide | SC27-3650 | Stored 3.1 cover and [IBM Communications Server library](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-communications-server) | [IBM APAR PH70091 exact 3.2 PDF mapping](https://www.ibm.com/support/pages/apar/PH70091) |
| `istopq0` | Communications Server Quick Reference | SC27-3665 | [IBM title/form](https://www.ibm.com/docs/en/zos/3.2.0?topic=zos-communications-server) | ID not independently verified on current IBM release |
| `e0zs100` | Using the Sub-Capacity Reporting Tool, SCRT 30.1 | SC23-6845-22 | Stored PDF cover and [observed IBM PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/scrt-30-1-0.pdf) | Local alias only; canonical filename is `scrt-30-1-0.pdf`. |

## Supplemental primary mapping evidence

IBM-authored *z/OS Documentation Update and Introduction to Knowledge Center*, ©2015 IBM, hosted by SHARE, lists legacy book IDs including ieai600 Sysplex Services Guide, ieai700 Sysplex Services Reference, idad400 Using Data Sets, idad500 Macro Instructions, idac100 Managing Catalogs, idac700 Installation Exits, idas300 Advanced Services, idai500 Using ISMF, idarr00 Reporting, icet100 Tuning Guide, ioea700 zFS Administration, ioea500 Distributed File Service Messages and Codes. This is primary IBM authorship but historical, and current forms/titles must use current IBM landing pages.

https://share.confex.com/share/125/webprogram/Handout/Session17656/Session%2017656%20-%20zOS%20Documentation%20Update%20and%20Introduction%20to%20Knowledge%20Center.pdf

IBM RACF historical mapping: https://public.dhe.ibm.com/s390/zos/racf/pdf/nyrug_2017_11_where_is_my_private_key.pdf explicitly gives icha400 Command Language Reference and icha700 Security Administration Guide links.

IBM primary record for exact new Communications PDF mappings: https://www.ibm.com/support/pages/apar/PH70091 .

## Unverified items that should remain explicit

All table rows marked “ID not independently verified on current IBM release” have title/form support but no independently observed current exact-ID URL. Particularly e0zh300, ISPF f54u200/f54sg00/f54em00/f54rs00, `ceea300`, and Security icha600/ichc600 should not be described as fully URL-validated. No contradictory code/form mapping was found within this scope; missing forms and conservative validation status are the concrete changes.

## Redbooks and Redpapers

All 37 existing IDs and added `sg247621` match IBM abstract page titles/forms.

| ID | IBM page title | Form | Page publication / update date | Primary evidence |
|---|---|---|---|---|
| `sg246472` | System Programmer's Guide to: Workload Manager | SG24-6472-03 | 23 February 2007, updated 20 April 2010 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246472.html) |
| `sg246645` | Effective zSeries Performance Monitoring Using Resource Measurement Facility | SG24-6645-00 | 29 April 2005, updated 30 April 2008 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246645.html) |
| `sg248292` | IBM z/OS V2R2: Performance | SG24-8292-00 | 17 December 2015 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248292.html) |
| `sg246327` | ABCs of z/OS System Programming Volume 11 | SG24-6327-01 | 08 December 2010 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246327.html) |
| `redp5238` | Benefits of Configuring More Memory in the IBM z/OS Software Stack | REDP-5238-01 | 21 January 2017, updated 18 February 2017 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/redp5238.html) |
| `sg246981` | ABCs of IBM z/OS System Programming Volume 1 | SG24-6981-04 | 07 November 2017, updated 22 January 2018 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246981.html) |
| `sg246982` | ABCs of IBM z/OS System Programming Volume 2 | SG24-6982-04 | 07 April 2018 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246982.html) |
| `sg246985` | ABCs of z/OS System Programming: Volume 5 | SG24-6985-02 | 13 May 2011 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246985.html) |
| `sg246988` | ABCs of z/OS System Programming Volume 8 | SG24-6988-01 | 11 July 2012, updated 26 July 2012 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246988.html) |
| `sg246989` | ABCs of z/OS System Programming: Volume 9 | SG24-6989-05 | 28 April 2011, updated 13 May 2011 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246989.html) |
| `sg246990` | ABCs of z/OS System Programming Volume 10 | SG24-6990-05 | 04 May 2018 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246990.html) |
| `sg247605` | z/OS Version 1 Release 10 Implementation | SG24-7605-00 | 13 April 2009 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247605.html) |
| `sg247729` | z/OS Version 1 Release 11 Implementation | SG24-7729-00 | 11 March 2010, updated 07 April 2010 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247729.html) |
| `sg247853` | z/OS Version 1 Release 12 Implementation | SG24-7853-00 | 15 April 2011, updated 27 April 2011 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247853.html) |
| `sg247817` | System z Parallel Sysplex Best Practices | SG24-7817-00 | 11 January 2011 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247817.html) |
| `sg248420` | IBM CICS and the Coupling Facility: Beyond the Basics | SG24-8420-00 | 21 February 2018 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248420.html) |
| `sg248579` | IBM z17 (9175) Technical Guide | SG24-8579-00 | 02 July 2025, updated 26 October 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248579.html) |
| `sg248580` | IBM z17 Technical Introduction | SG24-8580-01 | 07 July 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248580.html) |
| `sg248581` | IBM z17 Configuration Setup | SG24-8581-00 | 02 December 2025, updated 14 May 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248581.html) |
| `sg248608` | IBM z17 ME2 and IBM z17 MER Technical Guide | SG24-8608-00 | 15 October 2026, updated 19 October 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248608.html) |
| `sg245444` | IBM Z Connectivity Handbook | SG24-5444-24 | 07 July 2026, updated 09 July 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg245444.html) |
| `sg248480` | IBM Z Time Synchronization Implementation Guide | SG24-8480-02 | 05 September 2025, updated 25 August 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248480.html) |
| `sg248446` | Getting Started with Business Continuity on IBM Z | SG24-8446-01 | 24 August 2026, updated 26 August 2026 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248446.html) |
| `sg248536` | IBM Db2 13 for z/OS Performance Topics | SG24-8536-00 | 27 January 2023, updated 07 September 2023 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248536.html) |
| `sg248527` | IBM Db2 13 for z/OS and More | SG24-8527-00 | 31 May 2022, updated 20 June 2022 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248527.html) |
| `sg248222` | IBM DB2 11 for z/OS Performance Topics | SG24-8222-00 | 25 July 2014, updated 11 August 2014 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248222.html) |
| `sg248182` | Subsystem and Transaction Monitoring and Tuning with DB2 11 for z/OS | SG24-8182-00 | 28 February 2014, updated 31 August 2022 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248182.html) |
| `sg247942` | DB2 10 for z/OS Performance Topics | SG24-7942-00 | 22 June 2011, updated 23 August 2013 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247942.html) |
| `redp5092` | IBM DB2 11 for z/OS Buffer Pool Monitoring and Tuning | REDP-5092-00 | 10 July 2014, updated 31 July 2014 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/redp5092.html) |
| `redp4604` | DB2 9 for z/OS: Buffer Pool Monitoring and Tuning | REDP-4604-00 | 25 October 2009 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/redp4604.html) |
| `sg247324` | IMS Performance and Tuning Guide | SG24-7324-00 | 18 December 2006 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247324.html) |
| `sg248298` | IBM CICS Performance Series: CICS TS for z/OS V5 Performance Report | SG24-8298-02 | 08 August 2019 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg248298.html) |
| `sg246063` | CICS Performance Analyzer | SG24-6063-00 | 01 December 2003, updated 13 August 2010 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246063.html) |
| `sg246351` | Threadsafe Considerations for CICS | SG24-6351-04 | 06 April 2012 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg246351.html) |
| `sg247687` | Considerations for CICS Web Services Performance | SG24-7687-00 | 21 May 2009 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247687.html) |
| `redp5170` | IBM CICS Performance Series: Effective Monitoring for CICS Performance Benchmarks | REDP-5170-00 | 18 February 2015 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/redp5170.html) |
| `redp5320` | IBM CICS Performance Series: CICS TS V5.3 Benchmark on IBM z13 | REDP-5320-00 | 16 January 2016 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/redp5320.html) |
| `sg247621` | ABCs of z/OS System Programming Volume 12 | SG24-7621-00 | 29 January 2010 | [IBM abstract](https://www.redbooks.ibm.com/abstracts/sg247621.html) |

Additional primary evidence: [WLM PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=3) confirms March 2008 edition. [Volume 12](https://www.redbooks.ibm.com/abstracts/sg247621.html) TOC confirms WLM scope. Search queries also used IBM-domain search for z17 codes, Volume 12, and ABC Volume 8/9/10; direct page inspections supply definitive ID/title mappings.


## Other IBM products

Exact PDF below means an observed IBM search result or library link, not necessarily a successful download. Candidate URLs remain unverified.

## Db2 13

Primary library: https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=SSEPEK_13.0.0%2Fhome%2Fsrc%2Ftpc%2Fdb2z_pdfmanuals.html

| ID | Title | Evidence level | Exact/candidate URL | Finding |
|---|---|---|---|---|
| db2z_13_msgsbook | Messages | Title only | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_msgsbook.pdf | Official Db2 13 PDF library lists Messages; exact PDF search found no match; candidate open 403. Existing GC28-2780 unverified. |
| db2z_13_sqlrefbook | SQL Reference | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_sqlrefbook.pdf | IBM indexed exact PDF title confirms Db2 13 for z/OS; edition 2026-04-06. Existing SC28-2773 not independently checked. |
| db2z_13_ugrefbook | Utility Guide and Reference | Title only | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_ugrefbook.pdf | Library verifies title; search returned Db2 12 and 10 PDF filenames only. Candidate 13 open 403; form unverified. |
| db2z_13_instbook | Installation and Migration Guide | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_instbook.pdf | IBM indexed exact PDF title confirms Db2 13, updated 2025-11-25. Stored local cover confirms GC28-2776-00. |
| db2z_13_dsharebook | Data Sharing: Planning and Administration | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_dsharebook.pdf | IBM indexed exact title page, Db2 13, SC28-2765-00, updated 2025-10-21. |
| db2z_13_trbshootbook | Troubleshooting for Db2 | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_trbshootbook.pdf | IBM indexed exact title page, Db2 13, updated 2025-11-14. |
| db2z_13_introbook | Introduction to Db2 for z/OS | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_introbook.pdf | IBM indexed exact PDF title, Db2 13, updated 2026-04-10. |
| db2z_13_wnewbook | What's New? | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_wnewbook.pdf | IBM indexed exact PDF title confirms Db2 13, updated 2025-11-25. Stored local cover confirms GC28-2776-00. |
| db2z_13_perfbook | Managing Performance | Title only | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf | Official Db2 13 library lists title. Searches returned Db2 12 exact perfbook, no 13 exact PDF. Keep explicit unverified filename status. |
| db2z_13_adminbook | Administration Guide | Exact PDF | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_adminbook.pdf | IBM indexed exact title page, SC28-2761-00, updated 2025-11-24. Remove existing guessed marker. |
| db2z_13_comrefbook | Command Reference | Title only | https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf | Official Db2 13 library lists title. No exact 13 filename evidence; candidate open 403. Keep unverified. |

IRLM special row: **irlm_mcbook**, title IRLM Messages and Codes for IMS and Db2 for z/OS. Db2 13 library confirms title. Existing legacy URL https://www.ibm.com/support/knowledgecenter/SSEPEK/pdf/irlm_mcbook.pdf not freshly verified. An exact IBM indexed alternate exists at https://www.ibm.com/docs/SSEPH2_15.6.0/pdf/irlm_mcbook.pdf and identifies IMS/Db2 for z/OS title. This is an IMS 15.6 path and must not silently be labeled Db2 13-specific. Original unversioned SSEPEK legacy path remains unresolved.

## CICS Version 6

Primary library: https://www.ibm.com/docs/en/cics-ts/6.x?topic=available-documentation-in-pdf

The library verifies current shared Version 6 scope. It also identifies stabilized manuals separately, so do not apply one pattern to arbitrary new CICS books without checking.

| ID | Title | Evidence level | Observed or candidate URL | Finding |
|---|---|---|---|---|
| performance_pdf | Performance Guide | Exact PDF (alternate path) | https://www.ibm.com/docs/SSGMCP_6.1.0/pdf/performance_pdf.pdf | IBM indexed title page explicitly Version 6. Current SSJL4D_6.x candidate not independently proven. |
| performance-report_pdf | Performance Report | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/performance-report_pdf.pdf | IBM indexed title page explicitly Version 6. Previous note that report was only seen under SSGMCP_6.1.0 is obsolete. |
| monitoring-reference_pdf | Monitoring CICS | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf | Indexed current SSJL4D_6.x PDF title matches. |
| statistics-reference_pdf | Statistics Reference | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/statistics-reference_pdf.pdf | Current Version 6 library verifies title; exact PDF search returned SSGMCP_5.4.0 instead. |
| sit-reference_pdf | System Initialization Parameter Reference | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/sit-reference_pdf.pdf | Indexed current SSJL4D_6.x PDF confirms title. |
| systemprogramming-reference_pdf | System Programming Reference | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/systemprogramming-reference_pdf.pdf | Current library verifies title; exact indexed PDF returned 5.5, not 6. |
| troubleshooting-guide_pdf | Troubleshooting CICS | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/troubleshooting-guide_pdf.pdf | Indexed current SSJL4D_6.x PDF confirms title. |
| db2_pdf | Db2 Guide | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/db2_pdf.pdf | Current Version 6 library search explicitly lists Db2 Guide. Exact PDF returned 5.4 only. |
| database-control_pdf | IMS Database Control Guide | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/database-control_pdf.pdf | Current Version 6 Administering CICS PDF explicitly refers to this title; exact current filename not verified. |
| intercommunication_pdf | Intercommunication Guide | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/intercommunication_pdf.pdf | Current library explicitly lists Version 6; exact current filename unverified. |
| administering_pdf | Administering CICS | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering_pdf.pdf | Indexed current SSJL4D_6.x PDF title confirms. |
| administering-cpsm_pdf | CICSPlex SM Administration | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering-cpsm_pdf.pdf | Current library explicitly lists Version 6; exact current filename unverified. |
| customization-guide_pdf | Developing CICS System Programs | Title only, weak | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/customization-guide_pdf.pdf | Current Version 6 Developing CICS Applications indexed PDF refers to developing system programs, but exact separate PDF title/filename not independently verified. Do not claim validated. |
| utilities-reference_pdf | Utilities Reference | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/utilities-reference_pdf.pdf | Current library lists Version 6 and Administering CICS names companion PDF; exact filename unverified. |
| api-reference_pdf | API (EXEC CICS) Reference | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/api-reference_pdf.pdf | Current library title uses API (EXEC CICS) Reference. IBM model-card source directly lists SSGMCP_6.1.0/pdf/api-reference_pdf.pdf, supporting alternate exact path, but title-page search yielded 5.5. |
| exci_pdf | Using EXCI | Title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/exci_pdf.pdf | Current library lists Version 6; exact indexed PDF found 5.6 only. |
| whatsnew_pdf | What's New | Exact PDF | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/whatsnew_pdf.pdf | Indexed current SSJL4D_6.x PDF title confirms. |
| cpsm-managing-workloads_pdf | CICSPlex SM Managing Workloads | Missing row; title only | https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf | Add requested missing title, but exact current filename remains unverified. Current library explicitly lists Version 6; candidate 6.x/6.1 opens inaccessible. Do not present guessed URL as tested. |

IBM source supporting API alternate exact path: https://www.ibm.com/docs/en/watsonx/watsonx-code-assistant-4z/2.x?topic=z-granite20bcodecobol-model-card lists https://www.ibm.com/docs/en/SSGMCP_6.1.0/pdf/api-reference_pdf.pdf as a source. This supports URL/product identity, separate from title-page verification.

## IMS 15.5

Primary library: https://www.ibm.com/docs/en/ims/15.5.0?topic=documentation-pdf-files-ims

The official library explicitly lists the seven titles below under IMS 15.5. Exact candidate PDF URLs were opened and all failed access (403); searches returned related titles/older-release PDFs or the IMS 15.5 Release Planning bibliography, rather than these exact 15.5 PDF files. Thus all seven are title/version-confirmed but **exact filename/path unverified**, including the first two rows previously not marked guessed. Do not remove existing guessed markers solely from title matches.

| ID | Verified title | Candidate URL | Evidence level |
|---|---|---|---|
| IMS_15.5_System_Administration | System Administration | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_System_Administration.pdf | Title/version only; exact URL unverified |
| IMS_15.5_System_Definition | System Definition | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_System_Definition.pdf | Title/version only; exact URL unverified |
| IMS_15.5_Database_Administration | Database Administration | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_Database_Administration.pdf | Title/version only; exact URL unverified |
| IMS_15.5_System_Utilities | System Utilities | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_System_Utilities.pdf | Title/version only; exact URL unverified |
| IMS_15.5_Messages_and_Codes_Volume_1_DFS_Messages | Messages and Codes, Volume 1: DFS Messages | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_Messages_and_Codes_Volume_1_DFS_Messages.pdf | Title/version only; exact URL unverified |
| IMS_15.5_Messages_and_Codes_Volume_2_Non-DFS_Messages | Messages and Codes, Volume 2: Non-DFS Messages | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_Messages_and_Codes_Volume_2_Non-DFS_Messages.pdf | Title/version only; exact URL unverified |
| IMS_15.5_Messages_and_Codes_Volume_4_IMS_Component_Codes | Messages and Codes, Volume 4: IMS Component Codes | https://www.ibm.com/docs/en/SSEPH2_15.5.0/pdf/IMS_15.5_Messages_and_Codes_Volume_4_IMS_Component_Codes.pdf | Title/version only; exact URL unverified |

Independent IMS 15.5 bibliography URL: https://www.ibm.com/docs/SSEPH2_15.5.0/pdf/IMS_15.5_Release_Planning.pdf lists System Administration, System Definition, Database Administration, System Utilities. Other exact versions seen by search: Database Administration 15.3, System Utilities 15.4, Messages Volume 2 15.2, Volume 1 unversioned IMS_15, Volume 4 IMS 13.1. None proves a 15.5 filename. The SSEPH2 family code is independently observed for IMS 15.5 PDFs (Release Planning and Database Utilities), so the product family code is supported separately from each candidate filename.

## IBM MQ 9.4

Primary library: https://www.ibm.com/docs/en/ibm-mq/9.4.x?topic=am-mq-94-pdf-files-product-documentation-program-directories

Official IBM library lists every exact filename below and calls the documents IBM MQ 9.4 product documentation, same information as HTML. Direct PDF openings confirm release 9.4 on title pages of three books. Sources contain z/OS and other-platform sections; use 'cross-platform; includes z/OS' instead of implying every topic applies to every platform.

| ID | Official title/section | Exact URL | Finding |
|---|---|---|---|
| mq94.plan | Planning for IBM MQ | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.plan.pdf | Opened PDF, 210 pages |
| mq94.administer | Administering IBM MQ | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.administer.pdf | Official library exact filename; open 502 |
| mq94.refadmin | IBM MQ Administration reference | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.refadmin.pdf | Official library exact filename plus indexed exact PDF; open refused because PDF 13,408,949 bytes |
| mq94.reference | IBM MQ Reference | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.reference.pdf | Official library exact filename; open timed out |
| mq94.install | Installing and migrating IBM MQ | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.install.pdf | Opened PDF, 522 pages |
| mq94.techoview | IBM MQ Technical overview | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.techoview.pdf | Opened PDF, 302 pages |
| mq94.overview | IBM MQ Overview / About IBM MQ | https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/mq94.overview.pdf | Official library exact filename plus indexed exact PDF; open 502 |

MP16 special row: exact primary support page https://www.ibm.com/support/pages/mp16-ibm-mq-zos-capacity-planning-tuning verifies **MP16: IBM MQ for z/OS - Capacity planning & tuning**, explicitly a SupportPac. Its product identity is z/OS. Existing supportpac version/storage name is a local convention, not an IBM release assertion. The exact binary download filename mp16.pdf was not opened/verified in this run; keep landing page as source.

## OMEGAMON

| ID | Title | URL | Finding |
|---|---|---|---|
| omzmon560_usersguide | IBM Z OMEGAMON Monitor for z/OS 5.6 User's Guide | https://www.ibm.com/docs/en/SSPS7L_5.6.0/omzmon560_usersguide.pdf | Unverified exact URL/title page. Direct open timed out, exact searches no match. IBM shared docs and APARs corroborate product/version 5.6 but not this path or ID. Do not label verified. |
| kdpuge4 | IBM OMEGAMON for Db2 Performance Expert User's Guide | https://www.ibm.com/docs/en/SSUSPS_5.4.0/kdp54/kdpuge4.pdf | Exact IBM indexed PDF confirms title and 5.4 path. Source calls this the User's Guide containing Performance Expert content. |

Corroborating 5.6 product identity sources: https://www.ibm.com/support/pages/apar/OA68782 (component IBM Z OM Monitor for z/OS 5.6.0) and https://www.ibm.com/docs/en/SSAUBV/pdf/OM_shared.pdf. Neither verifies candidate SSPS7L_5.6.0 PDF URL. Related OMEGAMON 6.1 User's Guide observed https://www.ibm.com/docs/ko/SSPS7L_6.1.0/pdf/omzmon610_usersguide_pdf.pdf is **a different version/path**, not validation of the catalog 5.6 path.

## IBM Z Performance and Capacity Analytics 3.1

Primary downloadable library: https://www.ibm.com/docs/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/pdfmanuals.html

| ID | Title/form finding | URL | Evidence level |
|---|---|---|---|
| C2832131 | Capacity Planning Guide and Reference; Version 3.1; SC28-3213-01 | https://www.ibm.com/docs/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832131.pdf | Exact indexed IBM PDF title page confirms all values. Catalog's short Capacity Planning title should be expanded. |
| C2832130 | Claimed older Capacity Planning edition | https://www.ibm.com/docs/en/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832130.pdf | Exact filename and edition title unverified. Do not claim alias equivalence from naming alone. |
| C2832161 | Guide to Reporting; bibliography form SC28-3216 | https://www.ibm.com/docs/en/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832161.pdf | Title/form verified from IBM 3.1 library/bibliography; exact filename/path and -01 edition unverified. |
| C2832181 | Possible Language Guide and Reference; bibliography form SC28-3218 | https://www.ibm.com/docs/en/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832181.pdf | Exact filename-to-title mapping unverified. Association inferred from form/filename resemblance only. |
| C2832260 | Possible System Performance Feature Reference Volume I; bibliography form SC28-3226 | https://www.ibm.com/docs/en/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832260.pdf | Exact filename-to-title mapping unverified. Association inferred from form/filename resemblance only. |

Bibliography evidence (IBM PDF, p.185 onward): https://www.ibm.com/docs/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/C2832191.pdf%3Fview%3Dkc. This provides publication titles/forms, not the unresolved PDF filenames. Supplemental exact title/form confirmation for C2832131: https://www.ibm.com/docs/en/zp-and-ca/3.1.0?topic=capacity-planning-guide-reference (SC28-3213-01, applies Version 3 Release 1; page says June 2026).

The SSPNK7_3.1.0 product code is corroborated by exact indexed C2832131 and C2832111 PDFs and IBM Support product metadata. The observed exact C2832131 PDF URL omits /en; do not assume the /en variant is successfully fetched.

