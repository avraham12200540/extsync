# Extension ID יציב (§11, ADR-0005)

## הבעיה
ב-unpacked extension, Chrome גוזר את ה-Extension ID מ-`key` ב-manifest אם קיים,
אחרת מנתיב התיקייה (משתנה בין מחשבים). דרוש ID **קבוע** בין גרסאות ומחשבים — עבור
Native Messaging `allowed_origins`, `externally_connectable`, ועקביות נתונים.

## כיצד נוצר המפתח
- לכל פרויקט נוצר זוג מפתחות **RSA-2048** פעם אחת, בעת יצירת הפרויקט
  (`services/extension_key.generate_project_keypair`).
- ה-ID מחושב כ-`Chrome`-style: `SHA-256(DER SubjectPublicKeyInfo)`, 16 הבייטים הראשונים,
  כל nibble ממופה `0..15 → 'a'..'p'` ⇒ 32 תווים.

## מה נשמר בשרת
טבלת `project_keys`:
- `public_key_b64` — המפתח הציבורי (DER, base64). **זה** מה שנכנס ל-`manifest.key`.
- `private_key_encrypted` — ה-PEM הפרטי, **מוצפן at-rest** (Fernet נגזר מסוד האפליקציה; בפרודקשן KMS).
- `extension_id` — ה-ID המחושב.

## מה נכנס ל-Manifest
ה-Worker **מזריק** את `key` (המפתח הציבורי) ל-`manifest.json` בעת אריזת ה-Artifact
המאומת (`artifact.inject_manifest_key`). ה-ZIP המקורי של המפתח לא משתנה. כך כל גרסה
מקבלת אותו `key` ⇒ אותו ID.

> **המפתח הפרטי לעולם לא נשלח ללקוח ולא נכנס ל-ZIP.** רק הציבורי.

## שחזור פרויקט מגיבוי
גבו את טבלת `project_keys` (מוצפנת). שחזור = החזרת השורה; ה-ID נשמר כי הוא תלוי רק
במפתח הציבורי.

## אובדן מפתח
אם המפתח הפרטי אבד ואין גיבוי: אי אפשר להמשיך לחתום על שינוי ה-`key`, אך מאחר ש-`key`
הוא הציבורי שכבר ב-artifacts, ה-ID נשאר יציב כל עוד שומרים את הציבורי. אובדן **הציבורי**
(ללא artifact קיים) משמעו שתוסף חדש יקבל ID חדש — לכן יש לגבות את `project_keys`.
מומלץ: גיבוי תקופתי מוצפן + KMS בפרודקשן.

## אימות שה-ID נשאר קבוע
- **אוטומטי**: `apps/api/tests/test_extension_key.py` — אותו public key ⇒ אותו ID; recompute יציב.
- **ידני (חובה ב-Chrome)**: טעינת שתי גרסאות / שני מחשבים נותנת אותו ID. ראו
  [manual-chrome-tests.md](manual-chrome-tests.md) §1–§2.

## למה לא להשתמש ב-ID של Chrome ישירות
ה-ID נקבע רק כש-Chrome טוען את התוסף. אנחנו מחשבים אותו מראש בשרת (אותו אלגוריתם)
כדי לאכלס `allowed_origins` ולהציג ID לפני התקנה. שינוי Extension ID בין גרסאות
**חסום** במדיניות (§15).
