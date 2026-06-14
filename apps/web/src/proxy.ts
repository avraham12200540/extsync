// Per-request nonce-based Content-Security-Policy (Next 16 proxy, formerly
// middleware). A fresh nonce is generated per request, advertised to the app via
// the `x-nonce` request header (read in server components), and embedded in the
// CSP. Next.js reads the CSP from the request header to nonce its own bootstrap
// scripts; `strict-dynamic` lets those nonced scripts load the chunk graph.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());

  // Note: 'unsafe-inline' for style-src is deliberate - Next/Tailwind inject
  // inline <style>, and style injection is far lower risk than script. Scripts
  // are locked to the per-request nonce (no 'unsafe-inline').
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self' https://api.extsync.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads this request header to apply the nonce to its injected scripts.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Run on documents only; skip static assets, images and metadata files.
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|webp|gif|svg|ico|js|css|map)).*)",
    },
  ],
};
