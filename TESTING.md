# בדיקות — מה רץ ואיך

סיכום הבדיקות במערכת ומה אומת בפועל.

## הרצה מהירה
```bash
# release-schema (חתימה חוצה-שפות, Python↔TS)
cd packages/release-schema && npm test            # + python python/generate_vectors.py

# Backend API
cd apps/api && PYTHONPATH=src python -m pytest -q

# Worker (ולידציית ZIP, אבטחה)
cd apps/worker && PYTHONPATH=../api/src:src python -m pytest -q

# Integration (upload→validate→sign→publish→agent→rollout→rollback)
PYTHONPATH=apps/api/src:apps/worker/src:packages/release-schema/python python -m pytest tests/integration -q

# Bridge + CLI (TypeScript)
cd packages/extension-bridge && npm test
cd apps/cli && npm test

# Web (Next.js)
cd apps/web && npm run typecheck && npm run build

# Agent (.NET — דורש Windows + .NET 8 SDK)
dotnet test apps/agent-windows/ExtSync.Agent.sln
```

## מה אומת בפועל (בסביבת הבנייה)
| חבילה | בדיקות | סטטוס |
|-------|--------|-------|
| release-schema (TS) | 7 | ✅ עוברות (קנוניזציה + חתימה זהות ל-Python) |
| release-schema (Python) | self-test | ✅ |
| apps/api | 10 (auth + ext-id) | ✅ |
| apps/worker | 17 (ולידציה + אבטחה) | ✅ |
| tests/integration | 6 (פייפליין + agent) | ✅ |
| extension-bridge (TS) | 9 | ✅ |
| cli (TS) | 5 | ✅ |
| web | tsc + next build | ✅ |
| **סה"כ אוטומטי** | **~54 + build** | ✅ |

## מה דורש סביבה נוספת
- **Agent (.NET xUnit)**: דורש .NET 8 SDK + Windows. בדיקות כתובות
  (`apps/agent-windows/ExtSync.Agent.Tests`): קנוניזציה מול אותם וקטורים, אימות חתימה,
  השוואת גרסאות, פירוק URI.
- **Chrome אמיתי**: ראו [docs/security/manual-chrome-tests.md](docs/security/manual-chrome-tests.md)
  (טעינת unpacked, reload, Native Messaging, יציבות Extension ID).
- **Playwright e2e**: ראו `tests/end-to-end` (דורש סטאק חי + דפדפן).

## כיסוי אבטחה (§35)
Path Traversal, ZIP Bomb, חתימה שגויה, Hash שגוי, manifest פגום/MV2, קוד מרוחק, eval,
קבצים בינאריים, idempotency, refresh-token reuse, rollout auto-stop — כולם מכוסים בבדיקות
שעוברות (worker + api + integration).
