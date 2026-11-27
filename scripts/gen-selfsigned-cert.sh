#!/usr/bin/env bash
# =============================================================================
# NUR FÜR TEST/STAGING: erzeugt ein selbstsigniertes ECDSA-P-384-Zertifikat.
# Produktion: Zertifikat der Unternehmens-PKI (oder ACME) nach proxy/certs/
#             als tls.crt (inkl. Kette) und tls.key ablegen.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
HOST="${1:-$(grep -E '^PORTAL_HOSTNAME=' .env 2>/dev/null | cut -d= -f2 || true)}"
HOST="${HOST:-portal.example.local}"

mkdir -p proxy/certs
umask 077
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 \
  -keyout proxy/certs/tls.key -out proxy/certs/tls.crt -days 365 -sha384 \
  -subj "/CN=${HOST}/O=IT-Service-Portal (TEST)" \
  -addext "subjectAltName=DNS:${HOST}" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=serverAuth"
# nginx läuft im Container als UID 101 (rootless: subuid) -> Lesbarkeit über Verzeichnisrechte schützen
chmod 0444 proxy/certs/tls.crt proxy/certs/tls.key
chmod 0700 proxy/certs
echo "✓ Testzertifikat für ${HOST} erstellt (gültig 365 Tage)"
