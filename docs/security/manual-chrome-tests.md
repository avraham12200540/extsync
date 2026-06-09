# בדיקות ידניות חובה ב-Chrome (POC) — §45

חלק מהדרישות אי אפשר לאמת אוטומטית בלי Chrome אמיתי ו-Windows אמיתי. המסמך הזה
מפרט בדיוק מה נבדק אוטומטית (קוד + בדיקות שעוברות) ומה **חייב** להיבדק ידנית, עם
צעדים מדויקים. סמנו ✅/❌ ותעדו תוצאות לפני הכרזה על מוכנות.

## מקרא
- **AUTO** — מכוסה בבדיקות אוטומטיות שכבר עוברות (ראו עמודת "איפה").
- **MANUAL** — דורש הרצה ידנית ב-Chrome/Windows.

| # | דרישה (§45) | סוג | איפה / איך |
|---|-------------|-----|------------|
| 1 | Extension ID זהה בין שתי גרסאות | AUTO + MANUAL | AUTO: `apps/api/tests/test_extension_key.py` (אותו `key` ⇒ אותו id). MANUAL: ראו §1 למטה |
| 2 | Extension ID זהה בשני מחשבים | AUTO + MANUAL | AUTO: דטרמיניזם מוכח. MANUAL: ראו §2 |
| 3 | החלפת `active` בזמן ש-Chrome פתוח | MANUAL | ראו §3 (ADR-0004) |
| 4 | `chrome.runtime.reload()` טוען את החדש | MANUAL | ראו §4 |
| 5 | Native Messaging עובד דרך HKCU | MANUAL | ראו §5 (ADR-0006) |
| 6 | Agent מזהה Bridge | MANUAL | ראו §6 |
| 7 | שינוי הרשאות מזוהה | AUTO | `apps/worker` permission diff + `tests/integration` (permissionsChanged) |
| 8 | עדכון כושל אינו מוחק את הגרסה הישנה | AUTO + MANUAL | AUTO: `UpdateService`/`FolderSwap` שומרים rollback; MANUAL: §8 |
| 9 | Rollback עובד | AUTO + MANUAL | AUTO: `tests/integration/test_release_pipeline.py::test_rollback_keeps_old_release`; MANUAL: §9 |
| 10 | Custom URI עובד אחרי התקנת Agent | MANUAL | ראו §10 |
| 11 | Scheduled Task עובד אחרי Restart | MANUAL | ראו §11 |
| 12 | WebSocket reconnect עובד | AUTO(חלקי) + MANUAL | קוד: `AgentWebSocket` backoff; MANUAL: §12 |
| 13 | Polling fallback עובד | MANUAL | ראו §13 |
| 14 | קישור שפג תוקף נחסם | AUTO | `install_link.is_usable` + resolve/consume; ניתן לבדוק ב-API |
| 15 | Artifact עם Hash שגוי נחסם | AUTO | `ReleaseVerifier.VerifySha256` + `UpdateService` (.NET test) |
| 16 | Artifact עם חתימה שגויה נחסם | AUTO | `tests/integration` (tamper), `release-schema` tests, .NET `CryptoTests` |
| 17 | משתמש מצוות אחד לא ניגש לפרויקט אחר | AUTO | `services/authz` NOT_FOUND; מומלץ test ייעודי (ראו §17 למטה) |
| 18 | Agent ישן מקבל דרישת עדכון | AUTO | `agent_service.check_updates` reason `AGENT_UPDATE_REQUIRED` + `/agent/self-update` |
| 19 | תוסף ללא Bridge מקבל Pending Restart | AUTO | `UpdateService` ⇒ `ReloadRequired` כשאין bridge |
| 20 | הסרת Agent לא מוחקת קבצים בלי אישור | AUTO + MANUAL | קוד: `RemoveAsync(deleteFiles)` + Inno `[UninstallDelete]`; MANUAL: §20 |

---

## נהלים ידניים מפורטים

### §1 — Extension ID זהה בין גרסאות
1. צרו פרויקט, העלו v1.0.0, פרסמו. התקינו דרך ה-Agent וטענו ב-Chrome.
2. רשמו את ה-ID המוצג ב-`chrome://extensions`.
3. העלו v1.1.0 (אותו פרויקט), תנו ל-Agent לעדכן.
4. ודאו שה-ID **לא השתנה**. (נובע מכך ש-`manifest.key` זהה — מוזרק מאותו `project_keys`.)

### §2 — Extension ID זהה בשני מחשבים
1. במחשב A התקינו את התוסף; רשמו ID.
2. במחשב B (Device ID אחר) התקינו את אותו פרויקט מאותו קישור.
3. ודאו שה-ID זהה בשני המחשבים.

### §3 — החלפת `active` ו-Chrome פתוח
1. כש-Chrome פתוח והתוסף טעון, גרמו לעדכון (פרסמו גרסה).
2. ודאו שה-Agent מצליח להחליף את `active` (אסטרטגיית rename; אם נכשל בגלל נעילה — fallback ל-journaled copy ומצב `reload_required`).
3. ודאו שלא נשארה תיקייה חלקית ושהגרסה הישנה נשמרה תחת `rollback`.

### §4 — reload טוען את החדש
1. עם תוסף שכולל Bridge, אחרי עדכון ודאו שה-Bridge קיבל `reload_ready`, השיב `reload_ack`, וה-Agent דיווח הצלחה.
2. ודאו שב-`chrome://extensions` הגרסה התעדכנה בלי טעינה ידנית.

### §5 — Native Messaging דרך HKCU
1. ודאו קיום מפתח: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.extsync.agent` ⇒ נתיב ל-`com.extsync.agent.json`.
2. ודאו שב-manifest יש `allowed_origins` עם `chrome-extension://<id>/` של התוסף.
3. פתחו את התוסף; ודאו שה-Native Host מתחבר ל-named pipe וה-Bridge מדווח חיבור.

### §6 — Agent מזהה Bridge
1. אחרי טעינת התוסף ידנית, ודאו שכרטיס התוסף ב-Agent עובר ל"מעודכן"/"Bridge מחובר".

### §8 — עדכון כושל לא מוחק ישן
1. הזריקו כשל (למשל artifact עם hash שגוי — נחסם; או נתקו רשת באמצע הורדה).
2. ודאו שהגרסה הפעילה נשארה והמצב חזר לתקין (rollback אם צריך), ושלוגים נשמרו.

### §9 — Rollback
1. בצעו Rollback מה-UI של ה-Agent (או מהמפתח בלוח הבקרה).
2. ודאו שהגרסה הקודמת שוחזרה, התוסף נטען מחדש, והגרסה ה"בעייתית" עברה לתיקיית `failed` (לא נמחקה).

### §10 — Custom URI
1. אחרי התקנת ה-Agent, פתחו בדפדפן `extsync://install?token=...`.
2. ודאו שה-Agent עולה (או מקבל את ה-URL אם כבר פתוח — single instance) ופותח את אשף ההתקנה.

### §11 — Scheduled Task אחרי Restart
1. הפעילו מחדש את Windows.
2. ודאו שה-Task "ExtSync Agent Logon" הריץ את ה-Agent, ושבדיקת עדכונים מתבצעת.

### §12 — WebSocket reconnect
1. נתקו את השרת/רשת; ודאו שה-Agent מזהה ניתוק ומנסה להתחבר מחדש עם backoff.
2. החזירו את השרת; ודאו חיבור מחדש ושפרסום גרסה דוחף בדיקה.

### §13 — Polling fallback
1. חסמו WebSocket בלבד (השאירו HTTP); ודאו שהבדיקה המחזורית עדיין מאתרת עדכון.

### §17 — בידוד בין צוותים (מומלץ גם test אוטומטי)
1. עם משתמש מצוות B, נסו `GET /projects/{id}` של פרויקט מצוות A ⇒ ציפייה: `404` (לא נחשף קיום).

### §20 — הסרה לא מוחקת קבצים בלי אישור
1. הסירו תוסף מ-ExtSync בלי לבחור "מחק קבצים" ⇒ הקבצים נשארים.
2. הריצו Uninstaller ⇒ ה-Data והתוספים נשארים (הודעה למשתמש); רק manifest/Temp של ה-host נמחקים.
