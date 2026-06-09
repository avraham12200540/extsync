# ADR-0006: Native Messaging דרך HKCU עם allowed_origins דינמי

- סטטוס: Accepted
- תאריך: 2026-06-08

## הקשר
ה-Bridge (בתוך התוסף) צריך לדבר עם ExtSync Agent כדי לקבל `reload_required` ולדווח סטטוס. המנגנון הנתמך הוא **Chrome Native Messaging** (stdio). זה דורש Native Messaging Host מותקן ורשום, וקובץ host-manifest שמכריז על אילו תוספים (origins) מורשים להתחבר.

## החלטה
- ה-Native Host נרשם תחת **`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.extsync.agent`** (per-user, ללא הרשאות מנהל). תמיכה גם ב-Edge תחת `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\...`.
- שם ה-host קבוע: `com.extsync.agent`. `type: stdio`.
- **`allowed_origins` דינמי**: הוא חייב להכיל את ה-`chrome-extension://<id>/` המדויק של כל תוסף מנוהל. מאחר וה-ID ידוע רק אחרי רישום, **ה-Agent מעדכן את ה-host manifest** (מוסיף/מסיר origin) בעת `register-extension`/`unregister-extension`.
- ה-Native Host הוא תהליך דק (stdio bridge) שמעביר הודעות בין Chrome ל-Agent דרך IPC מקומי (named pipe `\\.\pipe\extsync-agent`). הוא **לא** מבצע פעולות קבצים בעצמו.

## אבטחה
- כל הודעה מאומתת: `protocolVersion`, `requestId`, `timestamp`, `projectId`, `extensionId`, `payload`, ו-validation מלא של ה-schema.
- ה-Bridge מריץ `chrome.runtime.reload()` רק אחרי הודעת `update.reload_ready` **חתומה/מאומתת** מה-Agent המקומי (nonce חד-פעמי לכל עדכון), לא על כל הודעה.
- מאחר ש-`allowed_origins` מוגבל ל-IDs מנוהלים, אתר רגיל או תוסף לא-מורשה לא יכול לפתוח את ה-host. בנוסף, ה-Agent מאמת שה-`projectId`/`extensionId` בהודעה תואמים לתוסף רשום.

## חלופות
- **WebSocket מקומי מ-content script**: חושף את ה-Agent לכל דף; נדחה לטובת Native Messaging המוגבל ל-origins.
- **רישום per-machine (HKLM)**: דורש מנהל; נדחה לטובת התקנה ברמת המשתמש.

## בדיקות
ידני ב-Chrome (חובה): Native Messaging עובד דרך HKCU; ה-Agent מזהה את ה-Bridge. ראו manual-chrome-tests פריטים 5–6.
