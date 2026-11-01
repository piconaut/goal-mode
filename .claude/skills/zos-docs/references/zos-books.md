# z/OS book map

Every z/OS base book has a short **book ID** (e.g. `ieag200`). The same ID shows up in
three URL shapes, so once you know the ID you can build a citation without searching.

| Shape | Pattern | Example (SMF book, z/OS 3.1) |
|---|---|---|
| PDF (verified) | `https://www.ibm.com/docs/en/SSLTBW_{x.y.z}/pdf/{id}_v{x}r{y}.pdf` | `https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf` |
| PDF page | append `#page=N` (PDF page index, as printed by `pdf_find.py`) | `...ieag200_v3r1.pdf#page=212` |
| API content topic | `https://www.ibm.com/docs/api/v1/content/SSLTBW_{x.y.z}/com.ibm.zos.v{x}r{y}.{id}/{topic}.htm` | `.../SSLTBW_3.1.0/com.ibm.zos.v3r1.ieag200/records.htm` |
| Human topic page | `https://www.ibm.com/docs/en/zos/{x.y.z}?topic=...` | only from search results — the slug can't be guessed |

The PDF shape was confirmed for z/OS 3.1 and 3.2 (`SSLTBW_3.2.0`, `_v3r2`). Older releases
(2.4, 2.5) usually follow the same scheme (`SSLTBW_2.5.0`, `_v2r5`), but confirm with one
search before citing. Only cite an API-content `{topic}.htm` filename you've actually seen
(from the user or a search result); don't invent one.

Form numbers below are for 3.1 (suffix `-60`); 3.2 editions end in `-70`.

## Performance, capacity, measurement
| Book | ID | Form |
|---|---|---|
| MVS System Management Facilities (SMF) — record layouts | `ieag200` | SA38-0667 |
| RMF User's Guide | `erbru00` | SC27-4936 |
| RMF Report Analysis (field-by-field meaning of Postprocessor and Monitor III reports) | `erbb500` | SC34-2665 |
| RMF Messages and Codes | `erba200` | SC34-2666 |
| Data Gatherer Programmer's Guide (RMF/DG data, SMF 70–79 layouts, Monitor III DDS/APIs) | `grbdp00` | GC31-5701 |
| MVS Planning: Workload Management | `ieaw100` | SC34-2662 |
| MVS Programming: Workload Management Services | `ieaw200` | SC34-2663 |
| MVS Initialization and Tuning Guide | `ieae100` | SA23-1379 |
| MVS Initialization and Tuning Reference (PARMLIB members) | `ieae200` | SA23-1380 |

Note: the RMF Programmer's Guide didn't turn up as a separate `SSLTBW_3.1.0` PDF; record and
API content is in the Data Gatherer Programmer's Guide (`grbdp00`).

## Operations, JCL, messages
| Book | ID | Form |
|---|---|---|
| MVS System Commands | `ieag100` | SA38-0666 |
| MVS Planning: Operations | `ieag300` | SA23-1390 |
| MVS JCL Reference | `ieab600` | SA23-1385 |
| MVS JCL User's Guide | `ieab500` | SA23-1386 |
| MVS System Codes (abend/wait/reason codes) | `ieah700` | SA38-0665 |
| MVS System Messages Vol 1 (ABA–AOM) | `ieam100` | SA38-0668 |
| MVS System Messages Vol 2 (ARC–ASA) | `ieam200` | SA38-0669 |
| MVS System Messages Vol 3 (ASB–BPX) | `ieam300` | SA38-0670 |
| MVS System Messages Vol 4 (CBD–DMO) | `ieam400` | SA38-0671 |
| MVS System Messages Vol 5 (EDG–GLZ) | `ieam500` | SA38-0672 |
| MVS System Messages Vol 6 (GOS–IEA) | `ieam600` | SA38-0673 |
| MVS System Messages Vol 10 (IXC–IZP) | `ieama00` | SA38-0677 |
| MVS Program Management: User's Guide and Reference | `ieab100` | SA23-1393 |
| MVS Program Management: Advanced Facilities | `ieab200` | SA23-1392 |
| MVS Diagnosis: Reference | `ieav200` | GA32-0904 |
| MVS IPCS User's Guide | `ieac600` | — |
| MVS Using the Subsystem Interface | `ieaf200` | SA38-0679 |
| Problem Management | `e0zk100` | SC23-6844 |

Messages volumes 7–9 (IEB–IXC prefixes) follow the pattern `ieam700`, `ieam800`, `ieam900`
but weren't confirmed; search `"MVS System Messages Volume 7" z/OS 3.1` first.

## Sysplex
| Book | ID | Form |
|---|---|---|
| MVS Setting Up a Sysplex | `ieaf100` | SA23-1399 |
| MVS Programming: Sysplex Services Guide | `ieai600` | SA23-1400 |
| MVS Programming: Sysplex Services Reference | `ieai700` | SA38-0658 |

## JES2
| Book | ID | Form |
|---|---|---|
| JES2 Initialization and Tuning Guide | `hasa300` | SA32-0991 |
| JES2 Initialization and Tuning Reference | `hasa400` | SA32-0992 |

## Data management (DFSMS)
| Book | ID | Form |
|---|---|---|
| DFSMS Using Data Sets | `idad400` | SC23-6855 |
| DFSMS Macro Instructions for Data Sets | `idad500` | SC23-6852 |
| DFSMS Managing Catalogs | `idac100` | SC23-6853 |
| DFSMS Installation Exits | `idac700` | SC23-6850 |
| DFSMSdfp Advanced Services | `idas300` | SC23-6861 |
| DFSMS Using ISMF | `idai500` | — |
| DFSMSrmm Reporting | `idarr00` | SC23-6875 |
| DFSORT Tuning Guide | `icet100` | SC23-6882 |

## UNIX System Services and file systems
| Book | ID | Form |
|---|---|---|
| UNIX System Services Command Reference | `bpxa500` | SA23-2280 |
| UNIX System Services User's Guide | `bpxa400` | SA23-2279 |
| UNIX System Services Planning | `bpxb200` | GA32-0884 |
| UNIX System Services Programming Tools | `bpxa600` | SA23-2282 |
| Using REXX and z/OS UNIX System Services | `bpxb600` | SA23-2283 |
| File System Administration (zFS) | `ioea700` | SC23-6887 |
| File System Messages and Codes | `ioea500` | SC23-6885 |
| Network File System Guide and Reference | `idan400` | SC23-6883 |

## Security (RACF)
| Book | ID | Form |
|---|---|---|
| RACF Command Language Reference | `icha400` | SA23-2292 |
| RACF Security Administrator's Guide | `icha700` | SA23-2289 |
| RACF General User's Guide | `icha100` | SA23-2298 |
| RACF Messages and Codes | `icha600` | SA23-2291 |
| RACROUTE Macro Reference | `ichc600` | SA23-2294 |

## TSO/E, ISPF
| Book | ID | Form |
|---|---|---|
| TSO/E Command Reference | `ikjc500` | SA32-0975 |
| ISPF User's Guide Vol I | `f54ug00` | SC19-3627 |
| ISPF User's Guide Vol II | `f54u200` | SC19-3628 |
| ISPF Services Guide | `f54sg00` | SC19-3626 |
| ISPF Edit and Edit Macros | `f54em00` | SC19-3621 |
| ISPF Planning and Customizing | `f54pc00` | GC19-3623 |
| ISPF Reference Summary | `f54rs00` | SC19-3624 |

## Other
| Book | ID | Form |
|---|---|---|
| Language Environment Programming Reference | `ceea300` | SA38-0683 |
| SMP/E Commands | `gim1000` | SA23-2275 |
| Planning for Installation | `e0zb100` | GA32-0890 |
| Release Upgrade Reference Summary | `e0zh300` | SA23-2300 |
| z/OS Container Extensions Guide | `izso100` | — |
| z/OSMF Programming Guide | `izua700` | SC27-8420 |
| Communications Server IP System Administrator's Commands | `halu101` | — |
| Communications Server Quick Reference | `istopq0` | SC27-3665 |

## Redbooks and Redpapers
Stored in the repo as `redbooks/{id}.pdf`. ID = form number lowercased without hyphens
or edition (SG24-6472-03 → `sg246472`; REDP-5123 → `redp5123`).
PDF URLs: `https://www.redbooks.ibm.com/redbooks/pdfs/{sgNNNNNN}.pdf`,
`https://www.redbooks.ibm.com/redpapers/pdfs/{redpNNNN}.pdf`.
Edition dates aren't listed here; read them from the title page once the book is in the repo.
Every ID below was seen as a real Redbooks URL in a search.

**WLM, RMF, performance, capacity**
| Redbook | ID |
|---|---|
| System Programmer's Guide to: Workload Manager (WLM internals, policy adjustment) — SG24-6472-03, Mar 2008 | `sg246472` |
| Effective zSeries Performance Monitoring Using RMF | `sg246645` |
| IBM z/OS V2R2: Performance | `sg248292` |
| ABCs of z/OS System Programming Volume 11 (capacity planning, performance, RMF, SMF) | `sg246327` |
| Benefits of Configuring More Memory in the IBM z/OS Software Stack | `redp5238` |

**z/OS system programming (ABCs series and release implementation)**
| Redbook | ID |
|---|---|
| ABCs of z/OS System Programming Vol 1 | `sg246981` |
| ABCs of IBM z/OS System Programming Vol 2 | `sg246982` |
| ABCs of z/OS System Programming Vol 5 | `sg246985` |
| ABCs of z/OS System Programming Vol 8 | `sg246988` |
| ABCs of z/OS System Programming Vol 9 | `sg246989` |
| ABCs of z/OS System Programming Vol 10 | `sg246990` |
| z/OS V1R10 / V1R11 / V1R12 Implementation | `sg247605` / `sg247729` / `sg247853` |

**Parallel Sysplex and hardware**
| Redbook | ID |
|---|---|
| System z Parallel Sysplex Best Practices | `sg247817` |
| IBM CICS and the Coupling Facility: Beyond the Basics | `sg248420` |
| IBM z17 (9175) Technical Guide | `sg248579` |
| IBM z17 Technical Introduction | `sg248580` |
| IBM z17 Configuration Setup | `sg248581` |
| IBM z17 ME2 and MER Technical Guide (draft "redpiece" at time of search) | `sg248608` |
| IBM Z Connectivity Handbook | `sg245444` |
| IBM Z Time Synchronization Implementation Guide | `sg248480` |
| Getting Started with Business Continuity on IBM Z | `sg248446` |

**Db2 for z/OS**
| Redbook | ID |
|---|---|
| IBM Db2 13 for z/OS Performance Topics | `sg248536` |
| IBM Db2 13 for z/OS and More | `sg248527` |
| IBM DB2 11 for z/OS Performance Topics | `sg248222` |
| Subsystem and Transaction Monitoring and Tuning with DB2 11 for z/OS | `sg248182` |
| DB2 10 for z/OS Performance Topics | `sg247942` |
| IBM DB2 11 for z/OS Buffer Pool Monitoring and Tuning | `redp5092` |
| DB2 9 for z/OS: Buffer Pool Monitoring and Tuning | `redp4604` |

**IMS, CICS**
| Redbook | ID |
|---|---|
| IMS Performance and Tuning Guide | `sg247324` |
| IBM CICS Performance Series: CICS TS for z/OS V5 Performance Report | `sg248298` |
| CICS Performance Analyzer | `sg246063` |
| Threadsafe Considerations for CICS | `sg246351` |
| Considerations for CICS Web Services Performance | `sg247687` |
| IBM CICS Performance Series: Effective Monitoring for CICS Performance Benchmarks | `redp5170` |
| IBM CICS Performance Series: CICS TS V5.3 Benchmark | `redp5320` |

## Other IBM products
Stored in the repo as `products/{product}/{version}/{IBM PDF file name}`. The **book ID is
IBM's PDF file name without `.pdf`**: `books.py locate db2z_13_msgsbook`. Ingest with
`--product` and `--version` (the product names below are the directories to use). Rows
marked * follow the product's naming pattern but weren't seen in a search for that version;
confirm with a search before giving the user the link.

### Db2 for z/OS — `--product db2 --version 13`
URL: `https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/{id}.pdf`. Pattern: `db2z_{ver}_{book}book`
(Db2 12: `SSEPEK_12.0.0`, `db2z_12_…`).
| Book | ID | Form |
|---|---|---|
| Messages | `db2z_13_msgsbook` | GC28-2780 |
| SQL Reference | `db2z_13_sqlrefbook` | SC28-2773 |
| Utility Guide and Reference | `db2z_13_ugrefbook` | SC28-2774 |
| Installation and Migration Guide | `db2z_13_instbook` | GC28-2776 |
| Data Sharing: Planning and Administration | `db2z_13_dsharebook` | — |
| Troubleshooting for Db2 | `db2z_13_trbshootbook` | — |
| Introduction to Db2 for z/OS | `db2z_13_introbook` | — |
| What's New? | `db2z_13_wnewbook` | GC28-2784 |
| Managing Performance * | `db2z_13_perfbook` | — |
| Administration Guide * | `db2z_13_adminbook` | — |
| Command Reference * (seen for Db2 12: `db2z_12_comrefbook`) | `db2z_13_comrefbook` | — |
| IRLM Messages and Codes for IMS and Db2 (`https://www.ibm.com/support/knowledgecenter/SSEPEK/pdf/irlm_mcbook.pdf`) | `irlm_mcbook` | — |

### CICS Transaction Server for z/OS — `--product cics --version 6`
URL: `https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/{id}.pdf` (the Performance Guide and
Performance Report were seen under `SSGMCP_6.1.0` instead).
| Book | ID |
|---|---|
| Performance Guide | `performance_pdf` |
| Performance Report | `performance-report_pdf` |
| Monitoring CICS | `monitoring-reference_pdf` |
| CICS Statistics Reference | `statistics-reference_pdf` |
| System Initialization Parameter Reference | `sit-reference_pdf` |
| System Programming Reference | `systemprogramming-reference_pdf` |
| Troubleshooting CICS | `troubleshooting-guide_pdf` |
| Db2 Guide | `db2_pdf` |
| IMS Database Control Guide | `database-control_pdf` |
| Intercommunication Guide | `intercommunication_pdf` |
| Administering CICS | `administering_pdf` |
| CICSPlex SM Administration | `administering-cpsm_pdf` |
| Developing CICS System Programs | `customization-guide_pdf` |
| Utilities Reference | `utilities-reference_pdf` |
| API Reference | `api-reference_pdf` |
| Using EXCI | `exci_pdf` |
| What's New | `whatsnew_pdf` |

### IMS — `--product ims --version 15.5` (use the exact 15.x)
URL: `https://www.ibm.com/docs/en/SSEPH2_15.{n}.0/pdf/{id}.pdf`. File names include the
release from 15.2 on (`IMS_15.5_…`); 15.1 has none (`IMS_15_…`).
| Book | ID (15.5 shown) |
|---|---|
| System Administration | `IMS_15.5_System_Administration` |
| System Definition | `IMS_15.5_System_Definition` |
| Database Administration * (seen for 15.1, 15.3) | `IMS_15.5_Database_Administration` |
| System Utilities * (seen for 15.1) | `IMS_15.5_System_Utilities` |
| Messages and Codes Vol 1: DFS Messages * (seen for 15.1, 15.3) | `IMS_15.5_Messages_and_Codes_Volume_1_DFS_Messages` |
| Messages and Codes Vol 2: Non-DFS Messages * (seen for 15.6) | `IMS_15.5_Messages_and_Codes_Volume_2_Non-DFS_Messages` |
| Messages and Codes Vol 4: IMS Component Codes * (seen for 15.1) | `IMS_15.5_Messages_and_Codes_Volume_4_IMS_Component_Codes` |

### IBM MQ (includes z/OS) — `--product mq --version 9.4`
URL: `https://public.dhe.ibm.com/software/integration/wmq/docs/V9.4/PDFs/{id}.pdf`.
These books cover every platform; z/OS material is inside them.
| Book | ID |
|---|---|
| Planning | `mq94.plan` |
| Administering | `mq94.administer` |
| Administration Reference | `mq94.refadmin` |
| Reference | `mq94.reference` |
| Installing and migrating | `mq94.install` |
| Technical overview | `mq94.techoview` |
| Overview | `mq94.overview` |

MP16, *IBM MQ for z/OS – Capacity planning & tuning*, is a SupportPac. Its download page is
https://www.ibm.com/support/pages/mp16-ibm-mq-zos-capacity-planning-tuning; store it as
`--product mq --version supportpac --name mp16.pdf`.

### OMEGAMON — `--product omegamon --version 5.6`
| Book | ID | URL |
|---|---|---|
| IBM Z OMEGAMON Monitor for z/OS 5.6 User's Guide | `omzmon560_usersguide` | `https://www.ibm.com/docs/en/SSPS7L_5.6.0/omzmon560_usersguide.pdf` |
| OMEGAMON for Db2 Performance Expert 5.4 User's Guide (`--version 5.4`) | `kdpuge4` | `https://www.ibm.com/docs/en/SSUSPS_5.4.0/kdp54/kdpuge4.pdf` |

### IBM Z Performance and Capacity Analytics — `--product zpca --version 3.1`
URL: `https://www.ibm.com/docs/en/SSPNK7_3.1.0/com.ibm.tivoli.izpca.doc.3.1.0/{id}.pdf`.
The file names are opaque, so check the title page once a book is in the repo.
| Book | ID |
|---|---|
| Capacity Planning | `C2832131` (also `C2832130`, "Version 3 Release 1 Capacity Planning") |
| Guide to Reporting | `C2832161` |
| Other Version 3.1 books, title not shown in search | `C2832181`, `C2832260` |

### Not yet listed
For zSecure, Db2/IMS tools, z/OS Connect, and similar products: search
`site:ibm.com/docs "<product> <version>" pdf`, take the file name from the URL as the ID, and
ingest with a short `--product` name.
