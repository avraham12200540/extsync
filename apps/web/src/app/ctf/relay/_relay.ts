/**
 * Data and validation for the relay step.
 *
 * The fragment terminus points here with a "service" link relation instead of
 * "related" or "alternate": this resource is not read, it is operated on. GET
 * on every stop below is answered honestly with 405 and an accurate Allow
 * header, never with the step's content, and OPTIONS answers with exactly the
 * two things a client needs to plan a request - which method is accepted, and
 * what it must be shaped like.
 *
 * The acknowledgement every POST needs is not a secret: it is this resource's
 * own path segment, echoed back as JSON. That is exactly what a 307 preserves
 * unchanged between the first stop and the second, and exactly what a 303
 * deliberately does not carry forward - the last stop is reached by GET, with
 * nothing left to send.
 */

/** The entry stop's own folder name, and the value every POST must echo back. */
export const RELAY_ID = "a26f0853d45046bf";

/** Where a validated POST is sent, preserving method and body (307). */
export const HOP_ID = "285e26376b3ee6f2";

/** Where a validated, still-preserved POST is sent next, changing to GET (303). */
export const FINAL_ID = "e03ab812d4bd";

/** Handed out only by the final stop's representation. */
export const NEXT_ID = "7d8d6cddb49b49d6";

export const HOP_HREF = `/ctf/relay/${RELAY_ID}/${HOP_ID}`;
export const FINAL_HREF = `${HOP_HREF}/${FINAL_ID}`;

export const CONTENT_TYPE = "application/json";

const ALLOW_STOP = "POST, OPTIONS";

/** Shared by both the entry and the hop stop, which accept the same method. */
export const RELAY_ALLOW_HEADERS = { allow: ALLOW_STOP } as const;

export const RELAY_OPTIONS_HEADERS = {
  allow: ALLOW_STOP,
  "accept-post": CONTENT_TYPE,
} as const;

/** The media type only; parameters (eg. charset) are parsed past, not scored. */
function mediaType(contentType: string | null): string {
  if (!contentType) return "";
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function hasJsonContentType(request: Request): boolean {
  return mediaType(request.headers.get("content-type")) === CONTENT_TYPE;
}

/** What a POST must have sent, unchanged, to proceed - stated so nothing here
 *  depends on a player guessing a field name. */
export function expectedAck(): { entry: string } {
  return { entry: RELAY_ID };
}

/** Consumes the request body: call at most once per request. */
export async function readValidAck(request: Request): Promise<boolean> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return false;
  }
  if (typeof body !== "object" || body === null) return false;
  return (body as Record<string, unknown>).entry === RELAY_ID;
}
