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

/**
 * Serve a small plain-text body under the same policy as the documents.
 *
 * For steps whose payload is the response itself rather than a page: a status
 * line, a short record, a refusal. Same cache and robots policy as
 * `htmlResponse`, so a step never leaks into a cache or an index by being
 * text instead of HTML.
 */
export function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}
