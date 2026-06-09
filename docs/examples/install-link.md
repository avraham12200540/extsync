# דוגמת קישור התקנה מקומי (§43 תוצר 14)

לאחר `make seed` נוצר פרויקט דוגמה "Hello ExtSync" עם קישור התקנה ציבורי. כדי לקבל
את הקישור המדויק (הטוקן אקראי):

## דרך לוח הבקרה
1. התחברו כ-`dev@extsync.local` (הסיסמה מודפסת בסוף `make seed`).
2. תוספים → Hello ExtSync → לשונית "קישורי התקנה" → העתיקו את הקישור.

## דרך ה-API
```bash
# התחברות וקבלת access token (או צרו API token בלוח הבקרה)
TOKEN=...    # exsk_...  או access JWT
# רשימת קישורים של הפרויקט
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/projects/<PROJECT_ID>/install-links
```

## פורמט הקישור
```
https://<domain>/install/<token>            # דף ההתקנה הציבורי (אתר)
extsync://install?token=<token>             # ה-URI שכפתור ההתקנה פותח (Agent)
```

דוגמה (פיתוח מקומי):
```
http://localhost:3000/install/8f3a1c9d4b7e2f6a0c5d8e1b3a7f9c2d
```

## רזולוציה (preview ללא התקנה)
```bash
curl -X POST http://localhost:8000/install-links/<token>/resolve
# מחזיר: שם, מפתח, גרסה, ערוץ, הרשאות, install_uri, usable, ...
```
