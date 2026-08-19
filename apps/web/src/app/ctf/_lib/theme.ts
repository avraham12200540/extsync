/**
 * The CTF look: dark, quiet, technical.
 *
 * Shipped as a plain CSS string inlined into each document rather than as an
 * imported stylesheet, so the CTF carries no dependency on `globals.css`,
 * Tailwind or the site's font pipeline. Inline <style> is allowed by the site
 * CSP (`style-src 'self' 'unsafe-inline'`); inline <script> is not, and the CTF
 * entry point needs no JavaScript at all.
 *
 * Constraints kept on purpose: text stays selectable, contrast stays above
 * WCAG AA on the near-black background, motion is a single short fade that
 * `prefers-reduced-motion` switches off, and there is nothing here that fights
 * the browser.
 */

/**
 * Static film-grain tile (SVG feTurbulence, no runtime cost after decode).
 * Data URIs are permitted by the site CSP for images (`img-src 'self' data:`).
 */
const NOISE_TILE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E" +
  "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E" +
  "%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E";

export const CTF_BASE_CSS = `
:root {
  --ctf-bg: #06070a;
  --ctf-fg: #eef1f6;
  --ctf-muted: #9aa3b2;
  --ctf-dim: #79818f;
  --ctf-line: rgba(255, 255, 255, 0.10);
  --ctf-accent: #79c9bb;
  --ctf-sans: "Segoe UI", system-ui, -apple-system, "Noto Sans Hebrew", Arial, sans-serif;
  --ctf-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}

*, *::before, *::after { box-sizing: border-box; }

html { height: 100%; }

body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--ctf-bg);
  /* Barely-there halo behind the content: painted by the viewport rather than
     by an oversized child, so it can never widen the document on small
     screens (an absolutely positioned glow did exactly that). */
  background-image: radial-gradient(
    ellipse 46rem 26rem at 50% 45%,
    rgba(121, 201, 187, 0.055),
    rgba(121, 201, 187, 0) 70%
  );
  background-repeat: no-repeat;
  background-attachment: fixed;
  color: var(--ctf-fg);
  font-family: var(--ctf-sans);
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-wrap: break-word;
}

/* Faint grid, faded out towards the edges so it reads as texture, not as a UI. */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 72px 72px;
  -webkit-mask-image: radial-gradient(ellipse 92% 72% at 50% 44%, #000 12%, transparent 76%);
  mask-image: radial-gradient(ellipse 92% 72% at 50% 44%, #000 12%, transparent 76%);
}

/* Very light grain: kills the banding of the flat background. */
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("${NOISE_TILE}");
  background-size: 180px 180px;
}

::selection {
  background: rgba(121, 201, 187, 0.30);
  color: #ffffff;
}

.ctf-view {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(1.5rem, 6vw, 4rem);
}

@keyframes ctf-rise {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: none; }
}

@keyframes ctf-blink {
  0%, 46% { opacity: 0.85; }
  54%, 100% { opacity: 0.08; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
`.trim();
