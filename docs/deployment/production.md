# מדריך פריסה לפרודקשן

## ארכיטקטורה מומלצת
- **API** (FastAPI/uvicorn) מאחורי reverse proxy (nginx) עם TLS.
- **Worker** (תהליך נפרד, מתרחב אופקית).
- **Signing service** ברשת פנימית בלבד — **לא** נגיש מהאינטרנט.
- **PostgreSQL** מנוהל (גיבויים, PITR).
- **Redis** מנוהל (תור, rate-limit, pub/sub ל-WS).
- **Object storage**: Cloudflare R2 / AWS S3 (bucket artifacts ציבורי-קריאה או דרך CDN; bucket uploads פרטי).

## משתני סביבה קריטיים
החליפו את כל ה-`change_me_*` ב-`.env`:
- `JWT_SECRET`, `CSRF_SECRET`, `SIGNING_INTERNAL_TOKEN` — `openssl rand -hex 32`.
- `SESSION_COOKIE_SECURE=true`, `SAMESITE=lax` (או `strict`), מאחורי HTTPS.
- `ENVIRONMENT=production`.
- `SIGNING_*` — ראו למטה.
- `S3_*` — אישורי הספק; `S3_FORCE_PATH_STYLE=false` עבור R2/S3.
- `SMTP_*` — ספק אימייל אמיתי.

## חתימה
- צרו זוג Ed25519 ב-KMS/secret manager. ה-**פרטי** נטען רק לשירות החתימה (`SIGNING_PRIVATE_KEY_PATH`
  כ-mounted secret) — לעולם לא ב-repo/DB/Frontend.
- הפיצו את ה-**ציבורי** ל-Agent (מוטמע בבנייה: `keys.json`/`EXTSYNC_PUBLIC_KEYS`).
- תכננו רוטציה: `SIGNING_ACTIVE_KEY_ID` חדש + שמירת הציבורי הישן לאימות עד מעבר מלא.

## מסד נתונים
```bash
DATABASE_URL_SYNC=postgresql+psycopg://... alembic upgrade head
```
הריצו `make seed` רק לסביבת הדגמה; בפרודקשן צרו admin דרך סקריפט מבוקר.

## בריאות וניטור
- `/health/live`, `/health/ready`, `/health/{database,redis,storage,worker}`.
- Structured logs (JSON) עם request/correlation id; חברו ל-log aggregator.
- ה-Worker כותב heartbeat ל-Redis; `/health/worker` מדווח אם חי.

## אבטחת רשת
- שירות החתימה: רשת פנימית, ללא חשיפת port.
- bucket uploads: פרטי; bucket artifacts: קריאה ציבורית או CDN חתום.
- rate-limiting דרך Redis פעיל; ודאו ש-Redis זמין (אחרת fail-open).

## פריסת ה-Agent
- חתמו את ה-installer (Authenticode) למניעת אזהרות SmartScreen.
- אל תכניסו מפתחות חתימה ל-repo (§37); ה-CI לא יפרסם Agent ללא חתימה.
- עדכון עצמי של ה-Agent דרך `/agent/self-update` + `POST /admin/agent-versions` (חתום).

## CI/CD
ראו [.github/workflows/ci.yml](../../.github/workflows/ci.yml): lint, typecheck, בדיקות backend/worker/TS,
בניית web, בניית Agent/installer, סריקת אבטחה, ובניית image. פרסום Agent לפרודקשן דורש חתימה.
