#!/usr/bin/env bash
# Nightly Postgres dump for ExtSync - run via cron on the VPS:
#   15 3 * * * /root/extsync/infrastructure/scripts/backup-db.sh >> /root/extsync-backups/backup.log 2>&1
# Keeps 14 days of compressed dumps under ~/extsync-backups (protects against
# bad migrations / accidental deletes). For disk-failure protection, set
# BACKUP_S3_DEST (+ AWS_* / BACKUP_S3_ENDPOINT) to also copy each dump offsite.
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

# Optional offsite copy so a droplet disk loss does not take the DB AND its
# backups at once. Configure BACKUP_S3_DEST (e.g. s3://bucket/extsync) plus AWS_*
# creds (and BACKUP_S3_ENDPOINT for R2/Spaces); needs the aws CLI on the host.
if [ -n "${BACKUP_S3_DEST:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    if aws s3 cp "$OUT" "$BACKUP_S3_DEST/" ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"}; then
      echo "$(date -Is) offsite copy ok: $BACKUP_S3_DEST"
    else
      echo "WARNING: offsite copy failed for $OUT" >&2
    fi
  else
    echo "NOTE: BACKUP_S3_DEST set but the aws CLI is not installed; skipping offsite copy" >&2
  fi
fi

find "$BACKUP_DIR" -name 'extsync-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
