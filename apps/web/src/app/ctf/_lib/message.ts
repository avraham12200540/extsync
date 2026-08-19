/**
 * Styling for the CTF's short message documents: a line of system output and
 * nothing else. Kept apart from `theme.ts` so that adding a message page never
 * changes a byte of what an existing step serves.
 */

export const MESSAGE_CSS = `
.msg {
  width: 100%;
  max-width: 32rem;
  text-align: center;
}

.msg__title {
  margin: 0;
  font-family: var(--ctf-mono);
  font-size: clamp(1rem, 4.5vw, 1.35rem);
  font-weight: 500;
  letter-spacing: 0.2em;
  color: var(--ctf-fg);
}

.msg__line {
  width: min(14rem, 60%);
  height: 1px;
  margin: clamp(1.2rem, 4vw, 1.6rem) auto;
  background: linear-gradient(90deg, transparent, var(--ctf-line) 20%, var(--ctf-line) 80%, transparent);
}

.msg__sub {
  margin: 0;
  font-size: clamp(0.9rem, 3.4vw, 1rem);
  color: var(--ctf-muted);
}

/* A second line reads as a footnote to the first. Still on --ctf-dim rather
   than something fainter: everything here stays above AA on the background. */
.msg__sub + .msg__sub {
  margin-top: 0.55rem;
  color: var(--ctf-dim);
}
`.trim();
