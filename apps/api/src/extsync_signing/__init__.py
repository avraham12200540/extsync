"""ExtSync isolated signing service (§26).

Runs on a separate, internal-only network address. Holds the Ed25519 private key
(loaded from a file/secret, never the app DB), accepts ONLY well-formed release
metadata (never arbitrary user files), requires an internal token, and logs every
signature.
"""

__version__ = "0.1.0"
