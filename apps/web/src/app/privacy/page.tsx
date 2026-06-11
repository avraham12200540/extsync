import type { Metadata } from "next";
import { MarketingShell, PageHero } from "@/components/marketing";
import { getLocale } from "@/lib/locale-server";

export function generateMetadata(): Metadata {
  return getLocale() === "en"
    ? { title: "Privacy Policy", robots: { index: true } }
    : { title: "מדיניות פרטיות", robots: { index: true } };
}

const HE: [string, string][] = [
  ["1. איזה מידע נאסף", "חשבון מפתח: כתובת אימייל, שם תצוגה וסיסמה מוצפנת (hash). תוכנת ה-Agent: מזהה מכשיר אקראי (לא נגזר מחומרה), גרסת התוכנה, גרסת מערכת ההפעלה הכללית, ואילו תוספים מנוהלים עם סטטוס העדכון שלהם - זה המינימום הדרוש כדי שעדכונים יעבדו."],
  ["2. מה איננו אוספים", "איננו אוספים היסטוריית גלישה, תוכן דפים, סיסמאות מהדפדפן או כל מידע אישי מתוך התוספים. שיתוף נתוני שימוש אנונימיים בתוכנה הוא בהסכמה בלבד (opt-in) וכבוי כברירת מחדל."],
  ["3. עוגיות (Cookies)", "האתר משתמש בעוגיות הכרחיות בלבד: עוגיית התחברות (refresh token) ועוגיית שפה (he/en). אין עוגיות פרסום או מעקב צד-שלישי."],
  ["4. ספקי משנה", "האתר מתארח ב-Vercel; השרתים ב-DigitalOcean (אירופה); מיילים נשלחים דרך Resend; קבצי ההתקנה מופצים דרך GitHub. לכל אחד מהם מדיניות פרטיות משלו, והם מעבדים רק את הדרוש לתפעול השירות."],
  ["5. אבטחת מידע", "סיסמאות נשמרות כ-hash בלבד, התקשורת מוצפנת (HTTPS), וכל גרסת תוסף חתומה דיגיטלית. גיבויים נשמרים לפרק זמן מוגבל."],
  ["6. זכויותיכם", "אפשר לבקש עיון, תיקון או מחיקה של המידע האישי שלכם בכל עת בפנייה למייל שבסעיף 8. מחיקת חשבון מוחקת את פרטיו האישיים; נתוני אבטחה אגרגטיביים עשויים להישמר."],
  ["7. שינויים במדיניות", "עדכונים למדיניות יפורסמו בדף זה עם תאריך עדכון חדש."],
  ["8. יצירת קשר", "שאלות פרטיות: glasser.avraham@gmail.com"],
];

const EN: [string, string][] = [
  ["1. What we collect", "Developer account: email address, display name and a hashed password. The Agent app: a random device id (not hardware-derived), app version, general OS version, and which extensions are managed with their update status - the minimum required for updates to work."],
  ["2. What we do not collect", "We do not collect browsing history, page content, browser passwords or any personal data from inside extensions. Anonymous usage sharing in the app is opt-in only and off by default."],
  ["3. Cookies", "The site uses essential cookies only: a sign-in (refresh token) cookie and a language (he/en) cookie. No advertising or third-party tracking cookies."],
  ["4. Sub-processors", "The site is hosted on Vercel; servers run on DigitalOcean (EU); emails are sent via Resend; installers are distributed via GitHub. Each has its own privacy policy and processes only what is needed to operate the service."],
  ["5. Security", "Passwords are stored as hashes only, traffic is encrypted (HTTPS), and every extension version is digitally signed. Backups are retained for a limited period."],
  ["6. Your rights", "You may request access to, correction of, or deletion of your personal data at any time via the email in section 8. Deleting an account removes its personal details; aggregate security data may be retained."],
  ["7. Changes to this policy", "Updates will be published on this page with a new revision date."],
  ["8. Contact", "Privacy questions: glasser.avraham@gmail.com"],
];

export default function PrivacyPage() {
  const locale = getLocale();
  const sections = locale === "en" ? EN : HE;
  return (
    <MarketingShell>
      <PageHero
        eyebrow={locale === "en" ? "Legal" : "משפטי"}
        title={locale === "en" ? "Privacy Policy" : "מדיניות פרטיות"}
        subtitle={locale === "en" ? "Last updated: June 11, 2026" : "עדכון אחרון: 11 ביוני 2026"}
      />
      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="space-y-7">
          {sections.map(([h, p]) => (
            <div key={h}>
              <h2 className="mb-1.5 font-semibold text-ink">{h}</h2>
              <p className="text-sm leading-relaxed text-ink-muted">{p}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
