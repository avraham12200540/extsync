"""Application settings, loaded from environment (.env in dev)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    environment: Literal["development", "staging", "production"] = "development"
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
    # When true, a developer must verify their email before publishing to the
    # public store. Keep false until real email delivery is configured.
    enforce_email_verification: bool = False

    # upload / validation limits
    max_upload_zip_bytes: int = 52_428_800
    max_extracted_bytes: int = 209_715_200
    max_file_count: int = 5_000
    max_dir_depth: int = 20
    validation_timeout_seconds: int = 120

    # rate limits
    rate_limit_login_per_min: int = 10
    rate_limit_upload_per_hour: int = 60

    # google oauth
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

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
