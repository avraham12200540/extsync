# ExtSync CLI (§9)

התקנה: `npx extsync-cli <command>` (או `npm i -g extsync-cli`). הקוד: `apps/cli`.

## הגדרה
- `EXTSYNC_API_URL` — כתובת ה-API (ברירת מחדל http://localhost:8000).
- `EXTSYNC_TOKEN` — API token (חלופה ל-`extsync login`).
- קונפיג נשמר ב-`~/.extsync/config.json` (הרשאות 600; מכיל token).

## פקודות
| פקודה | תיאור |
|-------|-------|
| `extsync login --token <t>` | שמירת token + אימות מול `/auth/me` |
| `extsync logout` | מחיקת ה-token המקומי |
| `extsync whoami` | מי מחובר |
| `extsync init [dir]` | שילוב ה-Bridge: מזהה SW (classic/module), מוסיף קובץ bridge + nativeMessaging + config, מגבה, מציג diff, ומבקש `--yes` לכתיבה |
| `extsync validate [dir]` | בדיקות manifest/אבטחה על תיקייה לא-ארוזה; Exit code 1 בשגיאות (ל-CI) |
| `extsync pack [dir] [--out f]` | ZIP נקי (ללא node_modules/.git/סודות) + SHA-256 + `extsync-report.json` |
| `extsync upload [dir] --project <id>` | אריזה + העלאה כ-Draft (multipart) |
| `extsync publish --project <id> --release <id> [--rollout N]` | פרסום גרסה |
| `extsync status --project <id>` | רשימת גרסאות וסטטוס |
| `extsync link --project <id> [--channel] [--type]` | יצירת קישור התקנה |
| `extsync doctor` | אבחון: Node, חיבור לשרת, תוקף token |

## בטיחות
- `init` **לא מוחק** קוד קיים; מגבה ל-`*.bak` ומבקש אישור (`--yes`). מבנה לא נתמך ⇒ הוראות ידניות.
- `validate` מחזיר Exit code מתאים ל-CI.
- `upload` מעלה **Draft** בלבד. פרסום Stable דורש פעולה מפורשת (`publish`).

## CI
דוגמת GitHub Actions: [apps/cli/examples/github-actions-publish.yml](../../apps/cli/examples/github-actions-publish.yml) —
מאמתת ומעלה Draft בכל push; פרסום ל-Stable הוא job ידני נפרד (לעולם לא אוטומטי).
