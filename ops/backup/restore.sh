#!/usr/bin/env bash
# Restores ONE system from a backup made by backup.sh. This replaces the current data of that system.
# Usage:
#   ops/backup/restore.sh property backups/property-db-20261021-021500.dump [backups/property-files-20261021-021500.tgz]
#   ops/backup/restore.sh gym      backups/gym-db-....dump      [backups/gym-files-....tgz]
# The API of that system is stopped during the restore and started again afterwards.
set -euo pipefail

system="${1:-}" dump="${2:-}" files="${3:-}"
case "$system" in
  property) db_service=property-db db_user=property db_name=property api_service=property-api ;;
  gym) db_service=gym-db db_user=gym db_name=gym api_service=gym-api ;;
  *) echo "First argument must be 'property' or 'gym'"; exit 1 ;;
esac
[ -f "$dump" ] || { echo "Database dump not found: $dump"; exit 1; }
[ -z "$files" ] || [ -f "$files" ] || { echo "Files archive not found: $files"; exit 1; }

COMPOSE="docker compose"
echo "This will REPLACE all ${system} data with the backup ${dump}."
read -r -p "Type the system name (${system}) to continue: " answer
[ "$answer" = "$system" ] || { echo "Cancelled."; exit 1; }

$COMPOSE exec -T "$db_service" pg_restore --list < "$dump" > /dev/null || { echo "The dump cannot be read; nothing was changed."; exit 1; }

echo "Stopping ${api_service}"
$COMPOSE stop "$api_service"

echo "Restoring the database"
$COMPOSE exec -T "$db_service" psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db_name}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS ${db_name};" \
  -c "CREATE DATABASE ${db_name} OWNER ${db_user};"
$COMPOSE exec -T "$db_service" pg_restore -U "$db_user" -d "$db_name" --no-owner --exit-on-error < "$dump"

if [ -n "$files" ]; then
  echo "Restoring uploaded files"
  $COMPOSE run --rm --no-deps -T --entrypoint sh "$api_service" -c "find /data/storage -mindepth 1 -delete && tar -C /data/storage -xzf -" < "$files"
fi

echo "Starting ${api_service}"
$COMPOSE start "$api_service"
echo "Restore finished. Sign in and check recent records before telling staff."
