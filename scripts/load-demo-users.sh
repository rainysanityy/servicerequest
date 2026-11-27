#!/usr/bin/env bash
# NUR TEST: kopiert Demo-Benutzer in das Realm-Importverzeichnis.
# Keycloak importiert sie beim nächsten Start (nur wenn der Realm noch nicht existiert).
set -euo pipefail
cd "$(dirname "$0")/.."
cp keycloak/demo-users/itportal-users-0.json keycloak/import/
echo "✓ Demo-Benutzer werden beim ersten Keycloak-Start importiert:"
echo "  anna.mueller (user) · uwe.helpdesk (first-level) · alex.admin (admin)"
echo "  Initialpasswörter siehe keycloak/demo-users/ – müssen beim 1. Login geändert werden."
echo "  In Produktion: keycloak/import/itportal-users-0.json wieder entfernen!"
