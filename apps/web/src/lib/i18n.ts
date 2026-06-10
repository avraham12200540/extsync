// Minimal i18n with Hebrew as the default locale and an English scaffold (§4).
// Designed so a full i18n library can replace this later without touching call sites.

export type Locale = "he" | "en";

export const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) || "he";

type Dict = Record<string, string>;

const he: Dict = {
  "app.name": "ExtSync",
  "nav.overview": "סקירה",
  "nav.extensions": "תוספים",
  "nav.installations": "התקנות",
  "nav.team": "צוות",
  "nav.api": "API",
  "nav.settings": "הגדרות",
  "nav.docs": "תיעוד",
  "nav.support": "תמיכה",
  "action.login": "התחברות",
  "action.register": "הרשמה",
  "action.logout": "התנתקות",
  "action.create": "יצירה",
  "action.cancel": "ביטול",
  "action.save": "שמירה",
  "action.upload": "העלאה",
  "action.publish": "פרסום",
  "action.checkUpdates": "בדיקת עדכונים",
  "home.tagline": "הפצה, התקנה ועדכון של תוספי Chrome פרטיים - מחוץ ל-Web Store.",
  "home.cta.developer": "פתיחת חשבון מפתח",
  "home.cta.agent": "הורדת ExtSync Agent",
  "auth.email": "אימייל",
  "auth.password": "סיסמה",
  "auth.displayName": "שם תצוגה",
  "auth.orgName": "שם מפתח / ארגון",
  "auth.acceptTerms": "אני מאשר/ת את תנאי השימוש",
  "dashboard.title": "לוח בקרה",
  "projects.title": "התוספים שלי",
  "projects.new": "תוסף חדש",
  "common.version": "גרסה",
  "common.channel": "ערוץ",
  "common.status": "סטטוס",
  "common.permissions": "הרשאות",
  "common.installs": "התקנות",
  "common.developer": "מפתח",
  "install.cta": "התקנה באמצעות ExtSync",
  "install.needAgent": "כדי להתקין צריך תחילה את ExtSync Agent",
};

const en: Dict = {
  "app.name": "ExtSync",
  "nav.overview": "Overview",
  "nav.extensions": "Extensions",
  "nav.installations": "Installations",
  "nav.team": "Team",
  "nav.api": "API",
  "nav.settings": "Settings",
  "nav.docs": "Docs",
  "nav.support": "Support",
  "action.login": "Sign in",
  "action.register": "Sign up",
  "action.logout": "Sign out",
  "action.create": "Create",
  "action.cancel": "Cancel",
  "action.save": "Save",
  "action.upload": "Upload",
  "action.publish": "Publish",
  "action.checkUpdates": "Check updates",
  "home.tagline": "Distribute, install and update private Chrome extensions - outside the Web Store.",
  "home.cta.developer": "Create a developer account",
  "home.cta.agent": "Download ExtSync Agent",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.displayName": "Display name",
  "auth.orgName": "Developer / org name",
  "auth.acceptTerms": "I accept the Terms of Service",
  "dashboard.title": "Dashboard",
  "projects.title": "My extensions",
  "projects.new": "New extension",
  "common.version": "Version",
  "common.channel": "Channel",
  "common.status": "Status",
  "common.permissions": "Permissions",
  "common.installs": "Installs",
  "common.developer": "Developer",
  "install.cta": "Install with ExtSync",
  "install.needAgent": "You need the ExtSync Agent first",
};

const dicts: Record<Locale, Dict> = { he, en };

export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return dicts[locale][key] ?? dicts.he[key] ?? key;
}

export const isRtl = (locale: Locale = DEFAULT_LOCALE) => locale === "he";
