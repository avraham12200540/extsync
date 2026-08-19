/**
 * HTML shell for the CTF area.
 *
 * Every CTF document is assembled here as a complete, self-contained HTML
 * string and returned by a route handler - deliberately NOT as a React page
 * under the site's root layout. Two structural reasons:
 *
 *  1. Isolation. Nothing under /ctf imports `globals.css`, the root layout, the
 *     locale providers or the marketing font, so a CTF page cannot restyle or
 *     break extsync.com, and a change to the marketing site cannot silently
 *     change a puzzle.
 *  2. Exact bytes. A CTF is played against what `view-source:` shows, not
 *     against the hydrated DOM. Building the markup here guarantees the served
 *     document is byte-for-byte what a player reads.
 */

export interface CtfDocumentInput {
  /** <title> text. Escaped. */
  title: string;
  /** BCP-47 language of the document text. */
  lang?: string;
  /** Base direction of the document. */
  dir?: "rtl" | "ltr";
  /** Page-specific CSS, appended after the shared CTF stylesheet. */
  css?: string;
  /** Extra trusted <head> markup (per-stage <meta>, <link>, ...). */
  head?: string;
  /** Trusted body markup. */
  body: string;
  /**
   * Raw HTML comments emitted verbatim just before </body>. These are part of a
   * stage's payload: they must survive into the response body itself so they
   * show up in `view-source:` (and in `curl`), not only in the live DOM.
   */
  comments?: readonly string[];
}

/** Escape text destined for markup or an attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap a payload in an HTML comment.
 *
 * The payload is never escaped (escaping would corrupt it), so it is validated
 * instead: a comment may not contain "--", may not start with ">" or "->" and
 * may not end with "-", or the parser would close it early and swallow the rest
 * of the document. Payloads are compile-time constants, so a bad one fails
 * loudly the first time the route is hit locally.
 */
export function htmlComment(payload: string): string {
  const invalid =
    payload.includes("--") ||
    payload.startsWith(">") ||
    payload.startsWith("->") ||
    payload.endsWith("-");
  if (invalid) {
    throw new Error(`Unsafe HTML comment payload: ${JSON.stringify(payload)}`);
  }
  return `<!-- ${payload} -->`;
}

/**
 * Render a full CTF document.
 *
 * `noindex,nofollow` is emitted on every CTF page (and mirrored as an
 * X-Robots-Tag header in `_lib/response.ts`): the trail is meant to be walked,
 * not searched for. The site-wide robots.txt is intentionally left untouched,
 * since listing /ctf there would advertise it instead of hiding it.
 */
export function renderDocument(doc: CtfDocumentInput): string {
  const lines: Array<string | undefined> = [
    "<!doctype html>",
    `<html lang="${escapeHtml(doc.lang ?? "he")}" dir="${doc.dir ?? "rtl"}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    '<meta name="color-scheme" content="dark">',
    `<title>${escapeHtml(doc.title)}</title>`,
    doc.head,
    doc.css ? `<style>${doc.css}</style>` : undefined,
    "</head>",
    "<body>",
    doc.body,
    ...(doc.comments ?? []).map(htmlComment),
    "</body>",
    "</html>",
  ];

  return `${lines.filter((line): line is string => Boolean(line)).join("\n")}\n`;
}
