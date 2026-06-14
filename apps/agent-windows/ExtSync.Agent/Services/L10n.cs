using System.Windows;

namespace ExtSync.Agent.Services;

/// <summary>
/// App localization (he default / en). XAML binds strings via
/// {DynamicResource S.Key} (Apply() fills Application.Current.Resources, so a
/// language switch updates every open window live, including FlowDirection via
/// the S.Flow resource). Code uses T()/F(). ViewModels re-render via the
/// LanguageChanged event.
/// </summary>
public static class L10n
{
    public static string Lang { get; private set; } = "he";
    public static event Action? LanguageChanged;

    public static FlowDirection Flow =>
        Lang == "en" ? FlowDirection.LeftToRight : FlowDirection.RightToLeft;

    public static string T(string key)
    {
        var dict = Lang == "en" ? En : He;
        return dict.TryGetValue(key, out var v) ? v : He.TryGetValue(key, out var h) ? h : key;
    }

    public static string F(string key, params object[] args) => string.Format(T(key), args);

    /// <summary>Set the language and push every string into application
    /// resources (S.*) so DynamicResource consumers refresh immediately.</summary>
    public static void Apply(string lang)
    {
        Lang = lang == "en" ? "en" : "he";
        var app = Application.Current;
        if (app is null) return; // unit tests
        var res = app.Resources;
        // He is the complete baseline; overlay En so a missing English key can
        // never leave a DynamicResource empty.
        foreach (var kv in He)
            res["S." + kv.Key] = kv.Value;
        if (Lang == "en")
            foreach (var kv in En)
                res["S." + kv.Key] = kv.Value;
        res["S.Flow"] = Flow;
        foreach (Window w in app.Windows)
            w.FlowDirection = Flow;
        LanguageChanged?.Invoke();
    }

    private static readonly Dictionary<string, string> He = new()
    {
        // main window
        ["Main.AddByLink"] = "הוספת תוסף מקישור",
        ["Main.Check"] = "בדיקת עדכונים",
        ["Main.Settings"] = "הגדרות",
        ["Main.Empty.Title"] = "אין עדיין תוספים מנוהלים",
        ["Main.Empty.Body"] = "התקינו תוסף מגלריית התוספים באתר, או הדביקו קישור התקנה שקיבלתם ממפתח - ומכאן הוא יתעדכן אצלכם אוטומטית.",
        ["Main.Empty.Store"] = "פתיחת גלריית התוספים",
        ["Main.Empty.Add"] = "הוספה מקישור",
        ["Item.Check"] = "בדיקה",
        ["Item.Folder"] = "תיקייה",
        ["Item.ExtPage"] = "דף התוספים",
        ["Item.Rollback"] = "Rollback",
        ["Item.Remove"] = "הסרה",
        // header status (view-model)
        ["Conn.Connecting"] = "מתחבר…",
        ["Conn.Online"] = "מחובר לשרת",
        ["Conn.Offline"] = "לא מחובר (מצב לא-מקוון)",
        ["Check.Never"] = "טרם נבדק",
        ["Check.Last"] = "בדיקה אחרונה: {0}",
        ["Managed.Count"] = "{0} תוספים מנוהלים",
        ["Msg.CheckFailed"] = "לא הצלחנו לבדוק עדכונים כעת. ננסה שוב מאוחר יותר.",
        ["Msg.LinkInvalid"] = "הקישור אינו תקין או שפג תוקפו.",
        // item statuses
        ["St.UpToDate"] = "מעודכן",
        ["St.UpdateAvailable"] = "עדכון זמין",
        ["St.Updating"] = "מעדכן…",
        ["St.Downloading"] = "מוריד…",
        ["St.AwaitManual"] = "ממתין לטעינה ב-Chrome",
        ["St.ReloadRequired"] = "נדרשת טעינה מחדש",
        ["St.Paused"] = "מושהה",
        ["St.Broken"] = "תקלה",
        ["St.RollingBack"] = "מבצע Rollback…",
        ["Pause.Do"] = "השהיה",
        ["Pause.Resume"] = "חידוש עדכונים",
        ["Bridge.None"] = "ללא Bridge",
        ["Bridge.On"] = "Bridge מחובר",
        ["Bridge.Off"] = "Bridge לא מחובר",
        ["Dlg.Rollback.Body"] = "לחזור לגרסה הקודמת של {0}? הגרסה הנוכחית תישמר בתיקיית failed.",
        ["Dlg.Rollback.Title"] = "Rollback",
        ["Dlg.Rollback.Failed"] = "ה-Rollback נכשל. הגרסה הנוכחית נשארה.",
        ["Dlg.Remove.Body"] = "להסיר את {0} מהניהול?\n\nכן - הסרה ומחיקת קבצי התוסף מהמחשב\nלא - הסרה מהניהול בלבד (הקבצים יישארו)\nביטול - לא להסיר\n\nשימו לב: התוסף לא יוסר אוטומטית מ-Chrome.",
        ["Dlg.Remove.Title"] = "הסרת תוסף",
        // settings window
        ["Set.WinTitle"] = "הגדרות ExtSync",
        ["Set.Header"] = "הגדרות",
        ["Set.Language"] = "שפה / Language:",
        ["Set.Startup"] = "הפעלה עם Windows",
        ["Set.AutoCheck"] = "בדיקת עדכונים אוטומטית",
        ["Set.Freq"] = "תדירות בדיקת עדכונים:",
        ["Unit.Seconds"] = "שניות",
        ["Unit.Minutes"] = "דקות",
        ["Unit.Hours"] = "שעות",
        ["Unit.Days"] = "ימים",
        ["Set.MinNote"] = "מינימום 30 שניות. ממילא עדכון מתקבל מיידית בעת פרסום (WebSocket), כך שאין צורך באינטרוול קצר.",
        ["Set.AutoUpdate"] = "התקנת עדכונים אוטומטית",
        ["Set.AutoUpdateNote"] = "מוריד ומתקין גרסאות חדשות לבד, ומרענן את התוסף ב-Chrome (מומלץ). אם כבוי - נסמן רק 'עדכון זמין' בלי להתקין.",
        ["Set.Background"] = "הורדת עדכונים ברקע",
        ["Set.Notify"] = "הצגת התראות Windows",
        ["Set.RollbackKeep"] = "מספר גרסאות Rollback לשמירה:",
        ["Set.Beta"] = "שימוש בגרסת Beta של ה-Agent",
        ["Set.Telemetry"] = "שיתוף נתוני שימוש אנונימיים (אופציונלי)",
        ["Set.PrivacyNote"] = "ExtSync אוסף מינימום מידע: מזהה מכשיר אקראי, גרסת Agent, מערכת הפעלה כללית, גרסת תוסף וסטטוס עדכון. איננו אוספים היסטוריית גלישה, תוכן דפים או סיסמאות.",
        ["Set.Save"] = "שמור",
        ["Set.Export"] = "ייצוא לוגים",
        ["Set.Close"] = "סגור",
        ["Set.Saved"] = "ההגדרות נשמרו.",
        ["Set.Version"] = "גרסת התוכנה: {0} (מתעדכנת אוטומטית)",
        // link-input window
        ["Link.WinTitle"] = "הוספת תוסף מקישור",
        ["Link.Prompt"] = "הדבק כאן קישור התקנה שקיבלת מהמפתח:",
        ["Link.Example"] = "לדוגמה: https://extsync.com/install/abc123 או extsync://install?token=abc123",
        ["Link.Ok"] = "המשך",
        ["Link.Cancel"] = "ביטול",
        ["Link.Invalid"] = "לא זוהה טוקן תקין בקישור.",
        // install wizard
        ["Wiz.WinTitle"] = "התקנת תוסף",
        ["Wiz.Header"] = "התקנת התוסף",
        ["Wiz.By"] = "מאת {0}",
        ["Wiz.Meta"] = "גרסה {0} • ערוץ {1}",
        ["Wiz.Perms"] = "הרשאות שהתוסף מבקש:",
        ["Wiz.Hosts"] = "אתרים שאליהם התוסף ניגש: {0}",
        ["Wiz.FirstNote"] = "התקנה ראשונה דורשת הפעלת 'מצב מפתח' ב-Chrome וטעינה ידנית של התיקייה. נדריך אותך צעד-אחר-צעד מיד לאחר ההורדה. עדכונים עתידיים יקרו אוטומטית.",
        ["Wiz.Install"] = "התקנה באמצעות ExtSync",
        ["Wiz.Cancel"] = "ביטול",
        ["Wiz.Unusable"] = "קישור ההתקנה אינו זמין יותר (פג תוקף או נוצל).",
        ["Wiz.InstallFailed"] = "ההתקנה נכשלה: {0}",
        ["Wiz.ChooseProfile"] = "לאיזה פרופיל Chrome להתקין?",
        ["Wiz.ChooseProfileNote"] = "בחר פרופיל - התוסף ייטען אליו, ודף ניהול התוספים ייפתח בו אוטומטית.",
        ["Wiz.GuideHeader"] = "כמעט סיימנו - טעינת התוסף ב-Chrome",
        ["Wiz.Step1"] = "1. בדף chrome://extensions, הפעל 'מצב מפתח' (Developer mode) בפינה.",
        ["Wiz.Step2"] = "2. לחץ 'טען פריט לא ארוז' (Load unpacked).",
        ["Wiz.Step3"] = "3. הדבק את הנתיב שהעתקנו (Ctrl+V) ובחר את תיקיית active - בתוכה נמצא manifest.json.",
        ["Wiz.Step4"] = "4. לאחר הטעינה לחץ למטה 'טענתי את התוסף ✓'.",
        ["Wiz.Folder"] = "נתיב התיקייה: {0}",
        ["Wiz.ProfileNote"] = "דף ניהול התוספים נפתח בפרופיל שבחרת. אם נפתח טאב ריק, לחץ 'העתק chrome://extensions' והדבק בשורת הכתובת.",
        ["Wiz.OpenAgain"] = "פתח שוב את דף התוספים",
        ["Wiz.CopyUrl"] = "העתק chrome://extensions",
        ["Wiz.CopyPath"] = "העתק נתיב התיקייה",
        ["Wiz.OpenFolder"] = "פתח תיקייה",
        ["Wiz.Loaded"] = "טענתי את התוסף ✓",
        ["Wiz.Done"] = "סיום",
        ["Wiz.Help"] = "אני צריך עזרה",
        ["Wiz.CopiedStatus"] = "הכתובת chrome://extensions הועתקה - הדבק בשורת הכתובת של Chrome. לפני 'טען פריט לא ארוז' לחץ שוב 'העתק נתיב התיקייה'.",
        ["Wiz.LoadedStatus"] = "מצוין! התוסף סומן כמותקן ועדכונים עתידיים ינוהלו אוטומטית. אפשר לסגור.",
        ["Wiz.HelpBody"] = "אם התוסף לא נטען:\n• ודא ש'מצב מפתח' מופעל בדף chrome://extensions.\n• ודא שבחרת את התיקייה הנכונה (זו שפתחנו ב-Explorer).\n• נסה ללחוץ 'פתח שוב את דף התוספים' ואז 'טען פריט לא ארוז'.",
        ["Wiz.HelpTitle"] = "עזרה",
        // tray
        ["Tray.Open"] = "פתח ExtSync",
        ["Tray.Check"] = "בדוק עדכונים",
        ["Tray.Store"] = "גלריית התוספים",
        ["Tray.Exit"] = "יציאה",
        // self-update balloons
        ["Upd.Installing"] = "מתקין עדכון לגרסה {0}…",
        ["Upd.Updated"] = "עודכן לגרסה {0} בהצלחה ✓",
        // update pipeline errors (surface via the wizard / server reports)
        ["Err.InvalidSignature"] = "חתימת המטא-דאטה אינה תקינה",
        ["Err.PermissionGated"] = "נדרש אישור הרשאות לפני התקנת העדכון",
        ["Err.SizeExceeded"] = "הקובץ גדול מהמוצהר",
        ["Err.HashMismatch"] = "ה-hash אינו תואם",
        ["Err.LocalCheck"] = "החבילה לא עברה בדיקה מקומית",
    };

    private static readonly Dictionary<string, string> En = new()
    {
        // main window
        ["Main.AddByLink"] = "Add extension from link",
        ["Main.Check"] = "Check for updates",
        ["Main.Settings"] = "Settings",
        ["Main.Empty.Title"] = "No managed extensions yet",
        ["Main.Empty.Body"] = "Install an extension from the gallery on the site, or paste an install link you received from a developer - from then on it updates here automatically.",
        ["Main.Empty.Store"] = "Open the extension gallery",
        ["Main.Empty.Add"] = "Add from link",
        ["Item.Check"] = "Check",
        ["Item.Folder"] = "Folder",
        ["Item.ExtPage"] = "Extensions page",
        ["Item.Rollback"] = "Rollback",
        ["Item.Remove"] = "Remove",
        // header status (view-model)
        ["Conn.Connecting"] = "Connecting…",
        ["Conn.Online"] = "Connected to server",
        ["Conn.Offline"] = "Not connected (offline mode)",
        ["Check.Never"] = "Not checked yet",
        ["Check.Last"] = "Last check: {0}",
        ["Managed.Count"] = "{0} managed extensions",
        ["Msg.CheckFailed"] = "Couldn't check for updates right now. We'll retry later.",
        ["Msg.LinkInvalid"] = "The link is invalid or has expired.",
        // item statuses
        ["St.UpToDate"] = "Up to date",
        ["St.UpdateAvailable"] = "Update available",
        ["St.Updating"] = "Updating…",
        ["St.Downloading"] = "Downloading…",
        ["St.AwaitManual"] = "Waiting for manual load in Chrome",
        ["St.ReloadRequired"] = "Reload required",
        ["St.Paused"] = "Paused",
        ["St.Broken"] = "Broken",
        ["St.RollingBack"] = "Rolling back…",
        ["Pause.Do"] = "Pause",
        ["Pause.Resume"] = "Resume updates",
        ["Bridge.None"] = "No bridge",
        ["Bridge.On"] = "Bridge connected",
        ["Bridge.Off"] = "Bridge disconnected",
        ["Dlg.Rollback.Body"] = "Roll back {0} to the previous version? The current version is kept in the failed folder.",
        ["Dlg.Rollback.Title"] = "Rollback",
        ["Dlg.Rollback.Failed"] = "Rollback failed. The current version is unchanged.",
        ["Dlg.Remove.Body"] = "Remove {0} from management?\n\nYes - remove and delete the extension files from this PC\nNo - remove from management only (files stay)\nCancel - keep it\n\nNote: the extension is not automatically removed from Chrome.",
        ["Dlg.Remove.Title"] = "Remove extension",
        // settings window
        ["Set.WinTitle"] = "ExtSync Settings",
        ["Set.Header"] = "Settings",
        ["Set.Language"] = "Language / שפה:",
        ["Set.Startup"] = "Start with Windows",
        ["Set.AutoCheck"] = "Check for updates automatically",
        ["Set.Freq"] = "Update check frequency:",
        ["Unit.Seconds"] = "seconds",
        ["Unit.Minutes"] = "minutes",
        ["Unit.Hours"] = "hours",
        ["Unit.Days"] = "days",
        ["Set.MinNote"] = "Minimum 30 seconds. Updates arrive instantly on publish anyway (WebSocket), so a short interval is rarely needed.",
        ["Set.AutoUpdate"] = "Install updates automatically",
        ["Set.AutoUpdateNote"] = "Downloads and installs new versions by itself and reloads the extension in Chrome (recommended). If off - we only mark 'update available' without installing.",
        ["Set.Background"] = "Download updates in the background",
        ["Set.Notify"] = "Show Windows notifications",
        ["Set.RollbackKeep"] = "Rollback versions to keep:",
        ["Set.Beta"] = "Use the Agent beta channel",
        ["Set.Telemetry"] = "Share anonymous usage data (optional)",
        ["Set.PrivacyNote"] = "ExtSync collects minimal data: a random device id, Agent version, general OS, extension version and update status. We never collect browsing history, page content or passwords.",
        ["Set.Save"] = "Save",
        ["Set.Export"] = "Export logs",
        ["Set.Close"] = "Close",
        ["Set.Saved"] = "Settings saved.",
        ["Set.Version"] = "App version: {0} (updates automatically)",
        // link-input window
        ["Link.WinTitle"] = "Add extension from link",
        ["Link.Prompt"] = "Paste the install link you received from the developer:",
        ["Link.Example"] = "Example: https://extsync.com/install/abc123 or extsync://install?token=abc123",
        ["Link.Ok"] = "Continue",
        ["Link.Cancel"] = "Cancel",
        ["Link.Invalid"] = "No valid token found in the link.",
        // install wizard
        ["Wiz.WinTitle"] = "Install extension",
        ["Wiz.Header"] = "Install the extension",
        ["Wiz.By"] = "By {0}",
        ["Wiz.Meta"] = "Version {0} • channel {1}",
        ["Wiz.Perms"] = "Permissions this extension requests:",
        ["Wiz.Hosts"] = "Sites this extension accesses: {0}",
        ["Wiz.FirstNote"] = "The first install requires enabling 'Developer mode' in Chrome and loading the folder manually. We'll guide you step-by-step right after the download. Future updates happen automatically.",
        ["Wiz.Install"] = "Install with ExtSync",
        ["Wiz.Cancel"] = "Cancel",
        ["Wiz.Unusable"] = "This install link is no longer available (expired or already used).",
        ["Wiz.InstallFailed"] = "Installation failed: {0}",
        ["Wiz.ChooseProfile"] = "Which Chrome profile to install into?",
        ["Wiz.ChooseProfileNote"] = "Pick a profile - the extension loads into it and its extensions page opens automatically.",
        ["Wiz.GuideHeader"] = "Almost done - load the extension in Chrome",
        ["Wiz.Step1"] = "1. On chrome://extensions, enable 'Developer mode' in the corner.",
        ["Wiz.Step2"] = "2. Click 'Load unpacked'.",
        ["Wiz.Step3"] = "3. Paste the path we copied (Ctrl+V) and pick the active folder - manifest.json is inside it.",
        ["Wiz.Step4"] = "4. After loading, click 'I loaded the extension ✓' below.",
        ["Wiz.Folder"] = "Folder path: {0}",
        ["Wiz.ProfileNote"] = "The extensions page opens in the profile you chose. If a blank tab opened, click 'Copy chrome://extensions' and paste it into the address bar.",
        ["Wiz.OpenAgain"] = "Open the extensions page again",
        ["Wiz.CopyUrl"] = "Copy chrome://extensions",
        ["Wiz.CopyPath"] = "Copy folder path",
        ["Wiz.OpenFolder"] = "Open folder",
        ["Wiz.Loaded"] = "I loaded the extension ✓",
        ["Wiz.Done"] = "Done",
        ["Wiz.Help"] = "I need help",
        ["Wiz.CopiedStatus"] = "chrome://extensions copied - paste it into Chrome's address bar. Before 'Load unpacked', click 'Copy folder path' again.",
        ["Wiz.LoadedStatus"] = "Great! The extension is marked installed and future updates are managed automatically. You can close this window.",
        ["Wiz.HelpBody"] = "If the extension didn't load:\n• Make sure 'Developer mode' is enabled on chrome://extensions.\n• Make sure you picked the right folder (the one we opened in Explorer).\n• Try 'Open the extensions page again' and then 'Load unpacked'.",
        ["Wiz.HelpTitle"] = "Help",
        // tray
        ["Tray.Open"] = "Open ExtSync",
        ["Tray.Check"] = "Check for updates",
        ["Tray.Store"] = "Extension gallery",
        ["Tray.Exit"] = "Exit",
        // self-update balloons
        ["Upd.Installing"] = "Installing update {0}…",
        ["Upd.Updated"] = "Updated to version {0} ✓",
        // update pipeline errors (surface via the wizard / server reports)
        ["Err.InvalidSignature"] = "Invalid metadata signature",
        ["Err.PermissionGated"] = "Permission approval is required before installing the update",
        ["Err.SizeExceeded"] = "The file is larger than declared",
        ["Err.HashMismatch"] = "Hash mismatch",
        ["Err.LocalCheck"] = "The package failed local verification",
    };
}
