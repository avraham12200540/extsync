/**
 * Single-range `Range: bytes=...` parsing and resolution (RFC 9110 SS14.1-14.4).
 *
 * Deliberately scoped to exactly one range per request: a header naming more
 * than one range-spec is treated the same as no header at all, so the caller
 * falls back to its ordinary response instead of answering with
 * `multipart/byteranges`, which nothing under /ctf ever offers. RFC 9110 also
 * says a Range header field with invalid syntax - wrong unit, non-numeric,
 * a last-byte-pos before first-byte-pos - must be ignored rather than
 * rejected, so those cases resolve the same way as a missing header: "absent".
 *
 * "unsatisfiable" is reserved for a syntactically valid range whose first
 * position is beyond the end of the representation, which is the one case
 * RFC 9110 says to answer with 416 instead of falling back.
 */

export type RangeResolution =
  | { kind: "absent" }
  | { kind: "unsatisfiable" }
  | { kind: "satisfiable"; start: number; end: number };

const SUFFIX_RANGE = /^-(\d+)$/;
const EXPLICIT_RANGE = /^(\d+)-(\d*)$/;

export function resolveByteRange(header: string | null, totalLength: number): RangeResolution {
  if (header === null) return { kind: "absent" };

  const equals = header.indexOf("=");
  if (equals < 0) return { kind: "absent" };

  const unit = header.slice(0, equals).trim().toLowerCase();
  if (unit !== "bytes") return { kind: "absent" };

  const rangeSet = header.slice(equals + 1).trim();
  // More than one range-spec: multi-range is unsupported, so treat exactly
  // like an absent header rather than partially honouring the first one.
  if (rangeSet.includes(",")) return { kind: "absent" };

  const suffix = SUFFIX_RANGE.exec(rangeSet);
  if (suffix) {
    const suffixLength = Number.parseInt(suffix[1], 10);
    // A suffix-length of 0 selects no content, which RFC 9110 treats as
    // unsatisfiable rather than as an empty-but-valid range.
    const length = Math.min(suffixLength, totalLength);
    if (length <= 0) return { kind: "unsatisfiable" };
    return { kind: "satisfiable", start: totalLength - length, end: totalLength - 1 };
  }

  const explicit = EXPLICIT_RANGE.exec(rangeSet);
  if (explicit) {
    const first = Number.parseInt(explicit[1], 10);
    const lastRaw = explicit[2];
    const last = lastRaw === "" ? undefined : Number.parseInt(lastRaw, 10);
    // A last-byte-pos before first-byte-pos is invalid syntax, not an
    // out-of-bounds request - ignore it like any other malformed header.
    if (last !== undefined && last < first) return { kind: "absent" };
    if (first >= totalLength) return { kind: "unsatisfiable" };
    const end = last === undefined ? totalLength - 1 : Math.min(last, totalLength - 1);
    return { kind: "satisfiable", start: first, end };
  }

  return { kind: "absent" };
}
