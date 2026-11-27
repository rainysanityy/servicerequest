#!/usr/bin/env python3
"""
Erzeugt die PDF-Dokumentation aus docs/src/*.md.

Pipeline: Markdown --pandoc--> HTML (M3-Druck-CSS) --Chromium (Playwright)--> PDF
  * Deckblatt separat (ohne Kopf-/Fußzeile)
  * Inhaltsverzeichnis mit Seitenzahlen (2 Durchläufe)
  * PDF-Lesezeichen (Outline) und Metadaten via pypdf

Voraussetzungen: pandoc >= 3, Python 3.11+, playwright (+ Chromium oder Google Chrome), pypdf, pdfplumber
  pip install playwright pypdf pdfplumber && playwright install chromium
"""
from __future__ import annotations

import html
import logging
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pdfplumber
from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter

logging.getLogger("pdfminer").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
ASSETS = ROOT / "assets"
OUT = ROOT / "pdf"


def blob(lobes: int, depth: float) -> str:
    pts = []
    for i in range(361):
        t = i / 360 * 2 * math.pi
        r = 0.5 - depth + depth * math.cos(lobes * t)
        pts.append(f"{0.5 + r * math.cos(t):.4f},{0.5 + r * math.sin(t):.4f}")
    return " ".join(pts)


def meta(md: str) -> dict[str, str]:
    m = re.match(r"^---\n(.*?)\n---\n", md, re.S)
    out: dict[str, str] = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip().strip('"')
    return out


def pandoc(args: list[str]) -> None:
    subprocess.run(["pandoc", *args], check=True)


def chrome_path() -> str | None:
    for c in ("google-chrome", "chromium", "chromium-browser"):
        p = shutil.which(c)
        if p:
            return p
    return None


HEADER = (
    '<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5pt;color:#625B71;'
    'padding:0 18mm 0 20mm;display:flex;justify-content:space-between;">'
    '<span>IT-Service-Request-Portal · {title}</span><span>{cls}</span></div>'
)
FOOTER = (
    '<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5pt;color:#625B71;'
    'padding:0 18mm 0 20mm;display:flex;justify-content:space-between;">'
    '<span>Version {version} · Stand {date}</span>'
    '<span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>'
)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def find_heading_pages(pdf_path: Path, ids: list[str]) -> dict[str, int]:
    """Findet unsichtbare Marker (ZQM<n>QZ) im PDF-Text und liefert Seite je Überschriften-ID."""
    result: dict[str, int] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for pno, p in enumerate(pdf.pages, start=1):
            txt = p.extract_text() or ""
            for mo in re.finditer(r"ZQM(\d+)QZ", txt):
                idx = int(mo.group(1))
                if idx < len(ids) and ids[idx] not in result:
                    result[ids[idx]] = pno
    return result


def build(md_path: Path, browser) -> Path:
    md = md_path.read_text(encoding="utf-8")
    m = meta(md)
    name = re.sub(r"^\d+-", "", md_path.stem)
    title = m.get("title", name)
    print(f"→ {name}.pdf")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        # ---- Deckblatt ------------------------------------------------------
        pandoc([str(md_path), f"--template={ASSETS / 'cover.html'}", "-V", f"blob1={blob(9, 0.06)}",
                "-V", f"blob2={blob(6, 0.09)}", "-o", str(tmp / "cover.html")])
        # ---- Inhalt ---------------------------------------------------------
        pandoc([str(md_path), "--from=markdown+fenced_divs+pipe_tables+implicit_figures",
                f"--template={ASSETS / 'body.html'}", f"--css={ASSETS / 'pdf.css'}", "--number-sections",
                "--toc", "--toc-depth=2", f"--resource-path={SRC}", "--embed-resources", "--standalone",
                "-o", str(tmp / "body.html")])
        body_html = (tmp / "body.html").read_text(encoding="utf-8")

        # TOC-Einträge ermitteln (id, Nummer, Titel)
        toc_entries = re.findall(
            r'<a href="#([^"]+)"[^>]*><span class="toc-section-number">([^<]+)</span>\s*(.*?)</a>', body_html, re.S)
        headings = [(i, n.strip(), html.unescape(re.sub(r"<[^>]+>", "", t)).strip()) for i, n, t in toc_entries]

        page = browser.new_page()
        pdf_opts = dict(format="A4", print_background=True, display_header_footer=True,
                        header_template=HEADER.format(title=html.escape(title), cls=html.escape(m.get("classification", "Intern"))),
                        footer_template=FOOTER.format(version=m.get("version", "1.0"), date=html.escape(m.get("date", ""))),
                        margin={"top": "22mm", "bottom": "20mm", "left": "20mm", "right": "18mm"})

        def render(src_html: str, out: Path) -> None:
            (tmp / "render.html").write_text(src_html, encoding="utf-8")
            page.goto((tmp / "render.html").as_uri())
            page.wait_for_load_state("networkidle")
            page.pdf(path=str(out), **pdf_opts)

        # Durchlauf 1: Seitenzahlen über unsichtbare Marker in den Überschriften ermitteln
        ids = [h[0] for h in headings]
        marked = body_html
        for n, hid in enumerate(ids):
            pat = rf'(<section[^>]*\bid="{re.escape(hid)}"[^>]*>\s*<h[1-6][^>]*>|<h[1-6][^>]*\bid="{re.escape(hid)}"[^>]*>)'
            marked = re.sub(pat, rf'\1<span class="mk">ZQM{n}QZ</span>', marked, count=1)
        render(marked, tmp / "pass1.pdf")
        pages = find_heading_pages(tmp / "pass1.pdf", ids)

        # Durchlauf 2: Seitenzahlen ins Inhaltsverzeichnis schreiben
        def add_pg(mo: re.Match[str]) -> str:
            hid = mo.group(1)
            pg = pages.get(hid, "")
            return f'{mo.group(0)}<span class="pg">{pg}</span>'
        nav_start = body_html.index('<nav id="TOC"')
        nav_end = body_html.index('</nav>', nav_start)
        nav = re.sub(r'<a href="#([^"]+)"[^>]*>.*?</a>', add_pg, body_html[nav_start:nav_end], flags=re.S)
        body2 = body_html[:nav_start] + nav + body_html[nav_end:]
        render(body2, tmp / "body.pdf")
        page.close()

        # Deckblatt ohne Kopf-/Fußzeile
        cpage = browser.new_page()
        cpage.goto((tmp / "cover.html").as_uri())
        cpage.pdf(path=str(tmp / "cover.pdf"), format="A4", print_background=True,
                  margin={"top": "0", "bottom": "0", "left": "0", "right": "0"}, page_ranges="1")
        cpage.close()

        # ---- Zusammenführen + Lesezeichen -----------------------------------
        writer = PdfWriter()
        for p in PdfReader(str(tmp / "cover.pdf")).pages:
            writer.add_page(p)
        body_reader = PdfReader(str(tmp / "body.pdf"))
        for p in body_reader.pages:
            writer.add_page(p)
        parents: dict[int, object] = {}
        for hid, num, t in headings:
            if hid not in pages:
                continue
            level = num.count(".")
            target = pages[hid]  # 1-basiert im Body; Deckblatt = Seite 0
            parent = parents.get(level - 1) if level > 0 else None
            item = writer.add_outline_item(f"{num} {t}", target, parent=parent)
            parents[level] = item
        writer.add_metadata({
            "/Title": title,
            "/Subject": m.get("subtitle", ""),
            "/Author": "IT-Service-Request-Portal · IT-Betrieb",
            "/Keywords": "IT-Service-Portal, Keycloak, BSI, NIST, DSGVO",
            "/Creator": "pandoc + Chromium",
        })
        writer.page_mode = "/UseOutlines"
        OUT.mkdir(exist_ok=True)
        out = OUT / f"{name}.pdf"
        with out.open("wb") as fh:
            writer.write(fh)
        missing = [h[2] for h in headings if h[0] not in pages]
        if missing:
            print(f"   ! ohne Seitenzahl: {missing[:5]}")
        print(f"   {len(writer.pages)} Seiten")
        return out


def main() -> int:
    files = sorted(SRC.glob("*.md"))
    if len(sys.argv) > 1:
        files = [f for f in files if any(a.lower() in f.name.lower() for a in sys.argv[1:])]
    with sync_playwright() as pw:
        exe = chrome_path()
        browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        for f in files:
            build(f, browser)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
