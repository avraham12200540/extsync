"""Password hashing with Argon2id (§20)."""
from __future__ import annotations

from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc
from argon2.low_level import Type

from ..config import settings

_hasher = PasswordHasher(
    time_cost=settings.argon2_time_cost,
    memory_cost=settings.argon2_memory_cost_kib,
    parallelism=settings.argon2_parallelism,
    type=Type.ID,  # Argon2id
)

# Basic password policy (the frontend enforces the same via Zod).
MIN_PASSWORD_LEN = 10
MAX_PASSWORD_LEN = 256


class WeakPasswordError(ValueError):
    pass


def validate_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise WeakPasswordError("הסיסמה חייבת לכלול לפחות 10 תווים")
    if len(password) > MAX_PASSWORD_LEN:
        raise WeakPasswordError("הסיסמה ארוכה מדי")
    classes = sum(
        [
            any(c.islower() for c in password),
            any(c.isupper() for c in password),
            any(c.isdigit() for c in password),
            any(not c.isalnum() for c in password),
        ]
    )
    if classes < 2:
        raise WeakPasswordError("הסיסמה חייבת לשלב לפחות שני סוגי תווים")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHashError, argon2_exc.VerificationError):
        return False


def needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except argon2_exc.InvalidHashError:
        return True
