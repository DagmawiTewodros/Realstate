#!/usr/bin/env bash
# Backs up both systems: each database (pg_dump custom format) and each set of uploaded files.
# Run from the repository folder on the server, for example every night from cron:
#   15 2 * * * cd /srv/platform && ops/backup/backup.sh >> /var/log/platform-backup.log 2>&1
# Settings (environment variables):
#   BACKUP_DIR   where to write backups (default: ./backups)
#   KEEP_DAYS    delete local backups older than this (default: 14)
#   RCLONE_REMOTE  optional rclone destination for an off-site copy, for example "b2:company-backups/platform"
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
COMPOSE="docker compose"

mkdir -p "$BACKUP_DIR"
umask 077

backup_system() {
  local system="$1" db_service="$2" db_user="$3" db_name="$4" api_service="$5"
  local dump="$BACKUP_DIR/${system}-db-${STAMP}.dump"
  local files="$BACKUP_DIR/${system}-files-${STAMP}.tgz"

  echo "[$(date -u +%FT%TZ)] ${system}: dumping database"
  $COMPOSE exec -T "$db_service" pg_dump -U "$db_user" -d "$db_name" --format=custom --no-owner > "$dump.partial"
  mv "$dump.partial" "$dump"

  echo "[$(date -u +%FT%TZ)] ${system}: archiving uploaded files"
  $COMPOSE exec -T "$api_service" tar -C /data/storage -czf - . > "$files.partial"
  mv "$files.partial" "$files"

  # A dump that cannot be listed is broken; fail loudly rather than keep a bad backup.
  $COMPOSE exec -T "$db_service" pg_restore --list < "$dump" > /dev/null
  echo "[$(date -u +%FT%TZ)] ${system}: ok ($(du -h "$dump" | cut -f1) database, $(du -h "$files" | cut -f1) files)"
}

backup_system property property-db property property property-api
backup_system gym gym-db gym gym gym-api

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[$(date -u +%FT%TZ)] copying to ${RCLONE_REMOTE}"
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --include "*-${STAMP}.*"
fi

find "$BACKUP_DIR" -type f \( -name "*.dump" -o -name "*.tgz" \) -mtime "+${KEEP_DAYS}" -print -delete
echo "[$(date -u +%FT%TZ)] backup finished"
