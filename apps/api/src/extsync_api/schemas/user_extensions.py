"""Schemas for the user's extension library (/me/extensions)."""
from __future__ import annotations

from pydantic import Field

from .common import CamelModel


class LibraryAddRequest(CamelModel):
    """Add a store extension to the caller's library (by store slug)."""

    slug: str = Field(min_length=1, max_length=120)


class LibraryItem(CamelModel):
    project_id: str
    slug: str
    name: str
    icon_url: str | None = None
    developer_name: str = ""
    # False when the extension is no longer publicly installable (unpublished /
    # made private / deleted); such items are excluded from batch installs.
    available: bool = True


class InstallBatchResponse(CamelModel):
    """The extsync:// URI the site opens to hand the queue to the Agent."""

    uri: str
    count: int


class InstallBatchResolveRequest(CamelModel):
    token: str = Field(min_length=1, max_length=2000)


class InstallBatchItem(CamelModel):
    project_id: str
    name: str
    # Public install-link token; the Agent feeds it to its existing
    # resolve + register-extension flow, one item at a time.
    token: str


class InstallBatchResolveResponse(CamelModel):
    items: list[InstallBatchItem]
