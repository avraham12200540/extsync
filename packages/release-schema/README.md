# @extsync/release-schema

מקור האמת חוצה-השפות לפורמט **Release Metadata** ולחתימה עליו. כל רכיב שמייצר או מאמת metadata (API, Worker, Signing, Agent ב-.NET, CLI) **חייב** להשתמש בכללי הקנוניזציה שכאן — אחרת חתימות לא יאומתו.

- סכמת JSON: [`schema/release-metadata.schema.json`](schema/release-metadata.schema.json)
- מימוש TypeScript: [`src/index.ts`](src/index.ts)
- מימוש Python: [`python/extsync_release_schema/__init__.py`](python/extsync_release_schema/__init__.py)
- מימוש .NET: `apps/agent-windows/ExtSync.Agent/Crypto/ReleaseMetadata.cs` (חייב לתת בתים זהים)

## פורמט קנוני (Canonical JSON)

החתימה מחושבת על **הבתים הקנוניים** של אובייקט ה-metadata **ללא שדה `signature`**. הקנוניזציה היא תת-קבוצה דטרמיניסטית של RFC 8785 (JCS), פשוטה כי הסכמה אוסרת מספרים לא-שלמים:

1. **סוגים מותרים בלבד**: object, array, string, integer, boolean. (אין float, אין null בשדות החתומים.)
2. **מפתחות object** ממוינים בסדר עולה לפי **נקודות קוד Unicode**. כל המפתחות בסכמה הם ASCII, ולכן מיון לפי code point ⇔ מיון לפי UTF-16 code unit ⇔ מיון בייטים — זהה ב-Python/JS/.NET.
3. **ללא רווחים לבנים**: מפרידים `,` ו-`:` בלבד.
4. **מחרוזות**: escaping מינימלי של JSON (`"`, `\`, ותווי בקרה `\u00xx`). פלט UTF-8, **ללא** escaping של תווים שאינם ASCII (כלומר תווים מעל 0x1F נכתבים כפי שהם).
5. **מספרים**: שלמים בלבד, בייצוג עשרוני קצר ביותר, ללא סימן `+`, ללא אפסים מובילים, ללא `.0`.
6. **בוליאני**: `true` / `false`.
7. הקידוד הסופי הוא **UTF-8**.

### חתימה
```
signedBytes = canonicalJSON( metadata \ {"signature"} )   # כולל את keyId
signature   = base64( Ed25519_sign( privateKey[keyId], signedBytes ) )
```

### אימות (ב-Agent)
```
pub        = publicKeys[ metadata.keyId ]          # מתוך מפתחות מוטמעים
signedBytes = canonicalJSON( metadata \ {"signature"} )
ok         = Ed25519_verify( pub, base64decode(metadata.signature), signedBytes )
```
אם `keyId` לא מוכר או האימות נכשל — **לא מתקינים** (`INVALID_SIGNATURE`).

## בדיקת תאימות חוצה-שפות
`python/extsync_release_schema/vectors.json` מכיל וקטורי בדיקה (קלט → בתים קנוניים בבסיס64). הבדיקות ב-Python, ב-TS וב-.NET טוענות את אותו קובץ ומוודאות בתים זהים. ראו:
- `tests/` בצד Python (apps/api/tests),
- `src/index.test.ts` כאן,
- בדיקות ה-.NET ב-`apps/agent-windows`.

> חשוב: אל תשתמשו ב-`JSON.stringify`/`json.dumps` רגיל לחתימה. השתמשו ב-`canonicalize()` מהחבילה הזו בלבד.
