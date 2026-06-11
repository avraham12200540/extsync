#!/usr/bin/env bash
# Nightly Postgres dump for ExtSync - run via cron on the VPS:
#   15 3 * * * /root/extsync/infrastructure/scripts/backup-db.sh >> /root/extsync-backups/backup.log 2>&1
# Keeps 14 days of compressed dumps under ~/extsync-backups (protects against
# bad migrations / accidental deletes; pair with DigitalOcean droplet backups
# for disk-failure protection).
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root (~/extsync)
BACKUP_DIR="${BACKUP_DIR:-$HOME/extsync-backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F-%H%M)
OUT="$BACKUP_DIR/extsync-$STAMP.sql.gz"

docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$OUT"

# sanity: a real dump is never tiny
if [ "$(stat -c%s "$OUT")" -lt 1024 ]; then
  echo "ERROR: backup looks empty: $OUT" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'extsync-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
