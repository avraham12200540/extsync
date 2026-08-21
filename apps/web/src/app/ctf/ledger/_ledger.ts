/**
 * Data for the constellation's ledger: a domain-separated Merkle tree over 64
 * candidate records, and a proof for exactly one of them.
 *
 * Nothing here names which candidate the proof is for. The tree, the root
 * and the proof are all derived at module load from the 64 record strings
 * and a single index kept private to this file (`WINNER_INDEX`, never
 * exported, never serialized) - so the published root and proof are
 * mathematically tied to the candidates, never a value that could quietly
 * drift out of sync with them.
 *
 * Two orders exist over the same 64 records, and they are deliberately not
 * the same order:
 *
 *  - `TREE_RECORDS` - the order the Merkle tree is actually built from. A
 *    proof's six directions are a leaf's tree-index in binary (bit 0 from
 *    the first entry, most significant bit from the last): decode them and
 *    you learn a *tree position*, nothing else.
 *  - the served `candidates` array - `TREE_RECORDS` read through a fixed
 *    permutation (`PRESENTATION_ORDER`) and given unrelated opaque labels.
 *
 * A first version of this file used the same order for both and labelled
 * candidates `entry-00..entry-63` to match. That let the six proof
 * directions be decoded straight into an array index - `entry-37` - with no
 * hashing at all. Decoupling the two orders removes that: decoding the
 * directions still only yields a tree position, and nothing published maps
 * a tree position back to a served label or array slot. The only way from
 * the ledger to the answer is to hash every served candidate's record,
 * fold it through the proof, and see which one reaches `root` - exactly
 * the six-level, 64-candidate check the puzzle is meant to be.
 *
 * The next stop's id is the first 16 hex characters of the winning
 * candidate's own leaf hash - itself only reachable by finishing that
 * check, not printed anywhere a reader could shortcut to.
 */

import { createHash } from "node:crypto";

const LEAF_PREFIX = Buffer.from([0x00]);
const PARENT_PREFIX = Buffer.from([0x01]);

function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

function leafHash(record: string): Buffer {
  return sha256(Buffer.concat([LEAF_PREFIX, Buffer.from(record, "utf8")]));
}

function parentHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([PARENT_PREFIX, left, right]));
}

/** The route segment the ledger is served from - opaque, says nothing about the answer. */
export const LEDGER_ID = "27ab2e606da1490e";
export const LEDGER_HREF = `/ctf/ledger/${LEDGER_ID}`;

/**
 * 64 candidate records, in tree-build order: uniform 16-character
 * lowercase-hex strings, so no candidate stands out by shape, length or
 * content. This order is never served - see `PRESENTATION_ORDER` below.
 */
const TREE_RECORDS: readonly string[] = [
  "9eb1b85e64be7290",
  "ca3f1a9577893cea",
  "912e3e498f0e41ff",
  "8339b6c03e5c2f96",
  "4c11e78c887ed4d3",
  "139d541b06aef219",
  "6b70749dccd6292e",
  "b6d9395ffeb82118",
  "59366e4bdd4b24be",
  "64751323d8ff87c2",
  "8f2c58115efc4655",
  "c128a62df16f3264",
  "0fc6e314816faa45",
  "39346261230fb8d7",
  "be2ed962dfb0609e",
  "6c34b375ca25ebaf",
  "34e35225a249f44c",
  "843a4c4ff2d873b9",
  "cbc6e55eb2173819",
  "f69ccc077a6bccec",
  "3c5e5dfe004408d6",
  "b9b633819be9e41e",
  "e5fb5755f21838f8",
  "f540eed341caaf15",
  "4540749beef886fa",
  "bd9f8198e6fc89a6",
  "130574d338f79f81",
  "9c5b60ec465b5f1d",
  "efd8087c95d7a824",
  "29775ad30d798091",
  "4e4967e959d73723",
  "a587ce6634dd4d7f",
  "447da0a1becd567a",
  "e677881c3b75c14d",
  "9e64dd6bd20ca88c",
  "8a552db0a66dc777",
  "b67b5d656606c4f3",
  "91257c54287c9da5",
  "3ddcee3c2bc37316",
  "1b353df65c5ff74d",
  "9018e56d62d920d2",
  "7e396541e4fa3571",
  "ceb5d4e42331bf7d",
  "7a1a6b1e308debf3",
  "5327de6b18dbf5d2",
  "c348a58940047475",
  "be72d661a226214b",
  "1428789e70b38cea",
  "17d27f1eb1bbc55f",
  "5a7cc1f2120e1e0b",
  "53ecef225bd431da",
  "5176a09ba1e6fc14",
  "92d4cd51d1075a30",
  "8b2861a456617eb1",
  "9d31d653a09cffeb",
  "a549324b1e87f05a",
  "c1e2ec6ebab70679",
  "bebc2c99534ce52e",
  "cd5ef2a6337e8f8d",
  "b630a139a724d477",
  "efcc302a6436495f",
  "d68045051386c0f4",
  "324ca83e0c28f9e9",
  "3d21a4bbc4beea80",
];

/**
 * A fixed permutation of tree indices: `PRESENTATION_ORDER[i]` is the
 * `TREE_RECORDS` index served at presentation slot `i`. Generated once by a
 * Fisher-Yates shuffle and hardcoded here, so presentation order is stable
 * across requests but has no arithmetic relationship to tree order - in
 * particular the winning tree index (37) lands at presentation slot 3, not
 * 37, so there is no coincidental identity mapping to fall back on either.
 */
const PRESENTATION_ORDER: readonly number[] = [
  49, 13, 26, 37, 6, 23, 10, 51, 38, 3, 33, 58, 20, 53, 31, 29, 35, 48, 34, 40, 15, 21, 8, 59, 45,
  1, 54, 60, 50, 9, 61, 11, 43, 18, 44, 22, 24, 30, 56, 41, 0, 12, 63, 55, 16, 52, 14, 28, 19, 7,
  62, 32, 5, 42, 25, 17, 47, 39, 57, 36, 46, 2, 27, 4,
];

/**
 * Opaque, unique, and independent of both orders - a label is a tag, not a
 * coordinate. Sorting candidates by label recovers presentation order at
 * best (labels are not sequential even in that order), never tree order.
 */
const PRESENTATION_LABELS: readonly string[] = [
  "tag-036e4371", "tag-1a51c730", "tag-f0823cae", "tag-70036c25", "tag-27dcb623", "tag-16c58358",
  "tag-8340d0ee", "tag-70494082", "tag-57779aa0", "tag-032761fd", "tag-08191e81", "tag-fdd10cee",
  "tag-3d3c889d", "tag-ccfb7ac2", "tag-d9b18bac", "tag-b396b6af", "tag-c2289d85", "tag-cfbc750c",
  "tag-829d28d1", "tag-d9d6ac7a", "tag-832da506", "tag-e8f56956", "tag-b784c6a8", "tag-0c9f5e2e",
  "tag-825ae477", "tag-9e553d5a", "tag-20c39286", "tag-41058b32", "tag-8c93fbc3", "tag-00d894f6",
  "tag-78df9c48", "tag-bc9ccb37", "tag-d770a946", "tag-6b7f748d", "tag-8792ca9e", "tag-0616713b",
  "tag-c49b638a", "tag-5bc75620", "tag-c3e69770", "tag-e910b35e", "tag-21f80eb5", "tag-0f951658",
  "tag-930e9bbc", "tag-2954cc1e", "tag-3f8ee88c", "tag-3484c034", "tag-31985536", "tag-ad5ccbba",
  "tag-34110f0a", "tag-094ed059", "tag-f837a0e5", "tag-bca6de74", "tag-d35c82dd", "tag-e2f1bd76",
  "tag-6a6eded7", "tag-357ddcf1", "tag-367893fa", "tag-256b41a5", "tag-2a55ad82", "tag-d8e8cb08",
  "tag-503034d6", "tag-b7efa217", "tag-51d96189", "tag-d8cd1e89",
];

/** Kept private: which TREE_RECORDS candidate the published proof actually proves. */
const WINNER_INDEX = 37;

const leaves: readonly Buffer[] = TREE_RECORDS.map(leafHash);

/** Every level of the tree, leaves first, root last (a single-element level). */
const levels: Buffer[][] = [leaves as Buffer[]];
{
  let level = levels[0];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(parentHash(level[i], level[i + 1]));
    }
    levels.push(next);
    level = next;
  }
}

export const MERKLE_ROOT_HEX = levels[levels.length - 1][0].toString("hex");

interface ProofEntry {
  hash: string;
  direction: "left" | "right";
}

/** The sibling path from WINNER_INDEX's leaf up to the root, level by level. */
const PROOF: readonly ProofEntry[] = (() => {
  const entries: ProofEntry[] = [];
  let idx = WINNER_INDEX;
  for (let level = 0; level < levels.length - 1; level++) {
    const layer = levels[level];
    const isLeft = idx % 2 === 0;
    const siblingIndex = isLeft ? idx + 1 : idx - 1;
    entries.push({ hash: layer[siblingIndex].toString("hex"), direction: isLeft ? "left" : "right" });
    idx = Math.floor(idx / 2);
  }
  return entries;
})();

/** First 16 hex characters of the winning candidate's own leaf hash. */
export const MERIDIAN_ID = leaves[WINNER_INDEX].toString("hex").slice(0, 16);
export const MERIDIAN_HREF = `/ctf/meridian/${MERIDIAN_ID}`;

export const LEDGER_BODY = {
  algorithm: {
    leaf: "SHA-256(0x00 || UTF-8 bytes of the candidate's record string)",
    parent: "SHA-256(0x01 || left child hash (32 bytes) || right child hash (32 bytes))",
    hashEncoding: "lowercase hexadecimal, no 0x prefix, in every field below",
    candidateOrder:
      "The order candidates are listed in below is a fixed presentation order, " +
      "not the order the underlying tree was built from. There is no shortcut " +
      "from position, label or record content to which candidate the proof is " +
      "for: apply the proof independently to each candidate's own leaf hash.",
    proofApplication:
      "Start from the leaf hash of one candidate's record. Apply the entries in " +
      "\"proof\" in array order, index 0 first. At each entry, \"direction\" " +
      "describes where the CURRENT accumulated hash goes, not the sibling: if " +
      "direction is \"left\", parent = SHA-256(0x01 || current || entry.hash); if " +
      "direction is \"right\", parent = SHA-256(0x01 || entry.hash || current). " +
      "After the last entry, the accumulated hash equals \"root\" for exactly " +
      "one of the 64 candidates.",
    nextRoute:
      "/ctf/meridian/ followed by the first 16 lowercase hex characters of the " +
      "matching candidate's own leaf hash (not the root, and not any proof entry).",
  },
  candidates: PRESENTATION_ORDER.map((treeIndex, slot) => ({
    label: PRESENTATION_LABELS[slot],
    record: TREE_RECORDS[treeIndex],
  })),
  root: MERKLE_ROOT_HEX,
  proof: PROOF,
};
