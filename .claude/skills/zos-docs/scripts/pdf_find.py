#!/usr/bin/env python3
"""Token-cheap lookups in IBM z/OS book PDFs.

Prints only what you ask for — matching lines with page numbers and the
book section they fall under — instead of dumping the whole PDF.

Usage:
  pdf_find.py BOOK.pdf --toc [--filter REGEX] [--depth N]
      Print the book's outline (bookmarks) with page numbers.
  pdf_find.py BOOK.pdf --grep REGEX [REGEX ...] [--context N] [--max-hits N] [--all]
      Case-insensitive search. A page matches only if it contains ALL patterns
      when --all is given, otherwise ANY. Each hit shows page, section, and lines.
  pdf_find.py BOOK.pdf --page N [--to M] [--max-chars N]
      Print the text of page N (through M), whitespace-compacted.

Page numbers are PDF page indexes (1-based), which is what a reader's
"go to page" box and #page=N in a URL both use.

Text is extracted once per PDF and cached in ~/.cache/zos-docs/.
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

CACHE = os.path.expanduser("~/.cache/zos-docs")


def _key(path):
    st = os.stat(path)
    h = hashlib.sha1(f"{os.path.abspath(path)}|{st.st_size}|{st.st_mtime}".encode())
    return h.hexdigest()[:16]


def _sibling(path, ext):
    """Committed cache beside the PDF (ibm-zos-books repo layout), if present."""
    s = os.path.splitext(path)[0] + ext
    return s if os.path.exists(s) else None


def extract_pages(path):
    try:
        text = subprocess.run(["pdftotext", "-enc", "UTF-8", path, "-"],
                              capture_output=True, check=True).stdout.decode("utf-8", "replace")
    except (FileNotFoundError, subprocess.CalledProcessError):
        from pypdf import PdfReader
        text = "\f".join((p.extract_text() or "") for p in PdfReader(path).pages)
    return text.split("\f")


def load_pages(path):
    cache = _sibling(path, ".txt")
    if not cache:
        os.makedirs(CACHE, exist_ok=True)
        cache = os.path.join(CACHE, _key(path) + ".txt")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return f.read().split("\f")
    pages = extract_pages(path)
    with open(cache, "w", encoding="utf-8") as f:
        f.write("\f".join(pages))
    return pages


def load_outline(path):
    """Return [(page, depth, title)] sorted by page; empty if no bookmarks."""
    cache = _sibling(path, ".toc") or os.path.join(CACHE, _key(path) + ".toc")
    if os.path.exists(cache):
        out = []
        with open(cache, encoding="utf-8") as f:
            for line in f:
                p, d, t = line.rstrip("\n").split("\t", 2)
                out.append((int(p), int(d), t))
        return out
    out = extract_outline(path)
    os.makedirs(CACHE, exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        for p, d, t in out:
            f.write(f"{p}\t{d}\t{t}\n")
    return out


def extract_outline(path):
    out = []
    try:
        from pypdf import PdfReader
        r = PdfReader(path)

        def walk(items, depth):
            for it in items:
                if isinstance(it, list):
                    walk(it, depth + 1)
                else:
                    try:
                        out.append((r.get_destination_page_number(it) + 1, depth,
                                    " ".join(str(it.title).split())))
                    except Exception:
                        pass
        walk(r.outline, 0)
    except Exception:
        pass
    out.sort(key=lambda e: e[0])
    return out


def section_for(outline, page):
    """Breadcrumb of the deepest outline entries at or before this page."""
    crumbs = {}
    for p, d, t in outline:
        if p > page:
            break
        crumbs[d] = t
        for deeper in [k for k in crumbs if k > d]:
            del crumbs[deeper]
    return " > ".join(crumbs[k] for k in sorted(crumbs))


def compact(s):
    return re.sub(r"[ \t]+", " ", s).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--toc", action="store_true")
    g.add_argument("--grep", nargs="+", metavar="REGEX")
    g.add_argument("--page", type=int)
    ap.add_argument("--filter", help="with --toc: only entries matching this regex")
    ap.add_argument("--depth", type=int, default=2, help="with --toc: max depth (default 2)")
    ap.add_argument("--context", type=int, default=2, help="lines around each match (default 2)")
    ap.add_argument("--max-hits", type=int, default=15)
    ap.add_argument("--all", action="store_true", help="page must match every pattern")
    ap.add_argument("--to", type=int, help="with --page: last page")
    ap.add_argument("--max-chars", type=int, default=6000)
    a = ap.parse_args()

    if a.toc:
        outline = load_outline(a.pdf)
        if not outline:
            print("(no bookmarks in this PDF; use --grep instead)")
            return
        rx = re.compile(a.filter, re.I) if a.filter else None
        shown = 0
        for p, d, t in outline:
            if rx is None and d > a.depth:
                continue
            if rx and not rx.search(t):
                continue
            print(f"p.{p:<5} {'  ' * d}{t}")
            shown += 1
            if shown >= 400:
                print("... (truncated; narrow with --filter)")
                break
        return

    pages = load_pages(a.pdf)

    if a.page:
        last = a.to or a.page
        buf = []
        for n in range(a.page, min(last, len(pages)) + 1):
            body = "\n".join(compact(l) for l in pages[n - 1].splitlines() if l.strip())
            buf.append(f"--- p.{n} ---\n{body}")
        out = "\n".join(buf)
        if len(out) > a.max_chars:
            out = out[:a.max_chars] + f"\n... (truncated at {a.max_chars} chars; raise --max-chars or narrow --to)"
        print(out)
        return

    pats = [re.compile(p, re.I) for p in a.grep]
    outline = load_outline(a.pdf)
    hits = 0
    for n, text in enumerate(pages, 1):
        if a.all and not all(p.search(text) for p in pats):
            continue
        lines = text.splitlines()
        idx = [i for i, l in enumerate(lines) if any(p.search(l) for p in pats)]
        if not idx:
            continue
        # merge overlapping context windows
        windows = []
        for i in idx:
            lo, hi = max(0, i - a.context), min(len(lines), i + a.context + 1)
            if windows and lo <= windows[-1][1]:
                windows[-1][1] = hi
            else:
                windows.append([lo, hi])
        sec = section_for(outline, n) if outline else ""
        print(f"== p.{n}" + (f" | {sec}" if sec else ""))
        for lo, hi in windows:
            chunk = [compact(l) for l in lines[lo:hi] if l.strip()]
            print("   " + "\n   ".join(chunk))
            print("   ..")
        hits += 1
        if hits >= a.max_hits:
            print(f"(stopped at {a.max_hits} pages; refine patterns, add --all, or raise --max-hits)")
            break
    if hits == 0:
        print("(no matches)")


if __name__ == "__main__":
    main()
