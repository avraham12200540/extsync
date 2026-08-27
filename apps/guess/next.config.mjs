// Isolated Next.js app served under the /guess path prefix. `basePath` makes
// Next.js automatically prefix every route AND every /_next/* static asset
// with /guess - no manual rewrite/proxy logic is required for that part.
// Stage 1 note: this app is not deployed. There is no Caddy rule pointing at
// it yet; the Docker/Caddy wiring is a separate, approval-gated stage.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  basePath: "/guess",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
