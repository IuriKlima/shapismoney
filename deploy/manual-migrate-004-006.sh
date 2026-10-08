#!/bin/sh
# Reviewed application: fd0bd753658e5cd78b0b3e4ca969911612f7bd44
# Manual operation only. Download, verify SHA256, then execute separately.
set -eu
[ "$(id -u)" = 0 ] || { echo 'STOP: run as root.' >&2; exit 1; }
[ "$#" = 1 ] || { echo 'Usage: sh manual-migrate-004-006.sh /root/backup-directory/schema-sim.dump' >&2; exit 1; }
BACKUP=$(realpath -e -- "$1")
case "$BACKUP" in /root/*/schema-sim.dump) ;; *) echo 'STOP: expected existing private backup under /root.' >&2; exit 1;; esac
[ -f "$BACKUP" ] && [ -s "$BACKUP" ] || { echo 'STOP: backup missing or empty.' >&2; exit 1; }
[ "$(stat -c %u "$BACKUP")" = 0 ] || { echo 'STOP: backup must belong to root.' >&2; exit 1; }
case "$(stat -c %a "$BACKUP")" in 400|600) ;; *) echo 'STOP: backup must have private mode 400 or 600.' >&2; exit 1;; esac
SIM_DB=$(docker ps -q --filter label=com.docker.swarm.service.name=medsi_shape-is-money-db)
[ "$(printf '%s\n' "$SIM_DB" | sed '/^$/d' | wc -l)" -eq 1 ] || { echo 'STOP: expected exactly one Shape database container.' >&2; exit 1; }
# Validate the archive without printing data or restoring it.
docker exec -i -u postgres "$SIM_DB" pg_restore --list < "$BACKUP" > /dev/null
printf 'Applying 004/005/006 to Shape only. Deploy the six-migration application immediately after success.\n'
docker exec -i -u postgres "$SIM_DB" psql -U sim_bootstrap -d sim_platform -v ON_ERROR_STOP=1 <<'SHAPE_SQL'
SET ROLE sim_migrator;
SET search_path=sim,pg_catalog;
BEGIN;
SELECT pg_advisory_xact_lock(824017351);
DO $guard$ BEGIN IF current_user <> 'sim_migrator' OR (SELECT COUNT(*) FROM schema_migrations WHERE name IN ('001-core.sql','002-invitations.sql','003-execution.sql')) <> 3 OR EXISTS(SELECT 1 FROM schema_migrations WHERE (name,checksum) NOT IN (('001-core.sql','93b89daf027fddee2abebec5bbba608cac12a7ccbced3e38e89e99c96f1d340b'),('002-invitations.sql','e8db0813d51c3c0124513449ceb853905919ba88c85b265e91173c3552c23b80'),('003-execution.sql','0e3fc105311f504428b4f3fc11fbaa74d9201041759b02b609fc796a579e12e0'),('004-nutrition.sql','bb2b4a131e651821abf01fbaa992ef7d30ba9f905c90c3ee03e7b6cdc13b1351'),('005-ai-monthly-budget.sql','4bb26df61be71fe9a7d67a67534cca11cfa16cd70dabde7721a85e07a6f3546a'),('006-service-sla.sql','7c3560c59afb2c7fba7c6c080285cd183cc2b81d9e80dbaee5aca1642dc0009d'))) OR (EXISTS(SELECT 1 FROM schema_migrations WHERE name='005-ai-monthly-budget.sql') AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='004-nutrition.sql')) OR (EXISTS(SELECT 1 FROM schema_migrations WHERE name='006-service-sla.sql') AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='005-ai-monthly-budget.sql')) OR EXISTS(SELECT 1 FROM users WHERE email LIKE '%@fixture.invalid') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('sim_app','sim_migrator') AND (rolsuper OR rolcreatedb OR rolcreaterole)) OR has_schema_privilege('sim_app','sim','CREATE') THEN RAISE EXCEPTION 'Unexpected role, migration catalog or fixtures'; END IF; END $guard$;
DO $apply0$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='004-nutrition.sql') THEN
CREATE TABLE nutrition_credentials(user_id TEXT PRIMARY KEY REFERENCES users(id),org_id TEXT NOT NULL REFERENCES organizations(id),registration TEXT NOT NULL,verified INTEGER NOT NULL CHECK(verified IN (0,1)),verified_by TEXT NOT NULL REFERENCES users(id),verified_at BIGINT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE nutrition_foods(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),author_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,preparation TEXT NOT NULL CHECK(preparation IN ('raw','cooked','as-sold')),composition TEXT NOT NULL,allergens TEXT NOT NULL,may_contain TEXT NOT NULL,provenance TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','approved')),approved_by TEXT REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL);
CREATE TABLE nutrition_plans(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),student_id TEXT NOT NULL REFERENCES students(id),author_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','review','approved','published')),approved_by TEXT REFERENCES users(id),approved_revision INTEGER,revision INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL,published_at BIGINT);
CREATE TABLE nutrition_choices(plan_id TEXT NOT NULL REFERENCES nutrition_plans(id),student_id TEXT NOT NULL REFERENCES students(id),meal_index INTEGER NOT NULL,item_index INTEGER NOT NULL,option_index INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(plan_id,student_id,meal_index,item_index));
CREATE TABLE nutrition_requests(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),student_id TEXT NOT NULL REFERENCES students(id),plan_id TEXT NOT NULL REFERENCES nutrition_plans(id),meal_index INTEGER NOT NULL,item_index INTEGER NOT NULL,request TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','reviewed','declined')),response TEXT NOT NULL DEFAULT '',reviewed_by TEXT REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 1,created_at BIGINT NOT NULL);
CREATE INDEX nutrition_foods_org ON nutrition_foods(org_id,status);
CREATE INDEX nutrition_plans_student ON nutrition_plans(student_id,created_at);
CREATE INDEX nutrition_requests_student ON nutrition_requests(student_id,status);

INSERT INTO schema_migrations VALUES ('004-nutrition.sql','bb2b4a131e651821abf01fbaa992ef7d30ba9f905c90c3ee03e7b6cdc13b1351'); END IF; END $apply0$;
DO $apply1$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='005-ai-monthly-budget.sql') THEN
CREATE TABLE ai_monthly_reservations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),actor_id TEXT NOT NULL REFERENCES users(id),student_id TEXT REFERENCES students(id),cycle TEXT NOT NULL,amount_micros BIGINT NOT NULL CHECK(amount_micros>0),request_key TEXT NOT NULL,request_hash TEXT NOT NULL,metadata TEXT NOT NULL,created_at BIGINT NOT NULL,UNIQUE(actor_id,request_key));
CREATE TABLE ai_monthly_allocations(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),student_id TEXT NOT NULL REFERENCES students(id),cycle TEXT NOT NULL,amount_micros BIGINT NOT NULL CHECK(amount_micros>0),actor_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at BIGINT NOT NULL);
CREATE TABLE ai_budget_alerts(org_id TEXT NOT NULL REFERENCES organizations(id),scope_id TEXT NOT NULL,cycle TEXT NOT NULL,threshold INTEGER NOT NULL CHECK(threshold IN (70,90,100)),created_at BIGINT NOT NULL,PRIMARY KEY(org_id,scope_id,cycle,threshold));
CREATE INDEX ai_reservations_cycle ON ai_monthly_reservations(cycle,org_id,student_id);
CREATE INDEX ai_allocations_cycle ON ai_monthly_allocations(cycle,org_id,student_id);
INSERT INTO schema_migrations VALUES ('005-ai-monthly-budget.sql','4bb26df61be71fe9a7d67a67534cca11cfa16cd70dabde7721a85e07a6f3546a'); END IF; END $apply1$;
DO $apply2$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE name='006-service-sla.sql') THEN
CREATE TABLE service_cases(student_id TEXT PRIMARY KEY REFERENCES students(id),org_id TEXT NOT NULL REFERENCES organizations(id),started_at BIGINT NOT NULL,target_at BIGINT NOT NULL,promised_at BIGINT NOT NULL,onboarding_revision BIGINT NOT NULL,reviewed_revision BIGINT,responsible_id TEXT REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('waiting','in_progress','needs_info','delivered')),note TEXT NOT NULL DEFAULT '',revision BIGINT NOT NULL DEFAULT 1,updated_at BIGINT NOT NULL,delivered_at BIGINT);
CREATE INDEX service_cases_due ON service_cases(org_id,status,target_at);

INSERT INTO schema_migrations VALUES ('006-service-sla.sql','7c3560c59afb2c7fba7c6c080285cd183cc2b81d9e80dbaee5aca1642dc0009d'); END IF; END $apply2$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA sim TO sim_app;
REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM sim_app;
SELECT current_user;
SELECT name,checksum FROM schema_migrations ORDER BY name;
COMMIT;
SET ROLE sim_app;
SELECT current_user,has_schema_privilege(current_user,'sim','CREATE') AS runtime_can_create;
SELECT COUNT(*) AS synthetic_users FROM users WHERE email LIKE '%@fixture.invalid';
SELECT bool_and(has_table_privilege(current_user,'sim.service_cases',p)) AS service_dml_allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p;
SHAPE_SQL
printf 'Migration finished. Confirm catalog 001-006, CREATE=f, synthetic_users=0, service_dml_allowed=t.\n'
