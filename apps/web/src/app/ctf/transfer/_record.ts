/**
 * Data and styling for the transfer step.
 *
 * Kept beside the two routes that use it rather than in `ctf/_lib`, which holds
 * the pieces every step shares. Nothing here is a security boundary: the token
 * reaches the browser by design, and the split below only stops the answer from
 * being the first thing a reader's eye lands on.
 */

/** Shown on the record. Deliberately unrelated to the token: reading the page
 *  must not be enough to guess where the record actually goes. */
export const DISPLAY_ID = "d14ad909";

/**
 * The destination segment under /ctf/transfer/.
 *
 * This is also the name of the folder that serves it, so that a wrong guess
 * matches no route and gets the site's ordinary 404. Rename one and you must
 * rename the other.
 */
export const TOKEN = "e94600f3a4466ba7";

/**
 * The destination, in pieces. Both carriers (the script and the markup
 * fallback) emit these separately and join them at the last moment, so neither
 * the served document nor the served script contains the path as one string.
 */
export const PATH_PARTS: readonly string[] = [
  "/ctf/",
  "transfer/",
  TOKEN.slice(0, 8),
  TOKEN.slice(8),
];

export const RECORD_CSS = `
.rec {
  position: relative;
  width: 100%;
  max-width: 30rem;
  padding: clamp(1.25rem, 5vw, 1.75rem);
  border: 1px solid var(--ctf-line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.012);
  font-family: var(--ctf-mono);
  transition: border-color 160ms ease;
}

.rec:hover {
  border-color: rgba(255, 255, 255, 0.16);
}

.rec__head {
  margin-bottom: clamp(0.9rem, 3vw, 1.1rem);
  padding-bottom: clamp(0.9rem, 3vw, 1.1rem);
  border-bottom: 1px solid var(--ctf-line);
  font-size: 0.7rem;
  letter-spacing: 0.24em;
  color: var(--ctf-dim);
}

.rec__grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.7rem clamp(1rem, 5vw, 2rem);
  margin: 0;
}

.rec__k {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  line-height: 1.9;
  color: var(--ctf-dim);
}

.rec__v {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.9;
  color: var(--ctf-muted);
  overflow-wrap: anywhere;
}

.rec__v--id {
  font-size: 1.02rem;
  letter-spacing: 0.07em;
  color: var(--ctf-fg);
}

/* Visually hidden but still inside the selection, which is the whole point:
   if the script never runs, selecting the record still carries the pieces out.
   aria-hidden keeps it out of the accessibility tree so a screen reader is not
   handed the answer. Sized and clipped so it cannot disturb the layout. */
.rec__x {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  /* pre, not nowrap: it keeps the leading newline of the hidden run, so a
     no-script copy puts the path on its own line instead of gluing it to the
     visible id. Verified in Chrome - a plain space there gets collapsed. */
  white-space: pre;
  clip-path: inset(50%);
}

.done {
  margin: 0;
  font-family: var(--ctf-mono);
  font-size: clamp(1rem, 4.5vw, 1.35rem);
  font-weight: 500;
  letter-spacing: 0.2em;
  color: var(--ctf-fg);
}

.done__line {
  width: min(14rem, 60%);
  height: 1px;
  margin: clamp(1.2rem, 4vw, 1.6rem) auto;
  background: linear-gradient(90deg, transparent, var(--ctf-line) 20%, var(--ctf-line) 80%, transparent);
}

.done__sub {
  margin: 0;
  font-size: clamp(0.9rem, 3.4vw, 1rem);
  color: var(--ctf-dim);
}
`.trim();
