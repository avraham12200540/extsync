/**
 * Data for the beacon's enclosure: a `multipart/related` package (RFC 2387)
 * whose root part is a JSON manifest, and whose data is reached only by
 * following the manifest's `cid:` references (RFC 2392) - not by reading the
 * parts in the order they happen to arrive in.
 *
 * Five parts are on the wire, in this physical order: a data fragment, the
 * root manifest, a decoy, a second data fragment, a third data fragment.
 * That order is deliberate and is not the assembly order: the top-level
 * `Content-Type`'s `start` parameter is what actually names the root
 * (Content-ID `<ROOT_CID>`), and the manifest's own `assembly` array is what
 * states the join order and how each entry got encoded. A reader that just
 * concatenates parts in wire order, or assumes the first part is the root,
 * gets neither the right root nor the right string.
 *
 * Every data fragment carries a `Content-Transfer-Encoding` - how its octets
 * survived the trip - and, for one of them, a `Content-Encoding` on top of
 * that - a second, independent transformation of what those octets mean once
 * transfer-decoded. The manifest states both explicitly per entry, along
 * with a SHA-256 of the final decoded bytes, so nothing here has to be
 * guessed: decode is prescribed, only carrying it out is the step.
 *
 * The decoy part is not a fourth candidate: its Content-ID is not in the
 * manifest's `assembly` array at all, and its own decoded text says so, so a
 * reader who does open it (rather than skip it, which the manifest alone
 * already justifies) is told plainly that it does not belong.
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { assembleMultipart, quotedPrintableEncode, textBytes, type MultipartPart } from "../_lib/multipart";

/** The route segment this package is served from - opaque, says nothing about the answer. */
export const PACKAGE_ID = "2e954a825644f9ff";
export const PACKAGE_HREF = `/ctf/package/${PACKAGE_ID}`;

const BOUNDARY = "33cea4d00dd96fb6";

const ROOT_CID = "root@ctf.extsync.internal";
const FRAGMENT_A_CID = "frag-a@ctf.extsync.internal";
const FRAGMENT_B_CID = "frag-b@ctf.extsync.internal";
const FRAGMENT_C_CID = "frag-c@ctf.extsync.internal";
const DECOY_CID = "decoy@ctf.extsync.internal";

/** Read together, in this order: "/ctf/constellation/b71f02c984d63ae5". */
const FRAGMENT_A_TEXT = "/ctf/constel";
const FRAGMENT_B_TEXT = "lation/b71f0";
const FRAGMENT_C_TEXT = "2c984d63ae5";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const fragmentABytes = textBytes(FRAGMENT_A_TEXT);
const fragmentBBytes = textBytes(FRAGMENT_B_TEXT);
const fragmentCBytes = textBytes(FRAGMENT_C_TEXT);

/** The manifest states, per entry, exactly how to arrive at these digests. */
const FRAGMENT_A_SHA256 = sha256Hex(fragmentABytes);
const FRAGMENT_B_SHA256 = sha256Hex(fragmentBBytes);
const FRAGMENT_C_SHA256 = sha256Hex(fragmentCBytes);

const MANIFEST = {
  assembly: [
    {
      cid: `cid:${FRAGMENT_A_CID}`,
      transferEncoding: "7bit",
      contentEncoding: "identity",
      sha256: FRAGMENT_A_SHA256,
    },
    {
      cid: `cid:${FRAGMENT_B_CID}`,
      transferEncoding: "binary",
      contentEncoding: "gzip",
      sha256: FRAGMENT_B_SHA256,
    },
    {
      cid: `cid:${FRAGMENT_C_CID}`,
      transferEncoding: "quoted-printable",
      contentEncoding: "identity",
      sha256: FRAGMENT_C_SHA256,
    },
  ],
};

const rootPart: MultipartPart = {
  headers: [
    ["Content-Type", "application/json"],
    ["Content-ID", `<${ROOT_CID}>`],
    ["Content-Transfer-Encoding", "7bit"],
  ],
  body: textBytes(`${JSON.stringify(MANIFEST, null, 2)}\n`),
};

/** Plain: no Content-Encoding, 7bit transfer - the un-transformed baseline. */
const fragmentAPart: MultipartPart = {
  headers: [
    ["Content-Type", "text/plain"],
    ["Content-ID", `<${FRAGMENT_A_CID}>`],
    ["Content-Transfer-Encoding", "7bit"],
  ],
  body: fragmentABytes,
};

/** Gzipped, then carried as raw octets: decode is "gunzip", nothing else. */
const fragmentBPart: MultipartPart = {
  headers: [
    ["Content-Type", "text/plain"],
    ["Content-ID", `<${FRAGMENT_B_CID}>`],
    ["Content-Transfer-Encoding", "binary"],
    ["Content-Encoding", "gzip"],
  ],
  body: gzipSync(fragmentBBytes),
};

/**
 * Quoted-printable, every byte hex-escaped rather than left literal (RFC
 * 2045 SS6.7 rule 1 allows this for any octet) - so this fragment cannot be
 * read by eye without actually decoding it, the way the other two partly can.
 */
const fragmentCPart: MultipartPart = {
  headers: [
    ["Content-Type", "text/plain"],
    ["Content-ID", `<${FRAGMENT_C_CID}>`],
    ["Content-Transfer-Encoding", "quoted-printable"],
  ],
  body: textBytes(quotedPrintableEncode(fragmentCBytes, { forceAll: true })),
};

const decoyPart: MultipartPart = {
  headers: [
    ["Content-Type", "text/plain"],
    ["Content-ID", `<${DECOY_CID}>`],
    ["Content-Transfer-Encoding", "7bit"],
  ],
  body: textBytes("This part is not referenced by the manifest's assembly array. Skip it.\n"),
};

/** Wire order: deliberately not the manifest order, and the root is not first. */
export const PACKAGE_BYTES: Uint8Array<ArrayBuffer> = assembleMultipart(BOUNDARY, [
  fragmentCPart,
  rootPart,
  decoyPart,
  fragmentBPart,
  fragmentAPart,
]);

export const CONTENT_TYPE = `multipart/related; boundary="${BOUNDARY}"; type="application/json"; start="<${ROOT_CID}>"`;
