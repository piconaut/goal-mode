---
name: "zos-docs"
description: Answer z/OS and mainframe questions with facts verified against IBM's own book PDFs, cited to the page. Use whenever the user asks about z/OS internals or operations — SMF record types and fields, RMF reports and Monitor III, WLM service classes and policies, PARMLIB members, JCL, system commands, abend/reason codes, messages (IEA, IEF, IXC, BPX...), sysplex, JES2, DFSMS, USS/zFS, RACF, TSO/ISPF — or wants an IBM doc reference for any of these, even if they don't ask for citations.
---

# z/OS answers verified against IBM books

Every factual statement in the answer must come from text you found in an IBM book PDF in
this session, cited to its page. The user wants verified facts only, so don't fill gaps
from memory — not even "probably" or "typically". Your own knowledge is still useful for
*finding* things (which book, which field name or keyword to grep for); it just can't be
the source of a claim.

The books live in the user's GitHub repo `piconaut/ibm-zos-books`, with text caches
committed beside each PDF so lookups cost a few hundred tokens instead of a whole book.
Two scripts do the work; run them, don't reimplement them:

- `scripts/books.py` — find a book (local clone first, GitHub second), add new books
- `scripts/pdf_find.py` — search a book: outline, grep, or read specific pages

`S=<this skill's directory>/scripts` below.

## 1. Pick the book

Read `references/zos-books.md` for the book ID (e.g. SMF = `ieag200`, Data Gatherer =
`grbdp00`, WLM planning = `ieaw100`, PARMLIB = `ieae200`). Use the release the user
mentioned, else 3.1, and say which. If the answer likely spans two books (e.g. SMF 70
layouts are in both `ieag200` and `grbdp00`), one is usually enough — start with the more
specific one.

The map links to dated validation evidence. An IBM library listing can confirm a title
and form number without confirming its exact PDF filename; respect the unverified markers.
RMF's Programmer's Guide (`erbrp00`) and Data Gatherer's Programmer's Guide (`grbdp00`)
are separate books. For SCRT, follow the map's explicit URL/local-alias instructions
rather than constructing a z/OS-release URL from its local filename.

**Redbooks** (`sgNNNNNN`, e.g. `sg246472` = SG24-6472) and Redpapers (`redpNNNN`) are
valid sources too. They often explain *how* something works internally (algorithms,
intervals, rules of thumb) where the product books only say how to configure it. Use one
when the product books don't cover the question or the user asks for one. Each is a
point-in-time snapshot by its authors, not product documentation, so:
- prefer the z/OS book when both cover the same fact, and say so if they disagree;
- in the answer, say the fact comes from a Redbook and give its edition date (it's on the
  title page; `pdf_find.py BOOK --page 3` shows it), since a 2008 Redbook may predate
  current behavior.

Redbooks have no release: `books.py locate sg246472` (the `--release` flag is ignored).
Known ones are listed in `references/zos-books.md`.

**Other products** (Db2, CICS, IMS, MQ, OMEGAMON, Z Performance and Capacity Analytics)
are listed in the same file. Their book ID is IBM's PDF file name without `.pdf`
(`db2z_13_msgsbook`, `sit-reference_pdf`, `IMS_15.5_System_Definition`, `mq94.plan`), and
the table gives the URL and the `--product`/`--version` to use. Pick the version the user runs;
if they haven't said, use the newest one listed and say so.

## 2. Get the book

```bash
python3 $S/books.py locate ieag200 --release 3.1
```

Prints the PDF path (exit 0). It checks local clones of `ibm-zos-books` first (`$ZOS_BOOKS_DIR`,
`~/ibm-zos-books`, `~/src/…`, the working directory and its parent), then pulls from
GitHub, checking out only that one book.

For other products, pass the file-name ID: `books.py locate db2z_13_msgsbook`.

**A missing book is fetched for you.** For a z/OS book or Redbook that isn't in the repo,
`locate` downloads it from IBM, checks it's a PDF, ingests it (caches, commit, push) and
prints the path, all in one step. ibm.com's robots.txt disallows only `/docs/api`, not the
`/docs/en/…/pdf/` files, and redbooks.ibm.com disallows only `/cgi-bin/` and `/api/`, so
fetching a single book PDF this way is fine. For other products, take the URL from the table
(if a row is marked *, confirm the name with one ibm.com-limited search first) and run:

```bash
python3 $S/books.py fetch https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering-cpsm_pdf.pdf --product cics --version 6
```

**Exit 3 = the download failed** (404, renamed book, no network). Try the obvious fix once:
the other release, or the book's current file name found with an ibm.com-limited search.
Only if that fails too, give the user the link and ask them to download it, then stop. Don't
answer from memory in the meantime.

When the user has downloaded it, find the file: an attachment in this conversation, `~/Downloads/`,
or a path they give you. Then add it to the repo:

```bash
python3 $S/books.py ingest ~/Downloads/ieag200_v3r1.pdf
```

That validates it's a PDF under GitHub's 100 MB limit, files it as
`{x.y}/{id}_v{x}r{y}.pdf`, writes the `.txt` and `.toc` caches beside it, commits and pushes.
If IBM's filename doesn't follow the `{id}_v{x}r{y}.pdf` pattern, pass `--id` and
`--release`. For other products, add `--product db2 --version 13` (directory names from the
table), and `--name <IBM file name>` if the download was renamed, e.g. `performance_pdf (1).pdf`. If the push fails, the commit is still local — tell the user so it doesn't
silently go missing.

`books.py list` shows what's already in the repo without downloading anything.

## 3. Find the text

Search for the most specific token first — a field name (`SMF70CPA`), member
(`IEASYSxx`), message ID (`IXC402D`), code (`0C4`), keyword (`PERIOD`):

```bash
python3 $S/pdf_find.py BOOK.pdf --grep SMF70CPA                  # hits with page + section
python3 $S/pdf_find.py BOOK.pdf --grep "SMF30" "CPU time" --all  # pages containing both
python3 $S/pdf_find.py BOOK.pdf --toc --filter "type 30"         # locate a section
python3 $S/pdf_find.py BOOK.pdf --page 512 --to 513              # read the pages grep found
```

Read whole pages only after grep has pointed at them, a page or two at a time. If the
output gets truncated, narrow the search rather than raising the limits.

If you can't find support for part of the question, say that part isn't covered by what
you found and name where you looked (book, search terms). An honest "not found in ieag200
under X or Y" is a valid answer; a guess isn't.

## 4. Answer

Lead with the answer, stated only as far as the text supports it. For field layouts give
offset, name, length, format and meaning as the book shows them — people use these to write
parsers. Keep direct quotes short; paraphrase the rest.

End with `Sources:`, one line per page used:

`[z/OS 3.1 MVS SMF (SA38-0667-60), p.512 — Record type 30 > Processor accounting section](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf#page=512)`

Other products follow the same shape. Name the product and version, and give the form
number when the table or the title page has one; the URL is the table's URL plus `#page=N`.

Redbook citation:

`[IBM Redbook SG24-6472-03, System Programmer's Guide to: Workload Manager (Mar 2008), p.40 — Chapter 3 > …](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=40)`

The page number and section breadcrumb come straight from `pdf_find.py` (`== p.N | …`);
`#page=N` uses that same PDF page index. Form numbers are in the book table.

## Example

User: what's SMF70CPA and when is it zero?

1. Book: RMF type 70 layout → `grbdp00` (3.1).
2. `books.py locate grbdp00` → path. (Exit 3 instead → the download failed: retry once as above, else give the user the link, stop.)
3. `pdf_find.py … --grep SMF70CPA` → `== p.N | SMF record type 70 > CPU data section`,
   then `--page N` if the hit lines don't show the full description.
4. Answer with the field's definition and the zero condition exactly as that page states
   them — or say the page doesn't state when it's zero — and cite `#page=N`.
