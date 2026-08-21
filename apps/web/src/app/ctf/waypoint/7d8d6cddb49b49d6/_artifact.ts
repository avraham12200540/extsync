/**
 * Data for the waypoint's alternate representation.
 *
 * The waypoint's HTML said nothing beyond it was built; what it actually
 * lacked was a second representation. That representation is a PNG whose
 * pixels are deliberately flat - a single gray value, nothing to read from
 * them - because the step lives in three ancillary text chunks instead:
 *
 *  - `Fragment-1`, a plain tEXt chunk.
 *  - `Fragment-2`, a zTXt chunk - standards-compressed, so it only yields
 *    its text to a reader that actually inflates it.
 *  - `Fragment-3`, an iTXt chunk, uncompressed for variety.
 *
 * The keyword numbers state the join order explicitly; the chunks are not
 * written to the file in that order, so reading top to bottom is not enough.
 * Concatenated low key to high, the three spell the next stop.
 *
 * The bytes are assembled once at module load, from the same builder every
 * chunk in this file uses, so the file that is served is always internally
 * consistent (every length and every CRC is derived from its own chunk's
 * data, never copied in separately).
 */

import {
  assemblePng,
  compressedTextChunk,
  flatGrayscaleIdat,
  grayscaleIhdr,
  iend,
  internationalTextChunk,
  textChunk,
} from "../../_lib/png";

/** The route segment this representation is served from, and its own filename. */
export const ARTIFACT_NAME = "39dfe4411fb9bee2.png";
export const ARTIFACT_HREF = `/ctf/waypoint/7d8d6cddb49b49d6/${ARTIFACT_NAME}`;

const WIDTH = 24;
const HEIGHT = 24;
const GRAY = 0x6e;

/** Read together, low key to high: "/ctf/beacon/" + "4f6c" + "8a219e7d" + "3b50". */
const FRAGMENT_1 = "/ctf/beacon/4f6c";
const FRAGMENT_2 = "8a219e7d";
const FRAGMENT_3 = "3b50";

const HINT = "Fragment-1..3 recorded. Join low key to high. One entry is stored compressed.";

export const PNG_BYTES: Uint8Array<ArrayBuffer> = assemblePng([
  grayscaleIhdr(WIDTH, HEIGHT),
  textChunk("Comment", HINT),
  internationalTextChunk("Fragment-3", FRAGMENT_3),
  flatGrayscaleIdat(WIDTH, HEIGHT, GRAY),
  compressedTextChunk("Fragment-2", FRAGMENT_2),
  textChunk("Fragment-1", FRAGMENT_1),
  iend(),
]);
