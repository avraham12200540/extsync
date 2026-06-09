# מגבלות ידועות (§43 תוצר 21)

## מגבלות פלטפורמה אמיתיות (Chrome / Windows)
ראו המסמך המפורט: [architecture/limitations.md](architecture/limitations.md). בתמצית:
- **אין התקנה שקטה** של תוסף לא-ארוז ב-Chrome רגיל — ההתקנה הראשונה ידנית (מצב מפתח + "טען פריט לא ארוז").
- **reload אוטומטי** אפשרי רק לתוסף שכולל את ה-Bridge; אחרת מצב Pending Restart.
- **`allowed_origins`** של Native Messaging חייב להכיל את ה-Extension ID המדויק — ה-Agent מעדכן זאת.
- **אובדן מפתח פרויקט** ללא גיבוי פוגע ביציבות ה-Extension ID — גבו את `project_keys`.
- ההתקנה היא **per-user** (HKCU, LocalAppData) — לא per-machine.

## מצב המימוש בסביבה הזו
המערכת נכתבה ואומתה בסביבה ללא Docker/.NET. השלכות:
- **Backend / Worker / release-schema / CLI / Bridge / Web** — נבדקו ועוברים בפועל
  (Python pytest, Node test, `next build` + `tsc`). ראו [TESTING.md](../TESTING.md).
- **Windows Agent / Native Host / Installer** — קוד מלא ובדיקות xUnit כתובות, אך
  **לא הודרו כאן** (דורש .NET 8 SDK + Windows). יש להריץ `dotnet build`/`dotnet test`
  ו-`iscc` במכונת Windows.
- **בדיקות שדורשות Chrome אמיתי** (טעינת unpacked, reload, Native Messaging, יציבות ID)
  מתועדות כבדיקות ידניות חובה ב-[security/manual-chrome-tests.md](security/manual-chrome-tests.md).

## פערים ידועים / עבודה עתידית
- **Google OAuth**: שדות הקונפיג קיימים; זרימת ה-OAuth עצמה לא מומשה (אימייל+סיסמה + 2FA כן).
- **Playwright e2e**: סקריפט דוגמה קיים ב-`tests/end-to-end`; הרצה דורשת סטאק חי + דפדפן.
- **Webhook delivery worker**: לוגיקת המשלוח (HMAC/retry) מומשה; תזמון ה-retry המושהה
  נעשה דרך re-enqueue פשוט — בפרודקשן עדיף delayed-set/sorted-set ב-Redis.
- **התראות Push למשתמש קצה**: WebSocket "check now" קיים; התראות Windows מקומיות דרך ה-tray.
- **אנליטיקה מתקדמת** (גרפים): ה-API מספק אגרגציות; ה-UI מציג מספרים, ללא ספריית גרפים.
