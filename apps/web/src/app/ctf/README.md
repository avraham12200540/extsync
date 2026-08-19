# /ctf - the ExtSync CTF area

A self-contained puzzle trail living under `extsync.com/ctf`. It shares the
Next.js app (and therefore the existing deploy) with the marketing site, and
nothing else.

## Why route handlers instead of pages

Every document here is built as an HTML string by `_lib/document.ts` and served
from a `route.ts`. That buys two things a React page under the root layout
cannot:

- **Isolation.** No `globals.css`, no root layout, no locale providers, no
  `next/font`. A CTF page cannot restyle extsync.com and extsync.com cannot
  restyle a puzzle. Nothing outside this folder was modified to add the area.
- **Exact bytes.** Steps are played against `view-source:` and `curl`, so the
  served markup has to be authored, not hydrated. Planted payloads go through
  `comments` in `CtfDocumentInput`, which lands them in the response body
  itself - never via client-side DOM insertion, which `view-source:` would not
  show.

## Layout

```
ctf/
  route.ts        GET /ctf          entry point
  _lib/
    document.ts   HTML shell, escaping, comment planting
    response.ts   Response + headers (no-store, X-Robots-Tag)
    theme.ts      shared dark CSS (tokens, background, motion prefs)
```

`_lib` is underscore-prefixed, so the App Router treats it as private and never
routes to it. Room to grow, same pattern, no new plumbing:

```
ctf/stage/[id]/route.ts     ctf/api/.../route.ts     ctf/files/.../route.ts
```

## House rules for new steps

1. **One breadcrumb per step.** A step that also explains itself is not a step.
   No console output, no "decode this", no second copy of the answer.
2. **Playable, not adversarial.** Text stays selectable, right-click works,
   DevTools stay open, no anti-debugging, no forced fullscreen, no autoplay.
   Contrast stays at AA; motion respects `prefers-reduced-motion`.
3. **Puzzles only, no real vulnerabilities.** Anything that looks like a hole
   must be a self-contained prop inside `/ctf`: no command execution, no
   uploads, no filesystem or database reach, no real secrets, no auth bypass.
4. **Isolation stays absolute.** Do not touch `globals.css`, the root layout,
   `next.config.mjs`, `proxy.ts`, `robots.ts`, `sitemap.ts`, the Caddyfile or
   the compose files for CTF reasons.
5. **Keep it out of the index.** `renderDocument` emits
   `noindex,nofollow` and `htmlResponse` mirrors it as `X-Robots-Tag`. Do not
   list `/ctf` in `robots.ts` or `sitemap.ts` - that advertises it.
6. **The repo is public.** `github.com/avraham12200540/extsync` is public, so
   anything committed here is readable ahead of time. Payloads meant to be
   discovered in the page (like the entry one) are fine; a value that must stay
   unknown until a player earns it does not belong in this repo - pass it in
   via an env var, or keep the step's data server-side in the private ops repo.
7. **External hops are read-only.** Steps may point at forum posts the founder
   wrote and can edit. Nothing in this trail probes, tests or attacks any
   third-party site.

## Local run

```bash
cd apps/web && npm run dev     # http://localhost:3000/ctf
```

Verify a step the way it is played:

```bash
curl -s http://localhost:3000/ctf | less
```

## Deploy

Same path as the rest of the site: the `web` container on the prod droplet
(`docker compose ... build web && up -d web`). No infrastructure change is
needed for `/ctf`; Caddy already forwards everything on `extsync.com` that is
not `/neve/*` or `/sb-relay/*` to `web:3000`.
