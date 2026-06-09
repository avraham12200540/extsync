# מדריך למפתח — התחלה

## דרישות
Docker + Docker Compose, Node 20+, (אופציונלי) Python 3.12+, .NET 8 SDK, Inno Setup 6.

## הרמת הסביבה
```bash
cp .env.example .env
make gen-dev-signing-key      # יוצר מפתח חתימה לפיתוח + מדפיס SIGNING_PUBLIC_KEYS ל-.env
docker compose up -d --build
make migrate
make seed                     # יוצר admin + dev@extsync.local + פרויקט דוגמה
```
- אתר: http://localhost:3000 · API+docs: http://localhost:8000/docs · Mailpit: http://localhost:8025

## זרימת עבודה אופיינית
1. הרשמה ואימות אימייל (Mailpit בפיתוח).
2. יצירת פרויקט (מתקבל Extension ID יציב מיד).
3. העלאת ZIP (אשף או CLI). ה-Worker מנתח ומפיק דוח.
4. פרסום לערוץ (Stable/Beta/Nightly) עם אחוז Rollout.
5. יצירת קישור התקנה ושליחתו למשתמשים.
6. מעקב בלשונית Analytics: התקנות, הצלחות/כשלים, גרסאות.

## עבודה עם ה-CLI
ראו [cli.md](cli.md). בקצרה:
```bash
npx extsync-cli login --token <API_TOKEN>     # צרו טוקן ב-לוח הבקרה > API
npx extsync-cli validate ./dist
npx extsync-cli upload ./dist --project ext_xxx --channel beta
npx extsync-cli publish --project ext_xxx --release rel_xxx --rollout 10
```

## שילוב ה-Bridge (לעדכון אוטומטי)
ראו [bridge.md](bridge.md). מצב "בסיסי" (ללא Bridge) דורש טעינה-מחדש ידנית בעדכון;
מצב "משולב" (עם Bridge) מבצע `chrome.runtime.reload()` אוטומטי לאחר עדכון מאומת.

## מקור אמת ל-API
ה-OpenAPI החי ב-`/docs`. כל endpoint דורש הרשאות מתאימות (RBAC, §3).
