"""Application settings, loaded from environment (.env in dev)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Dev-only secret defaults that must never reach production (fail-closed check).
_DEV_SECRET_DEFAULTS = {
    "jwt_secret": "dev-insecure-change-me",
    "signing_internal_token": "dev-internal-token",
    "csrf_secret": "dev-insecure-csrf-change-me",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    environment: Literal["development", "staging", "production"] = "development"
    # Interactive API docs (/docs, /redoc, /openapi.json). Off in production by
    # default to reduce reconnaissance; set true to force-enable.
    enable_api_docs: bool = False
    log_level: str = "info"
    public_web_url: str = "http://localhost:3000"
    public_api_url: str = "http://localhost:8000"

    # database
    database_url: str = "postgresql+asyncpg://extsync:extsync_dev_password@localhost:5432/extsync"
    database_url_sync: str = "postgresql+psycopg://extsync:extsync_dev_password@localhost:5432/extsync"
    db_echo: bool = False

    # redis
    redis_url: str = "redis://localhost:6379/0"

    # object storage
    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_access_key: str = "extsync_minio"
    s3_secret_key: str = "extsync_minio_password"
    s3_bucket_uploads: str = "extsync-uploads"
    s3_bucket_artifacts: str = "extsync-artifacts"
    s3_force_path_style: bool = True

    # auth / sessions
    jwt_secret: str = "dev-insecure-change-me"
    jwt_access_ttl_seconds: int = 900
    jwt_refresh_ttl_seconds: int = 2_592_000
    session_cookie_name: str = "extsync_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    csrf_secret: str = "dev-insecure-csrf-change-me"
    # Dedicated key for encryption-at-rest (TOTP secrets, project keys, webhook
    # secrets). Empty -> derive from jwt_secret (legacy behavior). Set a separate
    # value ONLY together with re-encrypting existing ciphertext, or stored
    # secrets become undecryptable.
    encryption_key: str = ""

    argon2_time_cost: int = 3
    argon2_memory_cost_kib: int = 65_536
    argon2_parallelism: int = 4

    # signing service
    signing_service_url: str = "http://localhost:8090"
    signing_internal_token: str = "dev-internal-token"
    signing_active_key_id: str = "key-2026-01"
    signing_private_key_path: str = ""
    # "keyId:base64,keyId2:base64" — public keys the platform advertises/verifies.
    signing_public_keys: str = ""

    # email
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    email_from: str = "ExtSync <no-reply@extsync.local>"
    # If set, send via the Resend HTTPS API (port 443) instead of SMTP — robust
    # against VPS providers that block outbound SMTP ports (25/465/587).
    resend_api_key: str = ""
    # When true, a developer must verify their email before publishing to the
    # public store. Keep false until real email delivery is configured.
    enforce_email_verification: bool = False

    # upload / validation limits
    max_upload_zip_bytes: int = 52_428_800
    max_extracted_bytes: int = 209_715_200
    max_file_count: int = 5_000
    max_dir_depth: int = 20
    validation_timeout_seconds: int = 120

    # rate limits (anti-abuse; generous defaults, tunable via env)
    rate_limit_login_per_min: int = 10
    rate_limit_upload_per_hour: int = 60
    rate_limit_register_per_hour: int = 50        # per IP — lets many people sign up
    rate_limit_resend_verify_per_hour: int = 20   # per user — only caps resend spam
    rate_limit_2fa_per_5min: int = 10             # per IP + per challenge — anti TOTP brute force
    rate_limit_agent_register_per_hour: int = 60  # per IP — anonymous agent device registration
    rate_limit_install_resolve_per_min: int = 60  # per IP — public install-page resolve

    # observability (optional) — error tracking is off unless a DSN is set.
    sentry_dsn: str = ""

    # google oauth
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # likes quota (mitmachim.top daily likes meter, synced across machines)
    likes_quota_daily_limit: int = 20
    likes_quota_per_user_limit: int = 6
    likes_quota_timezone: str = "Asia/Jerusalem"  # daily reset uses this tz, not the client clock
    # Forum-login identity: the meter verifies the user's mitmachim.top (NodeBB)
    # session server-side by calling {base}/api/self with the forwarded session
    # cookie, so the forum uid is confirmed by NodeBB and never trusted from the
    # client. This lets any forum user sync with no ExtSync token.
    likes_quota_forum_base_url: str = "https://mitmachim.top"
    likes_quota_forum_verify: bool = True
    likes_quota_forum_cache_ttl: int = 120  # seconds to cache a verified cookie->uid mapping
    # The mitmachim like limit is a moving window, not a midnight reset: a like
    # frees up this many seconds after it was given. Tunable if the window differs.
    likes_quota_window_seconds: int = 86400  # 24h
    # DEV ONLY: when true (and not production) the meter accepts an
    # `X-Dev-Quota-User` header instead of a real auth token, so the extension can
    # be tested without a full login. Forced off in production by the principal guard.
    likes_quota_dev_auth: bool = False

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def insecure_production_defaults(self) -> list[str]:
        """In production, return the names of secrets still set to a dev default.

        Checked at startup (see main.lifespan) so a misconfigured prod boot fails
        closed instead of silently shipping a publicly-known secret from the repo.
        """
        if not self.is_production:
            return []
        return [
            name
            for name, dev_value in _DEV_SECRET_DEFAULTS.items()
            if getattr(self, name) == dev_value
        ]

    def public_keys_map(self) -> dict[str, str]:
        """Parse SIGNING_PUBLIC_KEYS into {keyId: base64}."""
        out: dict[str, str] = {}
        for entry in self.signing_public_keys.split(","):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            key_id, b64 = entry.split(":", 1)
            out[key_id.strip()] = b64.strip()
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
