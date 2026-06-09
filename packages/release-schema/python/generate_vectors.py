"""Generate cross-language test vectors for the release-schema canonicalizer.

Emits ../schema/vectors.json with canonical bytes (base64) and a full signed
metadata example using a FIXED dev key, so the TS and .NET tests can assert
byte-for-byte agreement. Run:  python generate_vectors.py
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from extsync_release_schema import (  # noqa: E402
    canonicalize,
    canonical_bytes,
    sign_metadata,
    verify_metadata,
    public_key_b64,
    private_seed_b64,
    rollout_bucket,
)

# Fixed 32-byte seed -> deterministic key for reproducible vectors.
SEED = bytes(range(32))
KEY = Ed25519PrivateKey.from_private_bytes(SEED)
KEY_ID = "test-key-1"

CANON_CASES = [
    {"name": "empty", "input": {}},
    {"name": "scalars", "input": {"b": True, "a": 1, "c": "x", "z": 0}},
    {"name": "nested", "input": {"o": {"y": 2, "x": 1}, "arr": ["b", "a", "c"]}},
    {"name": "unicode", "input": {"name": "תוסף שלום", "v": "1.0"}},
    {"name": "escapes", "input": {"s": "a\"b\\c\nd\te"}},
]

SAMPLE_META = {
    "schema": 1,
    "releaseId": "rel_abc123",
    "projectId": "ext_proj1",
    "extensionId": "abcdefghijklmnopabcdefghijklmnop",
    "version": "1.4.0",
    "channel": "stable",
    "minimumAgentVersion": "1.0.0",
    "artifact": {
        "url": "https://cdn.extsync.dev/artifacts/rel_abc123.zip",
        "size": 123456,
        "sha256": "a" * 64,
    },
    "sequence": 15,
    "rolloutPercentage": 100,
    "permissionsChanged": False,
    "requiresUserApproval": False,
    "publishedAt": "2026-06-08T10:00:00Z",
    "keyId": KEY_ID,
}


def main() -> int:
    # --- self-test the Python impl ---
    signed = sign_metadata(SAMPLE_META, KEY)
    pubs = {KEY_ID: public_key_b64(KEY)}
    assert verify_metadata(signed, pubs), "verify should pass for valid signature"

    tampered = dict(signed)
    tampered["version"] = "9.9.9"
    assert not verify_metadata(tampered, pubs), "verify must fail on tamper"

    assert not verify_metadata(signed, {"other": pubs[KEY_ID]}), "unknown keyId must fail"

    # rollout determinism
    b1 = rollout_bucket("ext_proj1", "dev-xyz")
    b2 = rollout_bucket("ext_proj1", "dev-xyz")
    assert b1 == b2 and 0 <= b1 < 100

    vectors = {
        "seedHex": SEED.hex(),
        "publicKeyB64": public_key_b64(KEY),
        "privateSeedB64": private_seed_b64(KEY),
        "keyId": KEY_ID,
        "canonicalCases": [
            {
                "name": c["name"],
                "input": c["input"],
                "canonical": canonicalize(c["input"]),
                "canonicalBytesB64": base64.b64encode(
                    canonicalize(c["input"]).encode("utf-8")
                ).decode("ascii"),
            }
            for c in CANON_CASES
        ],
        "sampleMetadata": SAMPLE_META,
        "sampleCanonical": canonical_bytes(SAMPLE_META).decode("utf-8"),
        "sampleSigned": signed,
        "rolloutSamples": [
            {"projectId": "ext_proj1", "deviceId": "dev-xyz", "bucket": b1},
            {"projectId": "ext_proj1", "deviceId": "dev-aaa", "bucket": rollout_bucket("ext_proj1", "dev-aaa")},
        ],
    }

    out = HERE.parent / "schema" / "vectors.json"
    out.write_text(json.dumps(vectors, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    print("python self-test OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
