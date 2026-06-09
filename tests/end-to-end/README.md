# בדיקות End-to-End (Playwright)

בדיקות דפדפן שרצות מול הסטאק החי. דורשות:
1. `docker compose up -d` + `make migrate` + `make seed`
2. האתר ב-http://localhost:3000 וה-API ב-http://localhost:8000

```bash
cd tests/end-to-end
npm install
npx playwright install chromium
npm test
```

> הערה: זרימת ה-Agent המלאה (טעינת תוסף ב-Chrome, Native Messaging, reload) אינה ניתנת
> לאוטומציה מלאה ב-Playwright כי היא דורשת אינטראקציה עם `chrome://extensions` ומערכת
> ההפעלה. ראו [docs/security/manual-chrome-tests.md](../../docs/security/manual-chrome-tests.md).
> הבדיקות כאן מכסות את זרימת האתר (הרשמה, התחברות, יצירת פרויקט, דף התקנה).
