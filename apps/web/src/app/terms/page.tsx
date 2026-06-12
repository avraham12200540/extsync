import type { Metadata } from "next";
import { MarketingShell, PageHero } from "@/components/marketing";
import { getLocale } from "@/lib/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  return (await getLocale()) === "en"
    ? { title: "Terms of Service", robots: { index: true } }
    : { title: "תנאי שימוש", robots: { index: true } };
}

const HE: [string, string][] = [
  ["1. השירות", "ExtSync היא פלטפורמה להפצה, התקנה ועדכון של תוספי Chrome מחוץ ל-Chrome Web Store. השירות כולל אתר, ממשק למפתחים ותוכנת Windows (ExtSync Agent). השימוש בשירות מהווה הסכמה לתנאים אלה."],
  ["2. חשבונות מפתחים", "פתיחת חשבון מפתח דורשת כתובת אימייל תקפה. אתם אחראים לשמירת פרטי ההתחברות שלכם ולכל פעולה שמתבצעת בחשבונכם. אנו רשאים להשעות או לסגור חשבון שמפר תנאים אלה."],
  ["3. תוכן של מפתחים", "מפתח שמעלה תוסף מצהיר שהוא בעל הזכויות בקוד או מורשה להפיצו, ושהתוסף אינו זדוני, אינו אוסף מידע ללא גילוי נאות ואינו מפר חוק. האחריות המלאה לתוכן התוסף - על המפתח שהעלה אותו."],
  ["4. בדיקות אבטחה", "כל גרסה עוברת בדיקות אוטומטיות ונחתמת דיגיטלית. הבדיקות מקטינות סיכון אך אינן ערובה מוחלטת - התקנת תוסף היא על אחריות המתקין. אנו רשאים להסיר או לחסום תוסף לפי שיקול דעתנו."],
  ["5. שימוש בתוכנה (Agent)", "התוכנה מותקנת ברמת המשתמש ומעדכנת את עצמה ואת התוספים המנוהלים אוטומטית. אין לבצע הנדסה לאחור למנגנון החתימה או לעקוף את אימותי האבטחה."],
  ["6. זמינות ואחריות", "השירות ניתן כפי-שהוא (AS IS), ללא התחייבות לזמינות רציפה. לא נהיה אחראים לכל נזק עקיף שייגרם משימוש בשירות או בתוספים המופצים דרכו, במידה המרבית המותרת בחוק."],
  ["7. שינויים בתנאים", "נוכל לעדכן תנאים אלה מעת לעת. המשך שימוש בשירות לאחר עדכון מהווה הסכמה לנוסח המעודכן."],
  ["8. יצירת קשר", "שאלות על התנאים: glasser.avraham@gmail.com"],
];

const EN: [string, string][] = [
  ["1. The Service", "ExtSync is a platform for distributing, installing and updating Chrome extensions outside the Chrome Web Store. The service includes the website, the developer dashboard and the Windows app (ExtSync Agent). Using the service constitutes acceptance of these terms."],
  ["2. Developer accounts", "Creating a developer account requires a valid email address. You are responsible for safeguarding your credentials and for any activity in your account. We may suspend or close accounts that violate these terms."],
  ["3. Developer content", "A developer who uploads an extension declares that they own or are licensed to distribute its code, and that the extension is not malicious, does not collect data without proper disclosure and does not break the law. Full responsibility for extension content lies with the developer who uploaded it."],
  ["4. Security scanning", "Every version passes automated checks and is digitally signed. Scanning reduces risk but is not an absolute guarantee - installing an extension is at the installer's own risk. We may remove or block any extension at our discretion."],
  ["5. Using the Agent app", "The app installs per-user and automatically updates itself and the managed extensions. Do not reverse-engineer the signing mechanism or bypass its security verifications."],
  ["6. Availability and liability", "The service is provided AS IS, with no guarantee of continuous availability. To the maximum extent permitted by law, we are not liable for any indirect damage caused by using the service or extensions distributed through it."],
  ["7. Changes to these terms", "We may update these terms from time to time. Continued use of the service after an update constitutes acceptance of the revised text."],
  ["8. Contact", "Questions about these terms: glasser.avraham@gmail.com"],
];

export default async function TermsPage() {
  const locale = await getLocale();
  const sections = locale === "en" ? EN : HE;
  return (
    <MarketingShell>
      <PageHero
        eyebrow={locale === "en" ? "Legal" : "משפטי"}
        title={locale === "en" ? "Terms of Service" : "תנאי שימוש"}
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
