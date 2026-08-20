/**
 * Data for the archive step.
 *
 * The index at /ctf/archive/<id> has two representations of the same resource -
 * a page for a browser and a manifest for anything that asks for data - and one
 * entry, served from a sibling folder named exactly like the entry it holds.
 *
 * The entry's bytes live here as base64 rather than as a file read at request
 * time: the route never touches the filesystem, and the length and digest the
 * manifest advertises are derived from the very same buffer the download hands
 * out, so the two cannot drift apart. Nothing here, and nothing the resource
 * emits, describes what the bytes are - that is the step.
 */

import { createHash } from "node:crypto";

import { ARCHIVE_ID } from "../../receipt/_receipt";

/**
 * Stated by both representations. Not part of this step's answer: it is a
 * handle for a later one, and it costs nothing to start printing it now.
 */
export const GENERATION = 17;

/**
 * The entry's name, which is also the name of the folder that serves it, so a
 * wrong guess under this archive matches no route and gets the site's ordinary
 * 404. Rename one and you must rename the other.
 */
export const ENTRY_NAME = "6f30376e8dddf93d.dat";

export const ENTRY_HREF = `/ctf/archive/${ARCHIVE_ID}/${ENTRY_NAME}`;

export const ENTRY_MEDIA_TYPE = "application/octet-stream";

const ENTRY_BASE64 =
  "UEsDBBQAAAAIAAAAIQCbyTPAJAAAACIAAAAJAAAAZW50cnkudHh0S80rKapUUFBQyM/mKkpN" +
  "zi9KUVBQMDdONEo2NbEwMUy15AIAUEsBAhQAFAAAAAgAAAAhAJvJM8AkAAAAIgAAAAkAAAAA" +
  "AAAAAAAAAAAAAAAAAGVudHJ5LnR4dFBLBQYAAAAAAQABADcAAABLAAAAAAA=";

/** Fixed bytes, decoded once at module load. */
export const ENTRY_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(Buffer.from(ENTRY_BASE64, "base64"));

/** Both derived from ENTRY_BYTES, never written down separately. */
export const ENTRY_LENGTH = ENTRY_BYTES.byteLength;
export const ENTRY_SHA256 = createHash("sha256").update(ENTRY_BYTES).digest("hex");

/**
 * The index's own styling. Kept out of _lib/message.ts on purpose: that file is
 * shared with an earlier step, and adding to it would change the bytes that
 * step already serves.
 */
export const ARCHIVE_CSS = `
.msg__meta {
  margin: clamp(1.5rem, 5vw, 2rem) 0 0;
  font-family: var(--ctf-mono);
  font-size: 0.72rem;
  line-height: 1.95;
  letter-spacing: 0.04em;
  color: var(--ctf-dim);
  text-align: start;
  display: inline-block;
  overflow-x: auto;
  max-width: 100%;
}
`.trim();
