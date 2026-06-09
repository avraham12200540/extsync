# מודל החתימה ושרשרת העדכון (§26)

## עקרון
ה-Agent מתקין קוד רק אם הוא הגיע מהפלטפורמה ולא שונה. לכן:
- **Metadata** של כל גרסה נחתם ב-**Ed25519**.
- **ה-Artifact** (ה-ZIP) מאומת ב-**SHA-256** שכלול ב-metadata החתום.
- ה-Agent מחזיק את ה-**מפתח הציבורי** של הפלטפורמה ומאמת לפני כל התקנה.

## הפרדת רכיבים
| רכיב | אחריות | גישה למפתח פרטי? |
|------|---------|------------------|
| Upload service (API) | קבלת ZIP, יצירת Release, אחסון | לא |
| Validation worker | חילוץ מבודד, בדיקות אבטחה, אריזת artifact | לא |
| Release service (API) | בניית metadata, ניהול ערוצים | לא |
| **Signing service** | חתימת metadata בלבד | **כן** (מבודד) |
| Artifact storage (S3) | אחסון immutable | לא |

שירות החתימה (`apps/api/src/extsync_signing`):
- מאזין ברשת פנימית בלבד (ב-compose: `expose`, לא `ports`).
- מקבל **רק** אובייקט metadata מוגדר — לא קבצי משתמש.
- דורש token פנימי (`X-Internal-Token`).
- טוען את המפתח הפרטי מקובץ/secret (`SIGNING_PRIVATE_KEY_PATH`), לא מה-DB.
- מתעד כל חתימה (project/version/sequence/keyId).

## הפורמט הקנוני
החתימה מחושבת על הצורה הקנונית של ה-metadata **ללא** שדה `signature`. הכללים מוגדרים
פעם אחת ב-[`packages/release-schema`](../../packages/release-schema/README.md) ומיושמים
זהה ב-Python, TypeScript ו-.NET. בדיקות אוטומטיות מוכיחות זהות בייט-בייט
(`packages/release-schema` tests, `apps/agent-windows/ExtSync.Agent.Tests`).

```
signedBytes = canonicalJSON(metadata \ {"signature"})   # כולל keyId
signature   = base64(Ed25519_sign(privateKey[keyId], signedBytes))
```

ה-Agent מסרב להתקין כאשר (כל אחד מאלה):
- חתימה לא תקינה / `keyId` לא מוכר
- SHA-256 לא תואם
- `projectId` שונה
- הקובץ גדול מהמוצהר
- `sequence` נמוך-או-שווה לאחרון (אלא אם `rollback: true` חתום)
- `minimumAgentVersion` גבוה מגרסת ה-Agent
- כשל בבדיקה מקומית (manifest/גרסה/קבצים)

## רוטציית מפתחות (Key Rotation)
- `keyId` נכלל ב-metadata ובחתימה.
- ה-Agent מחזיק מפה של `keyId → publicKey` ויכול לאמת מול **כמה מפתחות במקביל**.
- מעבר הדרגתי: מפיצים גרסאות חדשות עם `keyId` חדש בעוד מפתחות ישנים עדיין מאומתים; לאחר מכן מסירים מפתח ישן.
- מפתח שנפרץ: מסירים מרשימת ה-public keys של ה-Agent (בעדכון Agent) ומפסיקים לחתום איתו.

## יצירת מפתח לפיתוח
```
make gen-dev-signing-key
# כותב infrastructure/docker/dev-signing-key.pem (ב-.gitignore)
# ומדפיס SIGNING_PUBLIC_KEYS=key-...:<base64> ל-.env ול-Agent (EXTSYNC_PUBLIC_KEYS / keys.json)
```

## פרודקשן
- המפתח הפרטי נוצר ונשמר ב-KMS/secret manager, מחוץ ל-repo ול-DB.
- שירות החתימה רץ ברשת מבודדת, נגיש רק ל-Release service.
- אין סודות חתימה ב-GitHub או באפליקציה הקדמית (§37).
