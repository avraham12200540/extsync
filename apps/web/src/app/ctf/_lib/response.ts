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

/**
 * Serve a JSON representation under the same policy as the documents.
 *
 * For a step whose answer is a document in one representation and data in
 * another: same cache and robots policy, so neither form of a step leaks into
 * a cache or an index by virtue of being data instead of a page.
 */
export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}

/**
 * Serve a response with no body, under the same policy as the documents.
 *
 * For a status RFC 9110 says must not carry content (204), and for a redirect
 * whose entire job is the status line and the Location header - a body there
 * would be a second, redundant place to explain the step.
 */
export function emptyResponse(init?: ResponseInit): Response {
  return new Response(null, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}

/**
 * Serve fixed bytes for inline display, under the same policy as the
 * documents.
 *
 * `inline` rather than `attachment`: this resource is meant to be decoded and
 * viewed - by a browser, by `curl -o`, or by an independent tool - not saved
 * through a download prompt. The filename is still stated, and still chosen
 * to say nothing about what the resource contains.
 */
export function imageResponse(
  body: Uint8Array<ArrayBuffer>,
  mediaType: string,
  filename: string,
  init?: ResponseInit,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": mediaType,
      "content-length": String(body.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}

/**
 * Serve a fixed multi-part body under the same policy as the documents.
 *
 * The caller supplies the whole `Content-Type` (media type, boundary, and any
 * `multipart/related` parameters) rather than just a media type string,
 * because those parameters are themselves part of what a correct client has
 * to read - unlike `imageResponse` or `bytesResponse`, there is no single
 * fixed type this could default to.
 */
export function multipartResponse(
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  init?: ResponseInit,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": contentType,
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}

/**
 * Serve fixed bytes as a download.
 *
 * The length is stated rather than left to the runtime so a player can compare
 * what arrived against what was advertised without a chunked transfer getting
 * in the way, and the disposition carries the name the resource is known by, so
 * a browser save and a `curl -O` land on the same file.
 */
export function bytesResponse(
  body: Uint8Array<ArrayBuffer>,
  mediaType: string,
  filename: string,
  init?: ResponseInit,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": mediaType,
      "content-length": String(body.byteLength),
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...init?.headers,
    },
  });
}
