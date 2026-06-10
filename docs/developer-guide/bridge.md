# ExtSync Bridge (§10)

חבילה קטנה שמשולבת בתוסף Manifest V3 ומאפשרת **reload אוטומטי מאומת** לאחר עדכון.
קוד: `packages/extension-bridge` (גרסת ESM וגרסת classic SW). וריאנט standalone מוזרק
ע"י `extsync init`.

## הזרקה אוטומטית (ברירת מחדל — אין צורך לעשות כלום)
בעת בניית ה-artifact המאומת, הפלטפורמה **מזריקה את ה-Bridge אוטומטית** לכל תוסף MV3
(`apps/worker/src/extsync_worker/bridge.py`): מוסיפה את `extsync-bridge.js`, מחווטת אותו
ל-service worker (יוצרת אחד אם אין, או טוענת אותו ראשון מתוך הקיים), ומוסיפה את הרשאת
`nativeMessaging`. ה-`projectId` וה-`channel` נצרבים בקובץ. כך **מפתחים מעלים תוסף רגיל
ומקבלים עדכון-בְּמָקוֹם אוטומטי בלי לכתוב שום קוד**. אם התוסף כבר כולל bridge משלו —
ההזרקה מדולגת ומכבדים את האינטגרציה הקיימת.

> הרענון האוטומטי המלא מתרחש מהעדכון **השני** ואילך: כדי לקבל פקודת reload, הגרסה המותקנת
> כרגע חייבת לכלול את ה-Bridge. העדכון הראשון שמכניס את ה-Bridge עדיין דורש רענון ידני אחד.

**תוספי content-script:** קוד חדש חל על לשונית רק אחרי שהיא נטענת מחדש (Chrome לא מחליף סקריפט
שכבר רץ בדף חי). לכן רגע לפני ה-reload ה-Bridge מזריק **טוסט אלגנטי** ללשוניות התואמות
("גרסה X הותקנה — רענן עכשיו"); לחיצה מרעננת את הדף בלבד, בלי איבוד מידע. לשם כך מתווספת
הרשאת `scripting` (רק אם יש content scripts), ודפוסי ה-`matches` נצרבים ב-Bridge.

האינטגרציה הידנית שלהלן רלוונטית רק אם רוצים שליטה מלאה (אירועים, reload מותנה וכו').

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
