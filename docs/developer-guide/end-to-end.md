# מדריך מקצה-לקצה (תרחיש הקבלה, §40)

המדריך עובר על כל 25 הצעדים שמגדירים MVP עובד. מניח שהרמת את הסטאק
(`docker compose up -d`, `make migrate`, `make seed`) וש-Chrome + ExtSync Agent מותקנים
ב-Windows.

## חלק א' — מפתח (אתר)
1. **הרשמה**: גשו ל-http://localhost:3000/register, מלאו פרטים, אשרו תנאים.
2. **אימות אימייל**: פתחו את Mailpit ב-http://localhost:8025, לחצו על קישור האימות
   (או השתמשו במשתמש ה-seed `dev@extsync.local`).
3. **יצירת פרויקט**: לוח הבקרה → תוספים → "תוסף חדש".
4. **העלאת ZIP**: בנו את תוסף הדוגמה — `python tests/fixtures/build_fixtures.py` →
   `tests/fixtures/dist/hello-extsync.zip`. בלשונית "גרסאות" העלו אותו עם version `1.0.0`.
   (לפני כן ערכו ב-`sw.js` את `PROJECT_ID` ל-id הפרויקט שנוצר.)
5. **ניתוח ב-Worker**: ה-Worker מנתח אוטומטית. הסטטוס עובר `uploaded → validating → ready`.
6. **דוח**: לחצו על הגרסה לצפייה בדוח (manifest, הרשאות, אזהרות, ציון סיכון).
7. **פרסום Stable**: לחצו "פרסום" (rollout 100%). הסטטוס → `published`, נחתם Ed25519.
8. **קישור התקנה**: לשונית "קישורי התקנה" → "יצירת קישור". העתיקו את הקישור.

## חלק ב' — משתמש קצה (Windows)
9. **התקנת Agent**: הריצו את `ExtSyncAgentSetup.exe` (ראו installers/windows).
10. **פתיחת הקישור**: הדביקו את קישור ההתקנה בדפדפן ולחצו "התקנה באמצעות ExtSync"
    (או הדביקו ב-Agent → "הוספת תוסף מקישור").
11. **הורדה + אימות**: ה-Agent מוריד את ה-artifact, מאמת SHA-256 + חתימה, מחלץ ל-`active`.
12. **הוראות טעינה**: ה-Agent פותח את `chrome://extensions`, מעתיק את הנתיב, פותח את התיקייה.
13. **טעינה ידנית**: הפעילו "מצב מפתח", "טען פריט לא ארוז", בחרו את התיקייה שנפתחה.
14. **רישום Bridge**: ה-Bridge מתחבר ל-Native Host; ה-Agent מסמן "מעודכן".

## חלק ג' — עדכון אוטומטי
15. **גרסה חדשה**: כמפתח, העלו `2.0.0`, נתחו, פרסמו.
16. **Push לשרת→Agent**: השרת דוחף ל-WebSocket; ה-Agent מריץ check-updates (או polling).
17. **הורדה+אימות**: ה-Agent מוריד ומאמת את `2.0.0`.
18. **גיבוי**: `active` הנוכחי מועתק ל-`rollback`.
19. **החלפה**: ה-Agent מחליף את `active` בבטחה (rename / journaled).
20. **Reload**: ה-Bridge מקבל `reload_ready` מאומת ומריץ `chrome.runtime.reload()`.
21. **אישור**: ה-Bridge שולח `reload_ack`; ה-Agent רושם הצלחה.
22. **דיווח לשרת**: ה-Agent מדווח success; השרת מעדכן את ההתקנה.
23. **תצוגה למפתח**: בלוח הבקרה (Analytics) רואים שהמכשיר עבר ל-`2.0.0`.

## חלק ד' — Rollback
24. **גרסה פגומה**: אם עדכון נכשל (חתימה/hash/טעינה), ה-Agent מבצע Rollback אוטומטי;
    או שהמפתח/המשתמש יוזם Rollback ידני.
25. **שמירת הישנה**: הגרסה הקודמת משוחזרת מ-`rollback`, הגרסה הבעייתית עוברת ל-`failed`
    ו**אינה נמחקת**.

## אימות אוטומטי של אותו זרימה
`tests/integration/test_release_pipeline.py` ו-`test_agent_flow.py` מכסים את צעדים 3–23
ברמת ה-Backend (כולל אימות חתימה, rollout, idempotency, auto-stop, ו-Rollback ששומר
את הגרסה הישנה). צעדים שדורשים Chrome אמיתי (12–14, 20) מתועדים ב-
[manual-chrome-tests.md](../security/manual-chrome-tests.md).
