// "Install with ExtSync" embed badge — a branded SVG developers put on their own
// site / GitHub README, wrapped in an <a> to their install link. Generic brand
// mark (no per-extension data fetch, so it is cheap + highly cacheable). The
// [slug] segment gives each extension a clean URL and room to grow later.
//   <a href="https://extsync.com/install/TOKEN">
//     <img src="https://extsync.com/badge/my-extension.svg" alt="Install with ExtSync">
//   </a>
// Use ?lang=he for the Hebrew (RTL) badge; English is the default (READMEs).

const PUZZLE =
  "M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1";
const FONT = "'Segoe UI', system-ui, -apple-system, Arial, sans-serif";

function badgeSvg(lang: "he" | "en"): string {
  const W = 142;
  const H = 52;
  const label = lang === "he" ? "התקן עם" : "Install with";
  const aria = lang === "he" ? "התקן עם ExtSync" : "Install with ExtSync";
  const icon = (x: number) =>
    `<g transform="translate(${x},14)" fill="none" stroke="#2B7DE9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PUZZLE}"/></g>`;

  const text = (x: number, anchor: "start" | "end") =>
    `<text x="${x}" y="23" text-anchor="${anchor}" font-family="${FONT}" font-size="11" fill="#9FB6D4">${label}</text>` +
    `<text x="${x}" y="41" text-anchor="${anchor}" font-family="${FONT}" font-size="17" font-weight="700" fill="#FFFFFF">ExtSync</text>`;

  const body =
    lang === "he"
      ? icon(W - 38) + text(W - 48, "end")
      : icon(14) + text(48, "start");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">` +
    `<rect width="${W}" height="${H}" rx="10" fill="#10243E"/>` +
    body +
    `</svg>`
  );
}

export function GET(request: Request): Response {
  const lang = new URL(request.url).searchParams.get("lang") === "he" ? "he" : "en";
  return new Response(badgeSvg(lang), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Generic brand mark: cache hard at the edge + in the embedding page.
      "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
}
