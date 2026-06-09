# ExtSync

**פלטפורמה להפצה, התקנה, ניהול ועדכון של תוספי Chrome (Manifest V3) מחוץ ל-Chrome Web Store** — לתוספים פרטיים, ניסיוניים וצוותיים.

> ExtSync אינה תחליף רשמי ל-Chrome Web Store. בהתקנה הראשונה של תוסף לא ארוז, המשתמש חייב להפעיל "מצב מפתח" ולטעון את התיקייה ידנית ב-`chrome://extensions`. אין דרך נתמכת לבצע התקנה שקטה ומלאה של תוסף ב-Windows רגיל ללא Chrome Web Store וללא ניהול ארגוני. ExtSync הופכת את השלב הזה לפשוט ככל האפשר, ומנהלת את **כל** העדכונים שאחריו. ראו [docs/architecture/limitations.md](docs/architecture/limitations.md).

---

## מה יש כאן

| רכיב | תיקייה | טכנולוגיה | תפקיד |
|------|--------|-----------|-------|
| אתר | `apps/web` | Next.js + TS | אתר ציבורי, לוח בקרה למפתח, דף התקנה, Admin |
| API | `apps/api` | FastAPI + SQLAlchemy | מקור האמת: משתמשים, פרויקטים, גרסאות, חתימות |
| Worker | `apps/worker` | Python | ניתוח ZIP מבודד, ולידציה, אריזת Artifact |
| Signing | `apps/api` (`extsync_signing`) | Python | שירות חתימה Ed25519 מבודד רשתית |
| Agent | `apps/agent-windows` | C# / WPF | תוכנת Windows שמתקינה ומעדכנת תוספים |
| Native Host | `apps/native-host` | C# | גשר Native Messaging בין Chrome ל-Agent |
| Bridge | `packages/extension-bridge` | TS | חבילה שמשולבת בתוסף לטעינה-מחדש מאומתת |
| CLI | `apps/cli` | Node/TS | `extsync` — init/validate/pack/upload/publish |
| Schema | `packages/release-schema` | JSON Schema + TS/Py | פורמט Metadata + חתימה, מקור אמת חוצה-שפות |

מבנה מלא: ראו [docs/architecture/overview.md](docs/architecture/overview.md) ואת ה-ADRs תחת [docs/architecture/](docs/architecture).

---

## דרישות מוקדמות

- **Docker + Docker Compose** — להרצת ה-Backend, Worker, DB, Redis, MinIO, Mailpit.
- **Node.js 20+** ו-**npm 10+** — ל-`apps/web`, `apps/cli`, חבילות TS.
- **Python 3.12+** — אם מריצים את ה-API/Worker מחוץ ל-Docker.
- **.NET 8 SDK** — לבניית ה-Agent וה-Native Host (Windows בלבד).
- **Inno Setup 6** — לבניית מתקין ה-Windows (Windows בלבד).

> במכונת פיתוח ללא Docker/dotnet אפשר עדיין לעבוד על הקוד; פשוט לא ניתן להריץ את השירותים/ה-Agent. סעיף "ללא Docker" למטה מתאר הרצת API מקומית.

---

## הפעלה מאפס (Quick start)

```bash
# 1. שכפול והגדרת סביבה
cp .env.example .env
# ערכו את .env והחליפו את כל ה-change_me_* בסודות אמיתיים:
#   JWT_SECRET / CSRF_SECRET / SIGNING_INTERNAL_TOKEN  ->  openssl rand -hex 32

# 2. יצירת מפתח חתימה לפיתוח (Ed25519) — לא לפרודקשן!
make gen-dev-signing-key
#   זה כותב infrastructure/docker/dev-signing-key.pem (ב-.gitignore)
#   ומדפיס את SIGNING_PUBLIC_KEYS שצריך להעתיק ל-.env

# 3. הרמת התשתית והשירותים
docker compose up -d --build

# 4. הרצת מיגרציות
make migrate

# 5. יצירת משתמש Admin + Seed data
make seed

# 6. בדיקת בריאות
curl http://localhost:8000/health/ready
```

כתובות מקומיות:

| שירות | כתובת |
|-------|-------|
| אתר | http://localhost:3000 |
| API + OpenAPI docs | http://localhost:8000/docs |
| Mailpit (אימיילים) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

פרטי משתמש ה-Admin שנוצר ב-seed מודפסים בסוף `make seed` (ברירת מחדל: `admin@extsync.local`).

---

## בניית ה-Agent וה-Installer (Windows)

```powershell
# Agent + Native Host
make agent-build           # dotnet build apps/agent-windows ו-apps/native-host

# מתקין (Inno Setup חייב להיות מותקן ב-PATH)
make installer
#   הפלט: installers/windows/Output/ExtSyncAgentSetup.exe
```

---

## תהליך מקצה לקצה (קריטריון הקבלה)

1. מפתח נרשם ומאמת אימייל (Mailpit) → 2. יוצר פרויקט → 3. מעלה ZIP →
4. Worker מנתח ומדווח → 5. מפרסם Stable → 6. יוצר קישור התקנה →
7. משתמש מתקין את ה-Agent → 8. פותח את הקישור → 9. ה-Agent מוריד+מאמת+מחלץ →
10. מציג הוראות טעינה → 11. המשתמש טוען ב-Chrome → 12. ה-Bridge נרשם →
13. מפתח מעלה גרסה חדשה → 14. השרת דוחף ל-Agent → 15. עדכון בטוח + Reload →
16. דיווח הצלחה → 17. כשל ⇒ Rollback אוטומטי, הגרסה הישנה נשמרת.

המדריך המלא: [docs/developer-guide/end-to-end.md](docs/developer-guide/end-to-end.md).
בדיקות ידניות חובה ב-Chrome: [docs/security/manual-chrome-tests.md](docs/security/manual-chrome-tests.md).

---

## פקודות עיקריות (`make help`)

| פקודה | פעולה |
|-------|-------|
| `make up` / `make down` | הרמה/הורדה של docker compose |
| `make migrate` | הרצת מיגרציות Alembic |
| `make revision m="..."` | יצירת מיגרציה אוטומטית |
| `make seed` | Seed data + Admin |
| `make test` | כל הבדיקות (backend + cli + bridge) |
| `make test-api` | בדיקות Backend בלבד |
| `make lint` / `make typecheck` | בדיקות איכות |
| `make gen-dev-signing-key` | יצירת מפתח Ed25519 לפיתוח |
| `make agent-build` | בניית Agent + Native Host |
| `make installer` | בניית מתקין Windows |

---

## הרצת API ללא Docker (פיתוח backend)

צריך Postgres + Redis + MinIO זמינים (אפשר רק אותם דרך `docker compose up -d postgres redis minio minio-init mailpit`):

```bash
cd apps/api
python -m venv .venv && . .venv/Scripts/activate   # PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
uvicorn extsync_api.main:app --reload
```

---

## אבטחה ומגבלות

- כל Artifact חתום ב-Ed25519 ומאומת SHA-256; ה-Agent מסרב להתקין ללא חתימה תקינה. ראו [docs/security/signing.md](docs/security/signing.md).
- אין הורדה/הרצה של JavaScript מרוחק בתוך תוסף — כל קוד חייב להיכלל בחבילת הגרסה החתומה.
- מגבלות Chrome/Windows ידועות מתועדות במפורש: [docs/architecture/limitations.md](docs/architecture/limitations.md).

רישיון: ראו [LICENSE](LICENSE).
