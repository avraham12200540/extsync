# ADR-0001: שימוש ב-Architecture Decision Records

- סטטוס: Accepted
- תאריך: 2026-06-08

## הקשר
ExtSync היא מערכת מבוזרת רב-רכיבית (שרת, worker, Agent ב-Windows, Native Host, Bridge, CLI) עם החלטות הנדסיות בעלות השלכות אבטחה. צריך תיעוד קצר ובר-מעקב של ההחלטות ולמה התקבלו.

## החלטה
נשתמש ב-ADRs קצרים בפורמט אחיד תחת `docs/architecture/adr/NNNN-title.md`. כל החלטה משמעותית (אבטחה, פורמט נתונים, אסטרטגיית עדכון, גבולות אמון) מקבלת ADR. סטטוסים: Proposed / Accepted / Superseded.

## תוצאה
מסמך אמת יחיד לרציונל. שינוי החלטה = ADR חדש שמסמן את הקודם כ-Superseded, לא עריכה היסטורית.
