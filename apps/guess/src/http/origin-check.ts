/**
 * Same-origin enforcement for the one request a CSRF token genuinely
 * cannot protect: the initial admin login POST. Before any admin session
 * exists there is no admin CSRF secret to check - a "post-login" token
 * cannot defend the request that creates it. This module is the other
 * half of that defense (the first half is the pre-auth nonce: requiring a
 * valid anonymous player session + its existing X-Guess-CSRF header on the
 * login request too - see the login handler, which reuses session.ts's
 * already-battle-tested requireSession/requireCsrf for that).
 *
 * Fails CLOSED: if neither signal is present/parseable, the request is
 * rejected. A legitimate same-origin browser fetch() always sends at least
 * one of these on a cross-site-relevant request; their total absence is
 * far more likely to mean a non-browser/forged request than a browser
 * that simply omitted both.
 */

export class CrossOriginRequestError extends Error {}

export function requireSameOriginRequest(request: Request, expectedOrigin: string): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin !== expectedOrigin) {
      throw new CrossOriginRequestError(`Origin header "${origin}" does not match expected origin`);
    }
    return;
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    if (secFetchSite !== "same-origin") {
      throw new CrossOriginRequestError(`Sec-Fetch-Site header "${secFetchSite}" is not same-origin`);
    }
    return;
  }

  throw new CrossOriginRequestError("neither Origin nor Sec-Fetch-Site header is present - cannot confirm same-origin");
}
