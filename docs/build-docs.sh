#!/usr/bin/env bash
# Erzeugt alle PDFs aus docs/src/*.md (pandoc + Chromium/Playwright + pypdf).
# Optional: Dateinamenfilter als Argument, z. B. ./build-docs.sh Datenschutz
set -euo pipefail
cd "$(dirname "$0")"
command -v pandoc >/dev/null || { echo "pandoc fehlt (dnf install pandoc)"; exit 1; }
python3 build_docs.py "$@"
