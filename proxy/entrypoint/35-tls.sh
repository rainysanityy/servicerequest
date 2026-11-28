#!/bin/sh
# =============================================================================
# Wählt das TLS-Zertifikat und tauscht es im laufenden Betrieb (vom nginx-Entry-Point
# nach dem Rendern der Templates ausgeführt).
#
#   /etc/nginx/uploaded  Volume "tls": per Admin-Oberfläche hochgeladen (hat Vorrang)
#   /etc/nginx/certs     Server-Zertifikat aus proxy/certs (Rückfallebene)
#   /etc/nginx/conf.d/tls aktive Kopie (tmpfs) – darauf verweist die nginx-Konfiguration
#
# Änderungen an uploaded/meta.json werden alle TLS_WATCH_INTERVAL Sekunden erkannt.
# Neue Zertifikate werden nur übernommen, wenn "nginx -t" erfolgreich ist; sonst bleibt
# das bisherige Zertifikat aktiv.
# =============================================================================
set -eu
UP=/etc/nginx/uploaded
HOST=/etc/nginx/certs
ACTIVE=/etc/nginx/conf.d/tls
INTERVAL="${TLS_WATCH_INTERVAL:-15}"
log() { echo "tls: $*"; }

mkdir -p "$ACTIVE"
chmod 700 "$ACTIVE"

uploaded_present() { [ -s "$UP/meta.json" ] && [ -s "$UP/tls.crt" ] && [ -s "$UP/tls.key" ]; }

# install <quelle> – kopiert crt/key in die aktive Ablage und prüft die Konfiguration
install_from() {
  cp "$ACTIVE/tls.crt" "$ACTIVE/tls.crt.bak" 2>/dev/null || true
  cp "$ACTIVE/tls.key" "$ACTIVE/tls.key.bak" 2>/dev/null || true
  cp "$1/tls.crt" "$ACTIVE/tls.crt.new" && cp "$1/tls.key" "$ACTIVE/tls.key.new" || return 1
  chmod 600 "$ACTIVE/tls.crt.new" "$ACTIVE/tls.key.new"
  mv -f "$ACTIVE/tls.crt.new" "$ACTIVE/tls.crt"
  mv -f "$ACTIVE/tls.key.new" "$ACTIVE/tls.key"
  if nginx -t -q 2>/dev/null; then
    echo "$1" > "$ACTIVE/source"
    return 0
  fi
  log "Zertifikat aus $1 ist ungültig (nginx -t) – bisheriges bleibt aktiv"
  if [ -s "$ACTIVE/tls.crt.bak" ]; then
    mv -f "$ACTIVE/tls.crt.bak" "$ACTIVE/tls.crt"
    mv -f "$ACTIVE/tls.key.bak" "$ACTIVE/tls.key"
  fi
  return 1
}

# --- Start: hochgeladenes Zertifikat bevorzugen, sonst Server-Zertifikat
if uploaded_present && install_from "$UP"; then
  log "aktiv: hochgeladenes Zertifikat"
else
  install_from "$HOST" || { log "FEHLER: kein gültiges Zertifikat in $HOST"; exit 1; }
  log "aktiv: Server-Zertifikat (proxy/certs)"
fi

# --- Überwachung im Hintergrund
(
  state() { if uploaded_present; then md5sum "$UP/meta.json" | cut -d' ' -f1; else echo none; fi; }
  last="$(state)"
  while sleep "$INTERVAL"; do
    cur="$(state)"
    [ "$cur" = "$last" ] && continue
    last="$cur"
    sleep 2 # Schreibvorgang des Backends abschließen lassen
    if [ "$cur" = none ]; then src="$HOST"; else src="$UP"; fi
    if install_from "$src"; then
      if nginx -s reload 2>/dev/null; then log "Zertifikat gewechselt: $src (neu geladen)"; else log "Reload fehlgeschlagen"; fi
    fi
  done
) &
