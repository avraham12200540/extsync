# ADR-0004: אסטרטגיית החלפת קבצים מקומית — Directory rename עם fallback ל-Journaled copy

- סטטוס: Accepted
- תאריך: 2026-06-08

## הקשר
ה-Agent מחליף את תוכן תיקיית התוסף בזמן ש-Chrome עשוי להחזיק handles לקבצים. נדרש שהחלפה תהיה אטומית ככל האפשר, ושכשל לא ישאיר תיקייה חלקית או ימחק את הגרסה הפעילה. סעיף 13 באפיון דורש לבחון שתי אסטרטגיות ולתעד החלטה.

## אופציות
**A. החלפת תיקיות ב-rename (swap):**
מבנה: `Extensions/{projectId}/{active|staging|rollback}`. מורידים ל-`staging`, ואז:
`active → rollback_tmp`, `staging → active`. `MoveFileEx` ב-Windows על תיקיות באותו volume הוא כמעט-אטומי ומהיר.
- יתרון: כמעט אטומי, מהיר, rollback פשוט (rename בחזרה).
- חיסרון: **Chrome טוען unpacked מנתיב מוחלט קבוע.** rename של `active` משנה inode אך הנתיב נשאר — אבל אם Chrome מחזיק handle פתוח לקובץ בתוך `active`, `MoveFileEx` על התיקייה ההורה עלול להיכשל ב-`ERROR_SHARING_VIOLATION`.

**B. העתקת קבצים לתיקייה קבועה עם Journal:**
מעדכנים קובץ-קובץ *בתוך* `active` הקבוע, עם journal מקומי (`update.log` + `state.json`) המתעד כל צעד כדי לאפשר replay/recovery.
- יתרון: הנתיב לעולם לא משתנה (יציב ל-Chrome), עוקף נעילת התיקייה ההורה.
- חיסרון: לא אטומי; קובץ נעול בודד חוסם; דורש journal+recovery קפדני.

## החלטה
**Primary: אסטרטגיה A (rename swap), עם נתיב active קבוע שמורכב נכון, ו-fallback אוטומטי ל-B עם journal כשה-rename נכשל בגלל נעילה.**

מימוש:
1. הנתיב ש-Chrome טוען הוא `Extensions/{projectId}/active` — קבוע.
2. מורידים ומחלצים ל-`staging`, מאמתים (hash, חתימה, manifest, projectId, בדיקת אבטחה מקומית).
3. מנסים swap ע"י rename: `active → rollback`, `staging → active` (`MoveFileEx` עם `MOVEFILE_REPLACE_EXISTING` לפי הצורך).
4. אם ה-rename של `active` נכשל ב-sharing violation:
   - לא מוחקים כלום.
   - עוברים ל-Journaled in-place copy: כותבים journal, מעתיקים קבצים חדשים, מסמנים קבצים שלא ניתן להחליף עכשיו, ומסמנים **Pending Restart** עבורם.
5. כל צעד נרשם ב-`update.log`; `state.json` מחזיק את ה-state machine.
6. אחרי swap מוצלח — מבקשים מה-Bridge `chrome.runtime.reload()`; ממתינים ל-ack; כשל ⇒ Rollback (rename `rollback → active`).

**אין מחיקה של גרסה פעילה לפני שהחדשה חולצה ואומתה בהצלחה.** Recovery בהפעלה: ה-Agent בודק `state.json` ומשלים/מגלגל לאחור פעולה שנקטעה.

## בדיקות שחובה לאמת ידנית ב-Chrome
ראו [docs/security/manual-chrome-tests.md] פריטים 3 ו-4: החלפת `active` בזמן ש-Chrome פתוח, ו-`chrome.runtime.reload()` טוען את החדש.

## תוצאה
מהירות ואטומיות כברירת מחדל, עם נתיב נסיגה עמיד לנעילות. אף תרחיש לא מוחק את הגרסה הפעילה לפני הצלחה מאומתת.
