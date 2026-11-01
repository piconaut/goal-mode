#!/usr/bin/env python3
"""Find, fetch and add IBM z/OS book PDFs in the ibm-zos-books repo.

Repo layout:   {x.y}/{id}_v{x}r{y}.pdf   z/OS library books
               redbooks/{sgNNNNNN|redpNNNN}.pdf   Redbooks / Redpapers (no release)
               products/{product}/{version}/{IBM file name}.pdf   other products
               plus .txt (page text, \\f-separated) and .toc (outline) caches
               beside each PDF, all committed.

Book IDs:
  z/OS library   short ID + release   ieag200 --release 3.1
  Redbooks       form number          sg246472, redp5092
  other products IBM's PDF file name  db2z_13_msgsbook, sit-reference_pdf, mq94.plan

Commands:
  books.py locate ID [--release 3.1]
      Print the path to the PDF. Looks in a local clone first; if the book
      isn't there, pulls the latest from GitHub (cloning blob-less into a cache
      dir if there's no local clone) and checks out only that book's files.
      A z/OS book or Redbook that isn't in the repo is downloaded from IBM and
      ingested automatically (--no-fetch to skip). Exit 0 = found (path on
      stdout); exit 3 = not in the repo and the download failed (the IBM PDF
      URL for the user to download is printed instead).
  books.py fetch URL [--id ID --release 3.1 | --product P --version V [--name F]]
      Download a PDF from IBM (curl, via HTTPS_PROXY if set), check it is a
      PDF, then ingest it as below. Exit 3 = download failed.
  books.py ingest FILE.pdf [--id ID --release 3.1 | --product P --version V [--name F]]
      Copy a PDF the user supplied into the repo, build its text caches,
      commit and push. z/OS books and Redbooks are recognized from IBM's file
      name; other products need --product and --version and are stored as
      products/{P}/{V}/{IBM file name}.
  books.py list
      List books in the repo (from git, without downloading any PDFs).

Env: ZOS_BOOKS_DIR (path of a local clone), ZOS_BOOKS_REPO (git URL).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_find  # noqa: E402

REPO_URL = os.environ.get("ZOS_BOOKS_REPO", "https://github.com/piconaut/ibm-zos-books.git")
REPO_NAME = "ibm-zos-books"
CACHE_CLONE = os.path.expanduser(f"~/.cache/zos-docs/{REPO_NAME}")
MAX_BYTES = 95 * 1024 * 1024  # GitHub rejects files over 100 MB


def log(msg):
    print(msg, file=sys.stderr)


def git(repo, *args, check=True):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=check)


def is_books_repo(path):
    if not os.path.isdir(os.path.join(path, ".git")):
        return False
    r = git(path, "remote", "get-url", "origin", check=False)
    return REPO_NAME in r.stdout


def candidate_dirs():
    home = os.path.expanduser("~")
    for base in (home, os.getcwd(), os.path.dirname(os.getcwd()), "/home/claude", "/workspace"):
        for sub in ("", "src", "git", "repos", "code", "projects", "Documents"):
            yield os.path.join(base, sub, REPO_NAME)
    yield CACHE_CLONE


def find_local_clone():
    env = os.environ.get("ZOS_BOOKS_DIR")
    if env:
        # An explicit setting is used alone: never fall back to another clone.
        env = os.path.abspath(os.path.expanduser(env))
        return env if os.path.isdir(os.path.join(env, ".git")) else None
    seen = set()
    for d in candidate_dirs():
        d = os.path.abspath(d)
        if d in seen:
            continue
        seen.add(d)
        if is_books_repo(d):
            return d
    return None


def get_clone():
    """A local clone, creating a blob-less one if needed (at $ZOS_BOOKS_DIR if set)."""
    repo = find_local_clone()
    if repo:
        return repo
    env = os.environ.get("ZOS_BOOKS_DIR")
    if env:
        env = os.path.abspath(os.path.expanduser(env))
        log(f"cloning {REPO_URL} (blob-less) into {env}")
        subprocess.run(["git", "clone", "--filter=blob:none", "--no-checkout", REPO_URL, env],
                       check=True, capture_output=True, text=True)
        return env
    log(f"no local clone found; cloning {REPO_URL} (blob-less) into {CACHE_CLONE}")
    os.makedirs(os.path.dirname(CACHE_CLONE), exist_ok=True)
    subprocess.run(["git", "clone", "--filter=blob:none", "--no-checkout", REPO_URL, CACHE_CLONE],
                   check=True, capture_output=True, text=True)
    return CACHE_CLONE


def has_commits(repo):
    return git(repo, "rev-parse", "--verify", "-q", "HEAD", check=False).returncode == 0


def default_branch(repo):
    r = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD", check=False)
    if r.returncode == 0:
        return r.stdout.strip().split("/", 1)[1]
    return "main"


def pull(repo):
    if git(repo, "ls-remote", "--heads", "origin", check=False).stdout.strip() == "":
        return  # remote still empty
    br = default_branch(repo)
    git(repo, "fetch", "-q", "origin", br, check=False)
    if has_commits(repo):
        # keep any local-only work; only fast-forward
        git(repo, "merge", "-q", "--ff-only", f"origin/{br}", check=False)
    else:
        git(repo, "checkout", "-q", "-B", br, f"origin/{br}", "--", ".", check=False)
        git(repo, "reset", "-q", f"origin/{br}", check=False)


def rel(release):
    m = re.fullmatch(r"(\d+)\.(\d+)(?:\.\d+)?", release)
    if not m:
        sys.exit(f"bad release {release!r}; use e.g. 3.1")
    return m.group(1), m.group(2)


REDBOOK_RX = re.compile(r"(sg\d{6}|redp\d{4})", re.I)
ZOS_ID_RX = re.compile(r"[a-z][a-z0-9]{4,7}")
UPLOAD_PREFIX_RX = re.compile(r"^[0-9a-f]{8}-")


def is_redbook(book_id):
    return bool(REDBOOK_RX.fullmatch(book_id))


def is_zos_id(book_id):
    return bool(ZOS_ID_RX.fullmatch(book_id)) and not is_redbook(book_id)


def stem_paths(stem):
    return stem + ".pdf", stem + ".txt", stem + ".toc"


def book_paths(book_id, release):
    """Repo paths for a z/OS library book or a Redbook."""
    if is_redbook(book_id):
        return stem_paths(f"redbooks/{book_id}")
    x, y = rel(release)
    return stem_paths(f"{x}.{y}/{book_id}_v{x}r{y}")


def ibm_url(book_id, release):
    if book_id.startswith("sg"):
        return f"https://www.redbooks.ibm.com/redbooks/pdfs/{book_id}.pdf"
    if book_id.startswith("redp"):
        return f"https://www.redbooks.ibm.com/redpapers/pdfs/{book_id}.pdf"
    x, y = rel(release)
    return f"https://www.ibm.com/docs/en/SSLTBW_{x}.{y}.0/pdf/{book_id}_v{x}r{y}.pdf"


def tree_pdfs(repo):
    if not has_commits(repo):
        return []
    out = git(repo, "ls-tree", "-r", "--name-only", "HEAD").stdout.splitlines()
    return [f for f in out if f.lower().endswith(".pdf")]


def find_by_name(repo, name):
    """Product books are found by IBM's PDF file name (stem), case-insensitively."""
    want = name.lower()
    if want.endswith(".pdf"):
        want = want[:-4]
    for f in tree_pdfs(repo):
        if os.path.splitext(os.path.basename(f))[0].lower() == want:
            return f
    return None


def in_tree(repo, path):
    if not has_commits(repo):
        return False
    return git(repo, "cat-file", "-e", f"HEAD:{path}", check=False).returncode == 0


def materialize(repo, paths):
    """Check out just these files (works in a --no-checkout blob-less clone)."""
    present = [p for p in paths if in_tree(repo, p)]
    missing = [p for p in present if not os.path.exists(os.path.join(repo, p))]
    if missing:
        git(repo, "checkout", "HEAD", "--", *missing)


def resolve(repo, book):
    """Repo-relative PDF path for this book, or None."""
    low = book.lower()
    if is_redbook(low) or is_zos_id(low):
        pdf = book_paths(low, ARGS_RELEASE)[0]
        if os.path.exists(os.path.join(repo, pdf)) or in_tree(repo, pdf):
            return pdf
        return None
    hit = find_by_name(repo, book)
    if hit:
        return hit
    # untracked local copy (e.g. an unpushed ingest)
    for root, _, files in os.walk(os.path.join(repo, "products")):
        for fn in files:
            if os.path.splitext(fn)[0].lower() == low.removesuffix(".pdf"):
                return os.path.relpath(os.path.join(root, fn), repo)
    return None


def cmd_locate(a):
    global ARGS_RELEASE
    ARGS_RELEASE = a.release
    repo = find_local_clone()
    if repo:
        pdf = resolve(repo, a.id)
        if pdf and os.path.exists(os.path.join(repo, pdf)):
            print(os.path.join(repo, pdf))
            return 0
    repo = repo or get_clone()
    pull(repo)
    pdf = resolve(repo, a.id)
    if pdf:
        materialize(repo, list(stem_paths(os.path.splitext(pdf)[0])))
        print(os.path.join(repo, pdf))
        return 0
    low = a.id.lower()
    if is_redbook(low) or is_zos_id(low):
        url = ibm_url(low, a.release)
        if not a.no_fetch:
            log(f"not in repo; fetching {url}")
            path = fetch_and_ingest(url, argparse.Namespace(id=low, release=None if is_redbook(low) else a.release,
                                                            product=None, version=None, name=None))
            if path:
                print(path)
                return 0
        what = f"Redbook {low}" if is_redbook(low) else f"{low} for z/OS {a.release}"
        print(f"NOT IN REPO: {what}. Automatic download failed; ask the user to download:\n{url}")
    else:
        print(f"NOT IN REPO: {a.id}. Fetch it with `books.py fetch URL --product P --version V`, the URL "
              "from references/zos-books.md (or a web search limited to ibm.com).")
    return 3


def download(url, dest):
    """Fetch url to dest with curl (honours HTTPS_PROXY and the system CA bundle). True if it's a PDF."""
    r = subprocess.run(["curl", "-sSfL", "--retry", "3", "--max-time", "600",
                        "-o", dest, url], capture_output=True, text=True)
    if r.returncode != 0:
        log(f"download failed: {r.stderr.strip()}")
        return False
    with open(dest, "rb") as f:
        if f.read(5) != b"%PDF-":
            log(f"{url} did not return a PDF (moved, renamed or behind a login)")
            return False
    return True


def fetch_and_ingest(url, ingest_args):
    """Download url into a fresh temp dir and ingest it. Returns the repo path, or None."""
    import tempfile
    d = tempfile.mkdtemp(prefix="zos-docs-dl-")
    name = os.path.basename(url.split("?")[0].split("#")[0]) or "book.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    src = os.path.join(d, name)
    try:
        if not download(url, src):
            return None
        ingest_args.file = src
        import io, contextlib
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = cmd_ingest(ingest_args)
        path = out.getvalue().strip().splitlines()[-1] if out.getvalue().strip() else None
        if rc == 4:
            log("ingested locally but not pushed; tell the user")
        return path if rc in (0, 4) else None
    finally:
        shutil.rmtree(d, ignore_errors=True)


def cmd_fetch(a):
    path = fetch_and_ingest(a.url, argparse.Namespace(id=a.id, release=a.release, product=a.product,
                                                     version=a.version, name=a.name))
    if not path:
        print(f"FETCH FAILED: ask the user to download {a.url}")
        return 3
    print(path)
    return 0


def cmd_ingest(a):
    src = os.path.expanduser(a.file)
    with open(src, "rb") as f:
        if f.read(5) != b"%PDF-":
            sys.exit(f"{src} is not a PDF")
    size = os.path.getsize(src)
    if size > MAX_BYTES:
        sys.exit(f"{src} is {size >> 20} MB; GitHub's limit is 100 MB per file (would need Git LFS)")
    name = UPLOAD_PREFIX_RX.sub("", os.path.basename(src))

    if a.product:
        if not a.version:
            sys.exit("--product needs --version (e.g. --product db2 --version 13)")
        fname = a.name or name
        if not fname.lower().endswith(".pdf"):
            fname += ".pdf"
        if not re.fullmatch(r"[A-Za-z0-9._-]+\.pdf", fname, re.I):
            sys.exit(f"unsafe file name {fname!r}; pass --name with IBM's PDF file name")
        prod = re.sub(r"[^a-z0-9-]", "", a.product.lower())
        ver = re.sub(r"[^A-Za-z0-9.]", "", a.version)
        pdf, txt, toc = stem_paths(f"products/{prod}/{ver}/{os.path.splitext(fname)[0]}")
        label = f"{prod} {ver}"
        book_id = os.path.splitext(fname)[0]
    else:
        book_id, release = (a.id or "").lower() or None, a.release
        m = re.search(r"([a-z0-9]+)_v(\d+)r(\d+)\.pdf$", name, re.I)
        rb = REDBOOK_RX.search(name)
        if m:
            book_id = book_id or m.group(1).lower()
            release = release or f"{m.group(2)}.{m.group(3)}"
        elif rb and not book_id:
            book_id = rb.group(1).lower()
        if not book_id or (not release and not is_redbook(book_id)):
            sys.exit("can't tell what book this is from the file name. For a z/OS book pass --id and "
                     "--release; for any other product pass --product and --version.")
        pdf, txt, toc = book_paths(book_id, release or "0.0")
        label = "Redbook" if is_redbook(book_id) else f"z/OS {release}"

    repo = get_clone()
    pull(repo)
    if has_commits(repo):
        # A --no-checkout clone's index holds only the books checked out so far; committing it as is
        # would delete every other book. Reset the index to HEAD so the commit adds just this one.
        git(repo, "reset", "-q")
    dest = os.path.join(repo, pdf)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.abspath(src) != os.path.abspath(dest):
        shutil.copyfile(src, dest)

    pages = pdf_find.extract_pages(dest)
    with open(os.path.join(repo, txt), "w", encoding="utf-8") as f:
        f.write("\f".join(pages))
    outline = pdf_find.extract_outline(dest)
    with open(os.path.join(repo, toc), "w", encoding="utf-8") as f:
        for p, d, t in outline:
            f.write(f"{p}\t{d}\t{t}\n")

    readme = os.path.join(repo, "README.md")
    if not os.path.exists(readme):
        with open(readme, "w") as f:
            f.write(README)
        git(repo, "add", "README.md")

    git(repo, "add", pdf, txt, toc)
    if git(repo, "diff", "--cached", "--quiet", check=False).returncode == 0:
        print(dest)
        log("already up to date in repo")
        return 0
    git(repo, "commit", "-q", "-m", f"Add {book_id} ({label}) with text caches")
    br = default_branch(repo) if has_commits(repo) else "main"
    r = git(repo, "push", "-q", "origin", f"HEAD:{br}", check=False)
    if r.returncode != 0:
        git(repo, "pull", "-q", "--rebase", "origin", br, check=False)
        r = git(repo, "push", "-q", "origin", f"HEAD:{br}", check=False)
    if r.returncode != 0:
        log(f"committed locally in {repo} but push failed:\n{r.stderr.strip()}")
        print(dest)
        return 4
    log(f"pushed {pdf} ({len(pages)} pages, {len(outline)} outline entries)")
    print(dest)
    return 0


README = """# ibm-zos-books

IBM book PDFs for the zos-docs skill, each with committed text caches beside it:
`.txt` (page text, form-feed separated) and `.toc` (outline: page, depth, title).

Layout:
- `{x.y}/{bookid}_v{x}r{y}.pdf` - z/OS base library books
- `redbooks/{sgNNNNNN|redpNNNN}.pdf` - Redbooks and Redpapers
- `products/{product}/{version}/{IBM PDF file name}` - Db2, CICS, IMS, MQ, OMEGAMON, ...
"""


def cmd_list(a):
    repo = get_clone()
    pull(repo)
    files = tree_pdfs(repo)
    print("\n".join(sorted(files)) if files else "(repo is empty)")
    return 0


ARGS_RELEASE = "3.1"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("locate"); p.add_argument("id"); p.add_argument("--release", default="3.1")
    p.add_argument("--no-fetch", action="store_true", help="don't download a missing book from IBM")
    p = sp.add_parser("ingest"); p.add_argument("file"); p.add_argument("--id"); p.add_argument("--release")
    p.add_argument("--product", help="non-z/OS product dir, e.g. db2, cics, ims, mq, omegamon, zpca")
    p.add_argument("--version", help="product version, e.g. 13, 6.1, 15.5, 9.4")
    p.add_argument("--name", help="IBM's PDF file name, if the local file was renamed")
    p = sp.add_parser("fetch"); p.add_argument("url"); p.add_argument("--id"); p.add_argument("--release")
    p.add_argument("--product"); p.add_argument("--version"); p.add_argument("--name")
    sp.add_parser("list")
    a = ap.parse_args()
    sys.exit({"locate": cmd_locate, "ingest": cmd_ingest, "fetch": cmd_fetch, "list": cmd_list}[a.cmd](a))


if __name__ == "__main__":
    main()
