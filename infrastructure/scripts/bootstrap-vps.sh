#!/usr/bin/env bash
# One-shot ExtSync production bring-up on a fresh Ubuntu VPS.
#   bash infrastructure/scripts/bootstrap-vps.sh <domain>
# Installs Docker, generates all secrets + the Ed25519 signing key, writes
# .env.prod, builds and starts the stack, runs migrations, and seeds an admin.
# Idempotent: safe to re-run. SMTP (email) is left as a placeholder — fill it in
# .env.prod later (Resend) for real verification emails; login works without it.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then echo "usage: bootstrap-vps.sh <domain>   (e.g. extsync.com)"; exit 1; fi

# repo root = two levels up from this script
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "==> ExtSync bootstrap for domain: $DOMAIN  (repo: $(pwd))"

# 1) swap (insurance against OOM during image build on small VPS)
if [ ! -f /swapfile ]; then
  echo "==> creating 2G swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2) Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# 3) firewall (allow SSH + HTTP/HTTPS)
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80 >/dev/null 2>&1 || true
  ufw allow 443 >/dev/null 2>&1 || true
  yes | ufw enable >/dev/null 2>&1 || true
fi

# 4) .env.prod with generated secrets (URL-safe hex)
if [ ! -f .env.prod ]; then
  echo "==> generating .env.prod"
  cp .env.prod.example .env.prod
  set_kv() { sed -i "s|^$1=.*|$1=$2|" .env.prod; }
  set_kv DOMAIN "$DOMAIN"
  set_kv WEB_DOMAIN "$DOMAIN"
  set_kv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_kv S3_ACCESS_KEY "extsync$(openssl rand -hex 8)"
  set_kv S3_SECRET_KEY "$(openssl rand -hex 24)"
  set_kv JWT_SECRET "$(openssl rand -hex 32)"
  set_kv CSRF_SECRET "$(openssl rand -hex 32)"
  set_kv SIGNING_INTERNAL_TOKEN "$(openssl rand -hex 32)"
  set_kv EMAIL_FROM "\"ExtSync <no-reply@$DOMAIN>\""
else
  echo "==> .env.prod already exists, keeping it"
fi

# 5) Ed25519 signing key (private stays on server; derive raw public b64)
KEY=infrastructure/docker/prod-signing-key.pem
if [ ! -f "$KEY" ]; then
  echo "==> generating Ed25519 signing key"
  openssl genpkey -algorithm ed25519 -out "$KEY"
fi
# raw 32-byte public key = last 32 bytes of the DER SubjectPublicKeyInfo
PUB=$(openssl pkey -in "$KEY" -pubout -outform DER | tail -c 32 | base64 -w0)
sed -i "s|^SIGNING_ACTIVE_KEY_ID=.*|SIGNING_ACTIVE_KEY_ID=key-2026-01|" .env.prod
sed -i "s|^SIGNING_PUBLIC_KEYS=.*|SIGNING_PUBLIC_KEYS=key-2026-01:${PUB}|" .env.prod
echo "==> platform public key: key-2026-01:${PUB}"

DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# 6) build + start
echo "==> building and starting (this takes a few minutes the first time)"
$DC up -d --build

# 7) migrate + seed
echo "==> running migrations"
$DC run --rm api alembic upgrade head
echo "==> seeding admin + sample project"
$DC run --rm -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin-$(openssl rand -hex 6)}" \
              -e DEV_PASSWORD="${DEV_PASSWORD:-Dev-$(openssl rand -hex 6)}" \
   api python -m extsync_api.scripts.seed

echo ""
echo "============================================================"
echo " ExtSync is up. Next:"
echo "  1) DNS:  api.$DOMAIN  and  files.$DOMAIN  -> this server's IP"
echo "  2) Check: curl https://api.$DOMAIN/health/ready   (after DNS + HTTPS)"
echo "  3) Frontend: deploy apps/web to Vercel with NEXT_PUBLIC_API_URL=https://api.$DOMAIN"
echo "  4) Email: put a Resend API key in .env.prod (SMTP_PASSWORD) and: $DC up -d api worker"
echo "============================================================"
