# ExtSync — סקירת ארכיטקטורה

## תמונה כללית

```
                         ┌────────────────────────────────────────────┐
   Developer browser     │                  Cloud / Server             │
   ┌──────────────┐      │  ┌─────────┐   ┌──────────┐   ┌──────────┐ │
   │  Next.js web │◄────►│  │  API     │   │  Worker  │   │ Signing  │ │
   │  (dashboard) │ HTTPS│  │ FastAPI  │──►│ (ZIP val,│   │ Ed25519  │ │
   └──────────────┘      │  │          │   │  static  │   │ (isolated│ │
                         │  │          │◄──│  analysis│──►│  network)│ │
   CLI (extsync) ───────►│  └────┬─────┘   └────┬─────┘   └──────────┘ │
                         │       │ SQLAlchemy    │ boto3                │
                         │  ┌────▼─────┐   ┌─────▼──────┐  ┌──────────┐ │
                         │  │ Postgres │   │   Redis    │  │ S3/MinIO │ │
                         │  └──────────┘   │ (queue,    │  │ uploads/ │ │
                         │                 │  pubsub,   │  │ artifacts│ │
                         │                 │  ratelimit)│  └──────────┘ │
                         └─────────────────┴────────────┴──────────────┘
                                    ▲ WS /agent/events  ▲ HTTPS REST
                                    │ (push)            │ (poll/report)
              ┌─────────────────────┴───────────────────┴───────────────┐
              │                  End-user Windows PC                      │
              │  ┌────────────────┐   named pipe   ┌──────────────────┐  │
              │  │  ExtSync Agent  │◄─────────────►│  Native Host      │  │
              │  │  (WPF, SQLite)  │               │  (stdio bridge)   │  │
              │  └───────┬─────────┘               └─────────┬────────┘  │
              │   file swap + rollback                       │ stdio     │
              │  ┌───────▼──────────────────────┐   ┌────────▼────────┐  │
              │  │ %LOCALAPPDATA%\ExtSync\       │   │  Chrome         │  │
              │  │   Extensions\{projectId}\     │◄──┤  (unpacked ext  │  │
              │  │     active|staging|rollback   │   │   + Bridge)     │  │
              │  └──────────────────────────────┘   └─────────────────┘  │
              └───────────────────────────────────────────────────────────┘
```

## גבולות אמון
1. **מפתח → שרת**: מאומת (session/JWT/API token), RBAC, audit.
2. **שרת → Agent**: ה-Agent מאמת חתימת Ed25519 על metadata + SHA-256 על artifact. השרת לא "סומך" על ה-Agent — מקבל דיווחים אך מאמת idempotency/sequence.
3. **Agent ↔ Chrome (Native Messaging)**: origins מוגבלים ל-IDs מנוהלים; reload רק אחרי הודעה מאומתת.
4. **שירות החתימה**: מבודד רשתית, מקבל רק metadata מוגדר, מחזיק מפתח פרטי מחוץ ל-DB הראשי.

## רכיבים
ראו [README](../../README.md) לטבלת הרכיבים. החלטות מפתח: [ADR-0002](adr/0002-server-source-of-truth-hybrid-sync.md) (סנכרון), [ADR-0003](adr/0003-ed25519-signed-release-metadata.md) (חתימה), [ADR-0004](adr/0004-folder-swap-vs-journal-update.md) (החלפת קבצים), [ADR-0005](adr/0005-stable-extension-id.md) (Extension ID), [ADR-0006](adr/0006-native-messaging-hkcu.md) (Native Messaging).

## מגבלות אמת
ראו [limitations.md](limitations.md) — חובה. ExtSync לא עוקפת הגנות Chrome; היא מנהלת את מחזור החיים סביב מגבלת ה-unpacked.

## מצבי גרסה (server) ומצבי התקנה (local)
- **פרויקט**: draft → active → suspended → archived → deleted
- **גרסה**: uploaded → validating → (validation_failed | ready) → draft → scheduled → publishing → published → (paused | superseded | revoked)
- **התקנה מקומית**: downloading → staged → awaiting_manual_load → installed → update_available → updating → reload_required → up_to_date → paused → broken → rollback_in_progress → removed

מכונות המצב המלאות מיושמות ב-`apps/api` (server) וב-`apps/agent-windows` (local) עם מעברים מוגדרים בלבד.
