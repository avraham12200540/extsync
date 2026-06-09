# ExtSync API

מקור האמת החי הוא ה-**OpenAPI** ב-`http://localhost:8000/docs` (ו-`/openapi.json`).
המסמך הזה מסכם את משטח ה-API ואת מודל ההרשאות.

## אימות
- **מפתחים/משתמשים**: `Authorization: Bearer <access JWT>`. ה-access token מתקבל מ-
  `/auth/login` (או `/auth/2fa/verify`), מתחדש דרך `/auth/refresh` (refresh token ב-cookie httpOnly עם רוטציה וזיהוי שימוש-חוזר).
- **API tokens** (CLI/CI): `Authorization: Bearer exsk_<prefix>.<secret>` — נשמר hash בלבד.
- **Agent**: `X-Agent-Token: <device token>` (מ-`/agent/register` או device-flow).

## קבוצות endpoints
- **Auth**: register, login, logout, logout-all, refresh, verify-email, forgot/reset-password, 2fa/setup, 2fa/verify, device-flow/{start,approve,token}, me.
- **Projects**: CRUD תחת `/projects`.
- **Releases**: `/projects/{id}/releases` (upload multipart), get/list, publish, pause, revoke, rollback.
- **Install links**: CRUD + `/install-links/{token}/resolve` (ציבורי).
- **Agent**: register, heartbeat, check-updates, report-update, register/unregister-extension, release-metadata, self-update, `WS /agent/events`.
- **Teams**: list/create, get, members add/update/remove.
- **API tokens**: create/list/revoke.
- **Webhooks**: `/projects/{id}/webhooks` CRUD + deliveries + resend.
- **Notifications**: list, read, read-all.
- **Analytics**: `/dashboard`, `/projects/{id}/analytics`.
- **Admin** (platform_admin): users, projects, releases, suspend/revoke, security-events, system-health, agent-versions.

## RBAC (§3)
תפקידים: guest, end_user, developer, team_member, team_admin, platform_admin.
הרשאות פרויקט נגזרות מבעלות או מתפקיד צוות (viewer/developer/release_manager/admin).
פרסום ל-**Stable** דורש Release Manager/Admin/Owner. ראו `apps/api/src/extsync_api/rbac.py`.

## פורמט שגיאה
```json
{ "error": { "code": "INVALID_SIGNATURE", "message": "...", "details": {} } }
```
קודי שגיאה עקביים מוגדרים ב-`errors.py` (§34) ומשותפים עם ה-Agent.

## ולידציה
כל גוף בקשה עובר ולידציית Pydantic (camelCase). שגיאות ולידציה מחזירות `422` עם
פירוט שדות.
