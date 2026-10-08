#!/bin/sh
# Manual only: stop the Shape app, make and restore-test a new backup, then apply 007.
# Application baseline: adbd6926c534c8f6b47e8195dd4fa3247754e4f5 (expects 7 migrations).
set -eu
umask 077
[ "$(id -u)" = 0 ] || { echo 'STOP: run as root.' >&2; exit 1; }
[ "$#" = 1 ] || { echo 'Usage: sh manual-migrate-007.sh /root/shape-backup007-XXXXXX/schema-sim.dump' >&2; exit 1; }
BACKUP=$(realpath -e -- "$1")
case "$BACKUP" in /root/shape-backup007-*/schema-sim.dump) ;; *) echo 'STOP: expected new 007 backup.' >&2; exit 1;; esac
BACKUP_DIR=$(dirname -- "$BACKUP")
PROOF="$BACKUP_DIR/restore-verified.sha256"
for PRIVATE_FILE in "$BACKUP" "$PROOF"; do
 [ -f "$PRIVATE_FILE" ] && [ -s "$PRIVATE_FILE" ] && [ ! -L "$PRIVATE_FILE" ] || { echo 'STOP: missing private backup or restore proof.' >&2; exit 1; }
 [ "$(stat -c %u "$PRIVATE_FILE")" = 0 ] && [ "$(stat -c %a "$PRIVATE_FILE")" = 600 ] || { echo 'STOP: expected root-owned mode 600.' >&2; exit 1; }
done
[ "$(stat -c %u "$BACKUP_DIR")" = 0 ] && [ "$(stat -c %a "$BACKUP_DIR")" = 700 ] || { echo 'STOP: expected private root-owned directory.' >&2; exit 1; }
NOW=$(date +%s)
AGE=$((NOW - $(stat -c %Y "$BACKUP")))
[ "$AGE" -ge 0 ] && [ "$AGE" -le 3600 ] || { echo 'STOP: backup older than one hour; make a new one.' >&2; exit 1; }
EXPECTED=$(cat "$PROOF")
ACTUAL=$(sha256sum "$BACKUP")
ACTUAL=${ACTUAL%% *}
[ "${#EXPECTED}" = 64 ] && [ "$ACTUAL" = "$EXPECTED" ] || { echo 'STOP: backup changed after restore verification.' >&2; exit 1; }
[ "$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' medsi_shapismoney)" = 0 ] || { echo 'STOP: Shape app must remain stopped during backup/migration.' >&2; exit 1; }
[ -z "$(docker ps -q --filter label=com.docker.swarm.service.name=medsi_shapismoney)" ] || { echo 'STOP: wait for Shape app tasks to stop.' >&2; exit 1; }
SIM_DB=$(docker ps -q --filter label=com.docker.swarm.service.name=medsi_shape-is-money-db)
[ "$(printf '%s\n' "$SIM_DB" | sed '/^$/d' | wc -l)" -eq 1 ] || { echo 'STOP: expected one Shape database container.' >&2; exit 1; }
docker exec -i -u postgres "$SIM_DB" pg_restore --list < "$BACKUP" > /dev/null
echo 'Applying only 007. Keep app stopped until the seven-migration image is deployed.'
docker exec -i -u postgres "$SIM_DB" psql -U sim_bootstrap -d sim_platform -v ON_ERROR_STOP=1 <<'SHAPE_SQL'
SET ROLE sim_migrator;
SET search_path=sim,pg_catalog;
BEGIN;
SELECT pg_advisory_xact_lock(824017351);
DO $guard$ BEGIN
IF current_user <> 'sim_migrator'
OR (SELECT COUNT(*) FROM schema_migrations WHERE (name,checksum) IN (('001-core.sql','93b89daf027fddee2abebec5bbba608cac12a7ccbced3e38e89e99c96f1d340b'),('002-invitations.sql','e8db0813d51c3c0124513449ceb853905919ba88c85b265e91173c3552c23b80'),('003-execution.sql','0e3fc105311f504428b4f3fc11fbaa74d9201041759b02b609fc796a579e12e0'),('004-nutrition.sql','bb2b4a131e651821abf01fbaa992ef7d30ba9f905c90c3ee03e7b6cdc13b1351'),('005-ai-monthly-budget.sql','4bb26df61be71fe9a7d67a67534cca11cfa16cd70dabde7721a85e07a6f3546a'),('006-service-sla.sql','7c3560c59afb2c7fba7c6c080285cd183cc2b81d9e80dbaee5aca1642dc0009d'))) <> 6
OR EXISTS(SELECT 1 FROM schema_migrations WHERE (name,checksum) NOT IN (('001-core.sql','93b89daf027fddee2abebec5bbba608cac12a7ccbced3e38e89e99c96f1d340b'),('002-invitations.sql','e8db0813d51c3c0124513449ceb853905919ba88c85b265e91173c3552c23b80'),('003-execution.sql','0e3fc105311f504428b4f3fc11fbaa74d9201041759b02b609fc796a579e12e0'),('004-nutrition.sql','bb2b4a131e651821abf01fbaa992ef7d30ba9f905c90c3ee03e7b6cdc13b1351'),('005-ai-monthly-budget.sql','4bb26df61be71fe9a7d67a67534cca11cfa16cd70dabde7721a85e07a6f3546a'),('006-service-sla.sql','7c3560c59afb2c7fba7c6c080285cd183cc2b81d9e80dbaee5aca1642dc0009d'),('007-anamnesis.sql','eb04ff987300bfa10b3557a2c714d4c193f77646913b014942d91f1373ed12ca')))
OR EXISTS(SELECT 1 FROM users WHERE email LIKE '%@fixture.invalid')
OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('sim_app','sim_migrator') AND (rolsuper OR rolcreatedb OR rolcreaterole))
OR has_schema_privilege('sim_app','sim','CREATE')
OR has_table_privilege('sim_app','sim.schema_migrations','INSERT')
OR has_table_privilege('sim_app','sim.schema_migrations','UPDATE')
OR has_table_privilege('sim_app','sim.schema_migrations','DELETE')
THEN RAISE EXCEPTION 'Unexpected catalog, role privileges or fixtures'; END IF;
END $guard$;
DO $apply$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='007-anamnesis.sql') THEN
CREATE TABLE anamneses(student_id TEXT PRIMARY KEY REFERENCES students(id),org_id TEXT NOT NULL REFERENCES organizations(id),version TEXT NOT NULL,answers TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL CHECK(status IN ('draft','complete')),training_consent INTEGER NOT NULL CHECK(training_consent IN (0,1)),nutrition_consent INTEGER NOT NULL CHECK(nutrition_consent IN (0,1)),consent_version TEXT NOT NULL,consented_at BIGINT NOT NULL,completed_at BIGINT,revision INTEGER NOT NULL DEFAULT 1,attention_review INTEGER NOT NULL CHECK(attention_review IN (0,1)),reviewed_by TEXT REFERENCES users(id),reviewed_revision INTEGER,updated_at BIGINT NOT NULL);
CREATE INDEX anamneses_org ON anamneses(org_id,status);

INSERT INTO schema_migrations VALUES ('007-anamnesis.sql','eb04ff987300bfa10b3557a2c714d4c193f77646913b014942d91f1373ed12ca'); END IF; END $apply$;
GRANT SELECT,INSERT,UPDATE,DELETE ON anamneses TO sim_app;
COMMIT;
SET ROLE sim_app;
SELECT current_user,has_schema_privilege(current_user,'sim','CREATE') AS runtime_can_create;
SELECT name,checksum FROM schema_migrations ORDER BY name;
SELECT bool_and(has_table_privilege(current_user,'sim.anamneses',p)) AS anamnesis_dml_allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p;
SHAPE_SQL
echo '007 committed. Confirm catalog 001-007, CREATE=f, anamnesis_dml_allowed=t; deploy compatible image.'
