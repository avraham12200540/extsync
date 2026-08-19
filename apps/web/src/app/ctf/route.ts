/**
 * GET /ctf - the entry point of the ExtSync CTF.
 *
 * A route handler, not a page: it returns a complete standalone HTML document
 * (see `_lib/document.ts`), which keeps the CTF fully isolated from the
 * marketing site and, crucially, puts the served markup under our control -
 * what `view-source:` shows here is exactly what this file produces, with no
 * hydration step in between.
 *
 * Routing note: extsync.com/ctf/ is answered by Next's standard trailing-slash
 * redirect (308 -> /ctf), so both spellings work. No Caddy, compose or
 * next.config change is involved; everything the site already does at
 * extsync.com/* keeps working untouched.
 */

import { htmlResponse } from "./_lib/response";
import { CTF_BASE_CSS } from "./_lib/theme";

/**
 * The single payload planted in this document.
 *
 * Nothing else on the page acknowledges it: no visible copy, no console output,
 * no script that reads or transforms it. Noticing that the page is holding
 * something back, and then looking, is the whole of the first step - so resist
 * adding a second breadcrumb here.
 */
const ENTRY_PAYLOAD = "OTczNjUvNA==";

const ENTRY_CSS = `
.ctf-panel {
  position: relative;
  width: 100%;
  max-width: 44rem;
  text-align: center;
}

.ctf-title {
  margin: 0;
  font-size: clamp(2.1rem, 8.5vw, 4.1rem);
  font-weight: 600;
  line-height: 1.06;
  letter-spacing: 0.004em;
  color: var(--ctf-fg);
}

@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .ctf-title {
    background-image: linear-gradient(180deg, #ffffff 6%, #aab4c4 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}

.ctf-rule {
  position: relative;
  height: 1px;
  width: min(20rem, 64%);
  margin: clamp(1.4rem, 4vw, 2.1rem) auto;
  background: linear-gradient(90deg, transparent, var(--ctf-line) 20%, var(--ctf-line) 80%, transparent);
}

.ctf-rule::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: var(--ctf-accent);
  opacity: 0.5;
  box-shadow: 0 0 10px rgba(121, 201, 187, 0.5);
}

.ctf-lead {
  margin: 0;
  font-size: clamp(1rem, 3.6vw, 1.16rem);
  color: var(--ctf-muted);
  text-wrap: balance;
}

.ctf-tail {
  margin: 0.85rem 0 0;
  font-size: clamp(0.92rem, 3.2vw, 1rem);
  color: var(--ctf-dim);
}

.ctf-caret {
  display: inline-block;
  width: 0.45em;
  height: 0.95em;
  margin-inline-start: 0.4em;
  vertical-align: -0.12em;
  border-radius: 1px;
  background: var(--ctf-accent);
  animation: ctf-blink 1.6s ease-in-out infinite;
}

.ctf-title,
.ctf-rule,
.ctf-lead,
.ctf-tail {
  animation: ctf-rise 0.75s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.ctf-title { animation-delay: 0.04s; }
.ctf-rule { animation-delay: 0.16s; }
.ctf-lead { animation-delay: 0.26s; }
.ctf-tail { animation-delay: 0.38s; }
`.trim();

const ENTRY_BODY = `
<main class="ctf-view">
  <div class="ctf-panel">
    <h1 class="ctf-title" dir="ltr">ExtSync CTF</h1>
    <div class="ctf-rule" aria-hidden="true"></div>
    <p class="ctf-lead">יש דברים שלא מופיעים על המסך.</p>
    <p class="ctf-tail">בהצלחה.<span class="ctf-caret" aria-hidden="true"></span></p>
  </div>
</main>
`.trim();

export function GET(): Response {
  return htmlResponse({
    title: "ExtSync CTF",
    lang: "he",
    dir: "rtl",
    css: `${CTF_BASE_CSS}\n\n${ENTRY_CSS}`,
    body: ENTRY_BODY,
    comments: [ENTRY_PAYLOAD],
  });
}
