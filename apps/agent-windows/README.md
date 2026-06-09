# ExtSync Agent (Windows)

תוכנת Windows שמתקינה, מנהלת ומעדכנת תוספי Chrome מנוהלים. C# / .NET 8 / WPF (MVVM), SQLite מקומי, Serilog, Native Messaging, Custom URI, Scheduled Task — הכול ברמת המשתמש (ללא הרשאות מנהל).

> דורש **.NET 8 SDK** לבנייה. הסביבה שבה נוצר הקוד לא כללה `dotnet`, ולכן הקוד נכתב מלא ונכון אך לא הודר כאן. הריצו `dotnet build`/`dotnet test` במכונת Windows עם .NET 8.

## מבנה
| תיקייה | תיאור |
|--------|-------|
| `Crypto/` | קנוניזציה + אימות חתימת Ed25519 (תואם בייט-בייט ל-`packages/release-schema`) |
| `Models/` | מטא-דאטה, מצבי התקנה מקומיים, קודי שגיאה |
| `Services/` | ApiClient, LocalStore (SQLite), UpdateService (מכונת מצבים), FolderSwap (ADR-0004), RollbackService, PipeServer (IPC), NativeMessagingRegistrar, AgentWebSocket, AgentController |
| `ViewModels/`, `Views/` | ממשק WPF ב-RTL עברית, tray, אשף התקנה |
| `../native-host/` | Native Messaging Host (גשר stdio↔named-pipe) |
| `ExtSync.Agent.Tests/` | בדיקות xUnit (קנוניזציה מול הווקטורים, אימות חתימה, גרסאות, URI) |

## בנייה והרצה
```powershell
# מהשורש של ה-repo
dotnet build apps/agent-windows/ExtSync.Agent.sln -c Release
dotnet test  apps/agent-windows/ExtSync.Agent.sln           # מריץ את CryptoTests

# הרצה (פיתוח) — צריך backend פעיל ב-http://localhost:8000
dotnet run --project apps/agent-windows/ExtSync.Agent
```

הגדרת המפתח הציבורי של הפלטפורמה (לאימות חתימות) באחת משתי דרכים:
- משתנה סביבה `EXTSYNC_PUBLIC_KEYS=key-2026-01:<base64>` (כפי ש-`make gen-dev-signing-key` מדפיס), **או**
- קובץ `keys.json` ליד ה-exe: `{ "key-2026-01": "<base64>" }`.

כתובת ה-API/WS נקבעת ב-`%LOCALAPPDATA%\ExtSync\Data\settings.json` (ברירת מחדל localhost).

## בנייה למתקין
ראו [installers/windows/extsync-agent.iss](../../installers/windows/extsync-agent.iss) לפקודות ה-`dotnet publish` ו-`iscc`.

## מגבלות אמת
ה-Agent **אינו** מתקין תוסף בשקט — ההתקנה הראשונה דורשת טעינה ידנית של התיקייה ב-`chrome://extensions` עם מצב מפתח. ראו [docs/architecture/limitations.md](../../docs/architecture/limitations.md). העדכונים שלאחר מכן אוטומטיים (החלפת קבצים בטוחה + reload דרך ה-Bridge).
