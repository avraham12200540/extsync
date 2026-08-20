/**
 * Proactive content negotiation for the CTF's negotiated resources.
 *
 * Written out rather than pattern-matched on the raw header: a step that turns
 * on `Accept` has to behave the way the field is actually defined, or the
 * player is debugging our parser instead of reading RFC 9110. So media ranges,
 * wildcards, quality values, `q=0` as an explicit refusal, and the specificity
 * rule that lets the trailing wildcard in a browser's list lose to an exact
 * match all work here.
 *
 * Deliberately not implemented: media-type parameters as part of the match
 * (`text/html;level=1`). Nothing under /ctf offers a parameterised type, so
 * those parameters are parsed past and ignored rather than scored.
 */

interface MediaRange {
  type: string;
  subtype: string;
  /** 0..1; 0 means "explicitly not acceptable". */
  q: number;
}

/** How narrowly a range names a type: exact 2, subtype wildcard 1, any 0. */
function specificity(range: MediaRange): number {
  if (range.type === "*") return 0;
  return range.subtype === "*" ? 1 : 2;
}

function matches(range: MediaRange, type: string, subtype: string): boolean {
  if (range.type !== "*" && range.type !== type) return false;
  return range.subtype === "*" || range.subtype === subtype;
}

/** Parse a q-value; anything unparseable is treated as the default, 1. */
function parseQ(raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function parseAccept(header: string): MediaRange[] {
  const ranges: MediaRange[] = [];

  for (const entry of header.split(",")) {
    const parts = entry.split(";");
    const name = (parts.shift() ?? "").trim().toLowerCase();
    const slash = name.indexOf("/");
    // No "/" is not a media range at all; skip it instead of guessing.
    if (slash <= 0 || slash === name.length - 1) continue;

    let q = 1;
    for (const parameter of parts) {
      const equals = parameter.indexOf("=");
      if (equals < 0) continue;
      if (parameter.slice(0, equals).trim().toLowerCase() !== "q") continue;
      q = parseQ(parameter.slice(equals + 1).trim());
      // Everything after q is an accept-ext, which we do not score.
      break;
    }

    ranges.push({ type: name.slice(0, slash), subtype: name.slice(slash + 1), q });
  }

  return ranges;
}

/**
 * Pick a representation.
 *
 * `offers` is in server preference order, which settles ties - so a request
 * that wants both equally (a full wildcard, or no Accept at all) gets the
 * first offer, the same as a browser would. Returns null when nothing on offer is
 * acceptable, which is the caller's cue to answer 406.
 */
export function selectRepresentation(
  header: string | null,
  offers: readonly string[],
): string | null {
  // A missing or empty field means no preference: RFC 9110 says treat it as
  // a full wildcard, not as a refusal.
  const ranges = header === null ? [] : parseAccept(header);
  if (ranges.length === 0) return offers[0] ?? null;

  let best: string | null = null;
  let bestQ = 0;

  for (const offer of offers) {
    const slash = offer.indexOf("/");
    const type = offer.slice(0, slash);
    const subtype = offer.slice(slash + 1);

    // The most specific range that covers this offer decides its quality; a
    // narrower range always wins over a wider one regardless of q.
    let chosen: MediaRange | null = null;
    for (const range of ranges) {
      if (!matches(range, type, subtype)) continue;
      if (chosen === null || specificity(range) > specificity(chosen)) chosen = range;
    }

    if (chosen === null || chosen.q === 0) continue;
    if (chosen.q > bestQ) {
      best = offer;
      bestQ = chosen.q;
    }
  }

  return best;
}
