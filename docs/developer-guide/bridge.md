# ExtSync Bridge (§10)

חבילה קטנה שמשולבת בתוסף Manifest V3 ומאפשרת **reload אוטומטי מאומת** לאחר עדכון.
קוד: `packages/extension-bridge` (גרסת ESM וגרסת classic SW). וריאנט standalone מוזרק
ע"י `extsync init`.

## מה ה-Bridge עושה
- מתחבר ל-Native Messaging Host בשם הקבוע `com.extsync.agent`.
- שולח `extension.register` עם `projectId`, `extensionId`, `currentVersion`, `channel`.
- מקבל `update.reload_ready` עם **nonce**, משיב `update.reload_ack`, ואז מריץ `chrome.runtime.reload()`.
- אירועים: `onAgentConnected/Disconnected/UpdatePrepared/ReloadRequested/UpdateCompleted/UpdateFailed`.

## מה ה-Bridge לא עושה
- לא מוריד קוד, לא מריץ קוד מהשרת, לא אוסף מידע מדפי המשתמש.
- לא קורס כשה-Agent לא מותקן או כשהחיבור נופל (מטופל בחן).
- מריץ reload **רק** לאחר הודעה מאומתת (nonce) מה-Agent המקומי דרך הערוץ המהימן.

## שימוש (ES Module SW)
```js
import { initializeExtSync } from "extsync-bridge";
const bridge = initializeExtSync({ projectId: "ext_123", channel: "stable" });
bridge.onUpdateCompleted(() => console.log("updated"));
```

## שימוש (classic SW)
```js
importScripts("extsync-bridge.sw.js");
const bridge = self.initializeExtSync({ projectId: "ext_123", channel: "stable" });
```

## הרשאות נדרשות
התוסף צריך `"nativeMessaging"` ב-`permissions` (ה-Bridge פותח native port). `extsync init`
מוסיף זאת אוטומטית.

## ללא Bridge
אם התוסף אינו כולל Bridge, עדכונים עדיין מותקנים בקבצים, אך נכנסים לתוקף רק לאחר
טעינה-מחדש ידנית או הפעלה מחדש של Chrome — ה-Agent מסמן מצב `reload_required` (Pending Restart).
