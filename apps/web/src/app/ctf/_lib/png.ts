/**
 * Minimal PNG chunk assembly (ISO/IEC 15948, "PNG (Portable Network
 * Graphics) Specification"), enough to build a small, standards-valid image
 * carrying ancillary text chunks.
 *
 * Every chunk here is length-prefixed and CRC-checked exactly as the format
 * requires, so a wrong-order or truncated read is a genuine parse failure,
 * not a step-specific refusal.
 *
 * The CRC-32 below is a plain, hand-rolled implementation of the same
 * IEEE 802.3 (reflected, poly 0xEDB88320) algorithm the PNG spec requires -
 * deliberately not `node:zlib`'s `crc32` export. That export only exists from
 * Node 20.12 onward, while this app's declared floor (`apps/web/package.json`
 * `engines.node`, ">=20.9") and the actual Node line the deployed `web`
 * container runs are two different things: no Dockerfile for a production
 * `web` service exists in this repository to pin the latter against (the
 * committed `docker-compose.prod.yml` has no `web` service at all, and the
 * one `infrastructure/docker/web.Dockerfile` present is explicitly labelled
 * "dev image"). Rather than assume a runtime this file can't verify, the
 * table-based algorithm below runs identically on any Node (or other JS
 * runtime) this route ever ships on. `deflateSync`, used for the compressed
 * text chunks, is unaffected - it has been in `node:zlib` since 0.x.
 */

import { deflateSync } from "node:zlib";

/** Standard CRC-32 (IEEE 802.3) lookup table, built once at module load. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC-32 of `data`, per RFC 1952 Annex 8 / the PNG spec's own appendix.
 * Verified against the standard test vector: crc32("123456789") = 0xcbf43926.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function u32be(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * Copies every part into one fresh buffer. Always allocates its own
 * `ArrayBuffer` (never `SharedArrayBuffer`), which is also why this is used
 * even for a single Node `Buffer`: it normalizes away Node's wider
 * `ArrayBufferLike` typing so every chunk this module returns has one
 * consistent, concrete buffer type.
 */
function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One length-prefixed, CRC-checked chunk: length + type + data + CRC-32(type‖data). */
export function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typeBytes = Buffer.from(type, "ascii");
  const body = concat([typeBytes, data]);
  return concat([u32be(data.length), body, u32be(crc32(body))]);
}

/** The file signature followed by every chunk, in the order given. */
export function assemblePng(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  return concat([PNG_SIGNATURE, ...chunks]);
}

/** IHDR for an 8-bit grayscale image (color type 0), no interlace. */
export function grayscaleIhdr(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8; // bit depth
  data[9] = 0; // color type: grayscale
  data[10] = 0; // compression method: deflate (the only defined one)
  data[11] = 0; // filter method: adaptive (the only defined one)
  data[12] = 0; // interlace method: none
  return chunk("IHDR", data);
}

/**
 * IDAT for a flat-gray image: every scanline uses filter type 0 (None) and
 * the same sample, so the decoded pixels carry no information - the puzzle
 * lives in the ancillary chunks, not in what the image looks like.
 */
export function flatGrayscaleIdat(width: number, height: number, gray: number): Uint8Array<ArrayBuffer> {
  const stride = width + 1; // one filter-type byte per scanline
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type: None
    raw.fill(gray, rowStart + 1, rowStart + stride);
  }
  return chunk("IDAT", deflateSync(raw));
}

export function iend(): Uint8Array<ArrayBuffer> {
  return chunk("IEND", new Uint8Array(0));
}

/** tEXt: keyword, NUL, Latin-1 text - uncompressed. */
export function textChunk(keyword: string, text: string): Uint8Array<ArrayBuffer> {
  const data = concat([
    Buffer.from(keyword, "latin1"),
    Uint8Array.of(0),
    Buffer.from(text, "latin1"),
  ]);
  return chunk("tEXt", data);
}

/** zTXt: keyword, NUL, compression method (0 = deflate), zlib-compressed Latin-1 text. */
export function compressedTextChunk(keyword: string, text: string): Uint8Array<ArrayBuffer> {
  const data = concat([
    Buffer.from(keyword, "latin1"),
    Uint8Array.of(0, 0),
    deflateSync(Buffer.from(text, "latin1")),
  ]);
  return chunk("zTXt", data);
}

/**
 * iTXt: keyword, NUL, compression flag, compression method, language tag,
 * NUL, translated keyword, NUL, UTF-8 text (optionally zlib-compressed).
 * Language tag and translated keyword are both allowed to be empty.
 */
export function internationalTextChunk(
  keyword: string,
  text: string,
  options?: { compressed?: boolean; language?: string; translatedKeyword?: string },
): Uint8Array<ArrayBuffer> {
  const compressed = options?.compressed ?? false;
  const textBytes = Buffer.from(text, "utf8");
  const data = concat([
    Buffer.from(keyword, "latin1"),
    Uint8Array.of(0),
    Uint8Array.of(compressed ? 1 : 0),
    Uint8Array.of(0), // compression method: 0 = deflate (only meaningful when the flag is set)
    Buffer.from(options?.language ?? "", "ascii"),
    Uint8Array.of(0),
    Buffer.from(options?.translatedKeyword ?? "", "utf8"),
    Uint8Array.of(0),
    compressed ? deflateSync(textBytes) : textBytes,
  ]);
  return chunk("iTXt", data);
}
