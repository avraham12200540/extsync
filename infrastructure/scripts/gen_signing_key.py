#!/usr/bin/env python3
"""יצירת מפתח Ed25519 לפיתוח עבור שירות החתימה של ExtSync.

מייצר:
  - infrastructure/docker/dev-signing-key.pem  (PKCS8 private key — ב-.gitignore)
  - מדפיס את שורת SIGNING_PUBLIC_KEYS שצריך להעתיק ל-.env

לעולם אל תשתמש במפתח הזה בפרודקשן. בפרודקשן המפתח הפרטי נוצר ונשמר בלבד
בשירות החתימה / KMS, מחוץ ל-DB ומחוץ ל-repo. ראו docs/security/signing.md.
"""
from __future__ import annotations

import base64
import datetime as dt
import os
import sys
from pathlib import Path

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
except ImportError:
    sys.stderr.write(
        "חסרה הספרייה 'cryptography'. התקינו:  pip install cryptography\n"
    )
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parents[2]
KEY_PATH = REPO_ROOT / "infrastructure" / "docker" / "dev-signing-key.pem"


def main() -> int:
    key_id = os.environ.get("SIGNING_ACTIVE_KEY_ID", "key-2026-01")

    if KEY_PATH.exists():
        sys.stderr.write(
            f"כבר קיים מפתח ב-{KEY_PATH}. מחקו אותו ידנית אם ברצונכם ליצור חדש.\n"
        )
        # עדיין נדפיס את ה-public key מהמפתח הקיים כדי שיהיה שימושי.
        private_key = serialization.load_pem_private_key(
            KEY_PATH.read_bytes(), password=None
        )
    else:
        private_key = Ed25519PrivateKey.generate()
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        KEY_PATH.write_bytes(pem)
        # הרשאות מצומצמות ככל האפשר (לא קריטי בפיתוח על Windows).
        try:
            os.chmod(KEY_PATH, 0o600)
        except OSError:
            pass
        sys.stderr.write(f"נוצר מפתח פרטי לפיתוח: {KEY_PATH}\n")

    public_key = private_key.public_key()  # type: ignore[union-attr]
    raw_pub = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    b64_pub = base64.b64encode(raw_pub).decode("ascii")

    generated = dt.datetime.now(dt.timezone.utc).isoformat()
    sys.stderr.write(f"# נוצר ב-{generated}\n")
    print("\n# העתיקו לקובץ .env:")
    print(f"SIGNING_ACTIVE_KEY_ID={key_id}")
    print(f"SIGNING_PUBLIC_KEYS={key_id}:{b64_pub}")
    print()
    print("# הטמיעו את אותו public key ב-Agent (apps/agent-windows) ובבדיקות.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
