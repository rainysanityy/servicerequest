#!/bin/sh
# -----------------------------------------------------------------------------
# Wird von postgres-Entrypoint NUR bei leerem Datenverzeichnis ausgeführt.
# Legt getrennte Rollen an (Least Privilege):
#   portal_migrator : Schema-Owner, führt Migrationen aus (DDL)
#   portal_app      : Laufzeitrolle der API (nur DML, Audit-Log append-only)
# Passwörter stammen aus Docker-Secrets, nicht aus Umgebungsvariablen.
# -----------------------------------------------------------------------------
set -eu

MIGRATOR_PW="$(cat /run/secrets/portal_migrator_db_password)"
APP_PW="$(cat /run/secrets/portal_app_db_password)"

psql -v ON_ERROR_STOP=1 \
     -v migrator_pw="$MIGRATOR_PW" \
     -v app_pw="$APP_PW" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE portal_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE portal_app      LOGIN PASSWORD :'app_pw'      NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Öffentliches Schema absichern
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS portal AUTHORIZATION portal_migrator;
GRANT CONNECT ON DATABASE :"DBNAME" TO portal_migrator, portal_app;
GRANT USAGE ON SCHEMA portal TO portal_app;

ALTER ROLE portal_migrator SET search_path = portal;
ALTER ROLE portal_app      SET search_path = portal;
ALTER ROLE portal_app      SET statement_timeout = '15s';
ALTER ROLE portal_app      SET idle_in_transaction_session_timeout = '30s';

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EOSQL
