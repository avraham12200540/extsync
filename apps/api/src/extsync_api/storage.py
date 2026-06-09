"""S3-compatible object storage (MinIO in dev; R2/S3 in prod)."""
from __future__ import annotations

import datetime as dt
from functools import lru_cache
from typing import Any

from .config import settings


@lru_cache
def _client() -> Any:
    import boto3  # lazy import so the app boots without boto3 in minimal envs
    from botocore.config import Config

    cfg = Config(
        signature_version="s3v4",
        s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
        retries={"max_attempts": 3, "mode": "standard"},
    )
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=cfg,
    )


@lru_cache
def _public_client() -> Any:
    """Client bound to the browser/agent-reachable endpoint for presigned URLs."""
    import boto3
    from botocore.config import Config

    cfg = Config(
        signature_version="s3v4",
        s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
    )
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_public_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=cfg,
    )


class Storage:
    """Thin wrapper around the S3 client with the operations ExtSync needs."""

    def presign_put(self, bucket: str, key: str, *, content_type: str = "application/zip",
                    expires: int = 900) -> str:
        return _public_client().generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires,
        )

    def presign_get(self, bucket: str, key: str, *, expires: int = 3600) -> str:
        return _public_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
        )

    def put_bytes(self, bucket: str, key: str, data: bytes,
                  content_type: str = "application/octet-stream") -> None:
        _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)

    def get_bytes(self, bucket: str, key: str) -> bytes:
        resp = _client().get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()

    def delete(self, bucket: str, key: str) -> None:
        _client().delete_object(Bucket=bucket, Key=key)

    def head(self, bucket: str, key: str) -> dict:
        return _client().head_object(Bucket=bucket, Key=key)

    def exists(self, bucket: str, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            _client().head_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False

    def copy(self, bucket: str, src_key: str, dst_bucket: str, dst_key: str) -> None:
        _client().copy_object(
            Bucket=dst_bucket,
            Key=dst_key,
            CopySource={"Bucket": bucket, "Key": src_key},
        )

    def public_url(self, bucket: str, key: str) -> str:
        """Stable, non-expiring URL for a public artifact (artifacts bucket is
        download-public). In production this is typically a CDN domain."""
        base = settings.s3_public_endpoint_url.rstrip("/")
        if settings.s3_force_path_style:
            return f"{base}/{bucket}/{key}"
        # virtual-hosted style
        scheme, _, host = base.partition("://")
        return f"{scheme}://{bucket}.{host}/{key}"

    def health_check(self) -> bool:
        # head_bucket is the cheapest liveness probe.
        _client().head_bucket(Bucket=settings.s3_bucket_artifacts)
        return True


storage = Storage()


def artifact_key(project_id: str, release_id: str) -> str:
    return f"{project_id}/{release_id}/extension.zip"


def upload_key(project_id: str, upload_id: str) -> str:
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
    return f"uploads/{project_id}/{ts}/{upload_id}.zip"
