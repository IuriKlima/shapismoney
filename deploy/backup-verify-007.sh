#!/bin/sh
# No automatic shutdown: operator must arrange maintenance and stop only medsi_shapismoney.
# Creates a new private dump and restores it into an isolated disposable PostgreSQL container.
set -eu
umask 077
[ "$(id -u)" = 0 ] || { echo 'STOP: run as root.' >&2; exit 1; }
[ "$#" = 0 ] || { echo 'Usage: sh backup-verify-007.sh' >&2; exit 1; }
[ "$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' medsi_shapismoney)" = 0 ] || { echo 'STOP: Shape app must be stopped first.' >&2; exit 1; }
[ -z "$(docker ps -q --filter label=com.docker.swarm.service.name=medsi_shapismoney)" ] || { echo 'STOP: wait for Shape app tasks to stop.' >&2; exit 1; }
SIM_DB=$(docker ps -q --filter label=com.docker.swarm.service.name=medsi_shape-is-money-db)
[ "$(printf '%s\n' "$SIM_DB" | sed '/^$/d' | wc -l)" -eq 1 ] || { echo 'STOP: expected one Shape database container.' >&2; exit 1; }
SIM_IMAGE=$(docker inspect --format '{{.Image}}' "$SIM_DB")
BACKUP_DIR=$(mktemp -d /root/shape-backup007-XXXXXX)
chmod 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/schema-sim.dump"
docker exec -u postgres "$SIM_DB" pg_dump -U sim_bootstrap -d sim_platform -n sim -Fc > "$BACKUP"
chmod 600 "$BACKUP"
[ -s "$BACKUP" ] || { echo 'STOP: empty backup.' >&2; exit 1; }
docker exec -i -u postgres "$SIM_DB" pg_restore --list < "$BACKUP" > /dev/null
VERIFY_CONTAINER=''
cleanup() { if [ -n "$VERIFY_CONTAINER" ]; then docker rm -f "$VERIFY_CONTAINER" > /dev/null; fi; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
VERIFY_CONTAINER=$(docker run -d --network none --tmpfs /var/lib/postgresql/data:rw,nosuid --env POSTGRES_HOST_AUTH_METHOD=trust "$SIM_IMAGE" postgres -c "listen_addresses=")
ATTEMPT=0
until docker exec -u postgres "$VERIFY_CONTAINER" pg_isready -U postgres -d postgres > /dev/null 2>&1; do
 ATTEMPT=$((ATTEMPT + 1))
 [ "$ATTEMPT" -lt 30 ] || { echo 'STOP: isolated restore database not ready.' >&2; exit 1; }
 sleep 1
done
docker exec -u postgres "$VERIFY_CONTAINER" createdb -U postgres shape_verify
docker exec -i -u postgres "$VERIFY_CONTAINER" pg_restore -U postgres -d shape_verify --no-owner --no-privileges --exit-on-error < "$BACKUP"
VERIFY_SQL="SET search_path=sim,pg_catalog; SELECT name||':'||checksum FROM schema_migrations ORDER BY name; SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM students),(SELECT COUNT(*) FROM service_cases);"
LIVE=$(docker exec -u postgres "$SIM_DB" psql -U sim_bootstrap -d sim_platform -X -A -t -v ON_ERROR_STOP=1 -c "$VERIFY_SQL")
RESTORED=$(docker exec -u postgres "$VERIFY_CONTAINER" psql -U postgres -d shape_verify -X -A -t -v ON_ERROR_STOP=1 -c "$VERIFY_SQL")
[ "$LIVE" = "$RESTORED" ] || { echo 'STOP: restored catalog or row counts differ.' >&2; exit 1; }
[ "$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' medsi_shapismoney)" = 0 ] || { echo 'STOP: app resumed during backup.' >&2; exit 1; }
BACKUP_HASH=$(sha256sum "$BACKUP")
printf '%s\n' "${BACKUP_HASH%% *}" > "$BACKUP_DIR/restore-verified.sha256"
chmod 600 "$BACKUP_DIR/restore-verified.sha256"
printf 'Backup and isolated restore verified. Private path: %s\n' "$BACKUP"
echo 'This is a sim-schema backup including table data; keep files private. Do not upload or print contents.'
