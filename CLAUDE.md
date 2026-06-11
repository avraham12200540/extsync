# CLAUDE.md - agent guide for the ExtSync monorepo

## FIRST: load the full project brain

The complete agent handoff knowledge (ops, deploy details, infra, current
state) lives in a **private** repo: `avraham12200540/extsync-ops`, file
`AGENT.md`. Before non-trivial work, read it:

```bash
# if not cloned yet (requires gh auth as the owner):
git clone https://github.com/avraham12200540/extsync-ops.git ../extsync-ops
# then read ../extsync-ops/AGENT.md
```

**Maintenance rule (applies to every agent, every machine): after any
significant change to this project - new feature, convention, deploy change,
infra change - update `AGENT.md` in extsync-ops and push it.** That file is
how agents stay in sync across machines.

## What this is

ExtSync distributes, installs and auto-updates private/public Chrome
extensions outside the Chrome Web Store. Hebrew-first product; the founder
communicates in Hebrew.

## Layout

- `apps/web` - Next.js 14 + Tailwind (RTL, bilingual he/en, dark default)
- `apps/api` - FastAPI + Postgres + Redis (+ `extsync_signing` isolated signer)
- `apps/worker` - release validation/signing pipeline
- `apps/agent-windows` - WPF .NET 8 Windows Agent (self-updating)
- `apps/native-host`, `installers/windows`, `infrastructure`

## Deploys

- Web: auto on push to `main` (Vercel).
- Agent: GH Actions auto-builds + releases on push touching agent paths;
  version is `1.0.{run_number}` - never hardcode. No local dotnet SDK: CI is
  the compile check, so keep agent changes to one commit.
- API/worker: manual redeploy on the VPS (founder runs it; see AGENT.md).

## Hard conventions

- Never use the em-dash "—" in user-facing text; use "-".
- Dark mode is default: any hard-coded light style needs a `dark:` variant.
- Every new user-facing web string goes into BOTH `he` and `en` dicts in
  `apps/web/src/lib/i18n.ts` (client: `useLocale()`; server: `getLocale()`).
- Keep end-user UX as simple as possible - no unnecessary UI.
- Verify before push: `npx tsc --noEmit` + `npm run build` (apps/web),
  `python -m py_compile` for touched Python.
- This repo is PUBLIC - never commit secrets, tokens or private infra details
  here; those belong in extsync-ops.
