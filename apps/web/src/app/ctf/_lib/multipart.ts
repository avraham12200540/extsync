/**
 * Minimal RFC 2046 multipart body assembly and RFC 2045 quoted-printable
 * encoding, enough to build a standards-valid `multipart/related` HTTP
 * response (RFC 2387) whose parts are addressed by Content-ID rather than by
 * position.
 *
 * `Content-Encoding` on an individual part is not itself an RFC 2045 field -
 * that header belongs to HTTP (RFC 9110 SS8.4), not to core MIME - but nothing
 * in RFC 2046's `MIME-part-headers` grammar forbids an extension field, and
 * using it per-part to say "this part's bytes are additionally gzipped" is a
 * common, unambiguous convention in HTTP-transported multipart bodies. It is
 * kept separate from `Content-Transfer-Encoding`, which is the genuine MIME
 * field for how a part's octets survived the trip (7bit, binary,
 * quoted-printable, ...): a part can need both, decoded in that order.
 */

import { Buffer } from "node:buffer";

const CRLF = "\r\n";

function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, "ascii"));
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export interface MultipartPart {
  headers: ReadonlyArray<readonly [string, string]>;
  body: Uint8Array;
}

/**
 * Assemble a full multipart body: for every part, `--boundary` + CRLF,
 * its header fields (each CRLF-terminated), a blank line, then its raw body
 * bytes, closed by a final `--boundary--` + CRLF.
 *
 * Throws if the boundary string turns up inside any part's own header bytes
 * or body bytes: that would let a part's own content be misread as a
 * delimiter by a compliant parser, silently truncating the message - a
 * build-time failure here is the same "fail loudly" stance `_lib/document.ts`
 * already takes for a comment payload that would break out of its own HTML
 * comment.
 */
export function assembleMultipart(
  boundary: string,
  parts: readonly MultipartPart[],
): Uint8Array<ArrayBuffer> {
  const boundaryBytes = asciiBytes(boundary);
  const pieces: Uint8Array[] = [];

  for (const part of parts) {
    const headerText = part.headers.map(([name, value]) => `${name}: ${value}${CRLF}`).join("");
    const headerBytes = asciiBytes(headerText);
    if (containsBytes(headerBytes, boundaryBytes) || containsBytes(part.body, boundaryBytes)) {
      throw new Error(`Boundary "${boundary}" collides with a part's own bytes`);
    }
    pieces.push(asciiBytes(`--${boundary}${CRLF}`), headerBytes, asciiBytes(CRLF), part.body, asciiBytes(CRLF));
  }

  pieces.push(asciiBytes(`--${boundary}--${CRLF}`));
  return concat(pieces);
}

/**
 * RFC 2045 SS6.7 quoted-printable encoding. Rule 1 there permits any octet to
 * be represented as "=" followed by two hex digits, even one that would
 * otherwise print literally - `forceAll` takes that option for every byte,
 * for a fragment that must not be legible without actually decoding it.
 * Uppercase hex digits, per the same rule.
 */
export function quotedPrintableEncode(bytes: Uint8Array, options?: { forceAll?: boolean }): string {
  let out = "";
  for (const b of bytes) {
    const printable = b >= 0x21 && b <= 0x7e && b !== 0x3d; // literal-safe range, '=' always escaped
    out += !options?.forceAll && printable ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return asciiBytes(text);
}
