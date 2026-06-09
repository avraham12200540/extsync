# פריסה לפרודקשן — VPS (Backend) + Vercel (Frontend)

מדריך מלא להעלאת ExtSync לאוויר כך שאנשים אמיתיים יוכלו להשתמש. ארכיטקטורה:

```
            דפדפן המשתמש
                 │
      ┌──────────┴───────────┐
      ▼                      ▼
  Vercel                  VPS (Caddy, HTTPS אוטומטי)
  <domain>             api.<domain>  files.<domain>
  (Next.js)                 │            │
                          api          minio
                       worker, signing, postgres, redis
```

עלות מוערכת: VPS ~$5/חודש + דומיין ~$10/שנה + (חינמי: Vercel, Resend).

---

## שלב 1 — דומיין
רכוש דומיין (מומלץ: Cloudflare Registrar / Porkbun / Namecheap). נניח `example.com`.

## שלב 2 — VPS
פתח VPS עם **Ubuntu 24.04** (Hetzner CX22 ~€4, או DigitalOcean $6, 2GB RAM+). שמור את כתובת ה-IP.

רשומות DNS (אצל הרשם / Cloudflare):
| סוג | שם | ערך |
|-----|----|-----|
| A | `api` | IP של ה-VPS |
| A | `files` | IP של ה-VPS |
| (Vercel — שלב 6) | `@` / `www` | לפי הוראות Vercel |

## שלב 3 — התקנת Docker על ה-VPS
```bash
ssh root@<VPS_IP>
curl -fsSL https://get.docker.com | sh
# פתח חומת אש לפורטים 80/443:
ufw allow 80 && ufw allow 443 && ufw allow OpenSSH && ufw --force enable
```

## שלב 4 — הורדת הקוד והגדרות
```bash
git clone https://github.com/avraham12200540/extsync.git
cd extsync
cp .env.prod.example .env.prod

# סודות:
sed -i "s/CHANGE_ME_hex32/$(openssl rand -hex 32)/" .env.prod   # (ערוך ידנית כל שדה)
nano .env.prod   # מלא DOMAIN, WEB_DOMAIN, סיסמאות, Resend API key וכו'

# מפתח חתימה לפרודקשן (נשמר רק על השרת):
SIGNING_ACTIVE_KEY_ID=key-2026-01 \
  python3 - <<'PY'
# או הריצו את infrastructure/scripts/gen_signing_key.py ושנו את שם הקובץ ל-prod-signing-key.pem
PY
# הדרך הפשוטה:
python3 infrastructure/scripts/gen_signing_key.py   # כותב dev-signing-key.pem
mv infrastructure/docker/dev-signing-key.pem infrastructure/docker/prod-signing-key.pem
# העתק את שורת SIGNING_PUBLIC_KEYS שהודפסה אל .env.prod
```

## שלב 5 — הרצה
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# מיגרציות + admin:
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  -e ADMIN_PASSWORD='choose-strong' -e DEV_PASSWORD='choose-strong' api python -m extsync_api.scripts.seed
```
Caddy ינפיק תעודות HTTPS אוטומטית. בדיקה:
```bash
curl https://api.<domain>/health/ready
```

## שלב 6 — Frontend על Vercel
1. היכנס ל-vercel.com עם GitHub, "Add New Project" → בחר את `extsync`.
2. **Root Directory**: `apps/web`. Framework: Next.js (אוטומטי).
3. **Environment Variables**:
   - `NEXT_PUBLIC_API_URL=https://api.<domain>`
   - `NEXT_PUBLIC_WS_URL=wss://api.<domain>`
   - `NEXT_PUBLIC_DEFAULT_LOCALE=he`
4. Deploy. ואז Settings → Domains → הוסף את `<domain>` (Vercel יראה אילו רשומות DNS להוסיף).
5. ודא ש-`.env.prod` בשרת מכיל `WEB_DOMAIN=<domain>` (כדי ש-CORS וה-cookies יעבדו), והפעל מחדש את ה-api:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`

> Cross-origin: ה-Frontend ב-`<domain>` וה-API ב-`api.<domain>` הם אותו registrable domain → cookies עם SameSite=Lax עובדים, וה-CORS מתיר את origin של ה-Frontend (מ-`PUBLIC_WEB_URL`).

## שלב 7 — ה-Agent מול הפרודקשן
1. ב-`apps/agent-windows` הגדר ברירת מחדל ל-API: `https://api.<domain>` (ב-`AgentSettings` או דרך `settings.json`).
2. הטמע את המפתח הציבורי של הפלטפורמה ב-`keys.json` ליד ה-exe (אותו `SIGNING_PUBLIC_KEYS`).
3. בנה וחתום את המתקין (Windows + .NET 8 + Inno Setup), והפץ אותו דרך **GitHub Releases** (דף ההורדה באתר מצביע לשם).

## שלב 8 — אימייל אמיתי
ב-resend.com: אמת את הדומיין (רשומות DKIM/SPF), צור API key, ושים אותו ב-`SMTP_PASSWORD`. עכשיו מיילי אימות יגיעו לתיבות אמיתיות.

## גיבוי
- Postgres: `docker compose -f docker-compose.prod.yml --env-file .env.prod exec postgres pg_dump -U extsync extsync > backup.sql` (תזמן ב-cron).
- **חובה לגבות** את `infrastructure/docker/prod-signing-key.pem` ואת volume של MinIO (artifacts).

## שדרוג אחסון (כשגדלים)
החלף את MinIO ב-Cloudflare R2 (ללא דמי egress): עדכן `S3_ENDPOINT_URL`, `S3_PUBLIC_ENDPOINT_URL`, מפתחות, ו-`S3_FORCE_PATH_STYLE=false`. ראו [production.md](production.md).
