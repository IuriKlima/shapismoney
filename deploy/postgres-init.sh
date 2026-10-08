#!/bin/sh
set -eu
# Runs only when an explicitly approved NEW database volume is initialized.
# Never pass passwords in arguments or enable shell tracing.
SIM_MIGRATOR_PASSWORD=$(cat "$SIM_MIGRATOR_PASSWORD_FILE")
SIM_APP_PASSWORD=$(cat "$SIM_APP_PASSWORD_FILE")
[ "${#SIM_MIGRATOR_PASSWORD}" -ge 20 ] && [ "${#SIM_APP_PASSWORD}" -ge 20 ] || { echo "Dedicated database passwords must contain at least 20 characters." >&2; exit 1; }
export SIM_MIGRATOR_PASSWORD SIM_APP_PASSWORD
psql --quiet --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv migrator_password SIM_MIGRATOR_PASSWORD
\getenv app_password SIM_APP_PASSWORD
CREATE ROLE sim_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE sim_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
REVOKE ALL ON DATABASE sim_platform FROM PUBLIC;
GRANT CONNECT ON DATABASE sim_platform TO sim_migrator,sim_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA sim AUTHORIZATION sim_migrator;
GRANT USAGE ON SCHEMA sim TO sim_app;
ALTER ROLE sim_migrator SET search_path=sim,pg_catalog;
ALTER ROLE sim_app SET search_path=sim,pg_catalog;
SQL
unset SIM_MIGRATOR_PASSWORD SIM_APP_PASSWORD
