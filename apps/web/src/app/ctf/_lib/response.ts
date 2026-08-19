/**
 * Response helpers shared by every /ctf route handler.
 *
 * The site-wide security headers (nosniff, HSTS, frame-deny, Referrer-Policy)
 * and the per-request nonce CSP already apply here: they come from
 * `next.config.mjs` -> `headers()` and from `src/proxy.ts`, both of which match
 * every document route. Nothing in this file overrides them.
 */

import { renderDocument, type CtfDocumentInput } from "./document";

/** Serve a rendered CTF document. */
export function htmlResponse(doc: CtfDocumentInput, init?: ResponseInit): Response {
  return new Response(renderDocument(doc), {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Keep the puzzle surface identical for everyone: an edited stage must
      // never be served from a stale intermediary or back/forward cache.
      "cache-control": "no-store",
      // Belt and braces with the <meta name="robots"> in the document itself.
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}
