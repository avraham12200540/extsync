"""Moving a release's bytes between PRIVATE staging and PUBLIC distribution.

The store has two artifact locations and the difference is an actual storage
boundary, not a flag:

    s3_bucket_pending    private. Validated builds waiting for moderation.
                         Not anonymously readable even with the exact object key.
    s3_bucket_artifacts  public (anonymous download). ONLY artifacts an
                         administrator has approved for distribution.

Publication therefore has a physical meaning: an approved release has a row in
`release_artifacts` pointing at the public bucket, and an unapproved one simply
does not - so there is no public URL to leak, guess, or forget to filter. This
is what makes the moderation guarantee hold even if some endpoint forgets to
check `review_status`.

Legacy note: releases published before moderation existed already have their
`validated` artifact sitting in the public bucket. `public_artifact` finds those
too (it selects on bucket, not on `kind`), which is exactly the grandfathering
behaviour we want - they stay live until an administrator decides otherwise.
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..logging import get_logger
from ..models.release import Release, ReleaseArtifact
from ..storage import storage

logger = get_logger("extsync.artifact_publication")

# `kind` of the row created when an approved artifact is copied into the public
# bucket. The private staged row keeps kind="validated".
PUBLIC_KIND = "public"


async def public_artifact(db: AsyncSession, release_id: str) -> ReleaseArtifact | None:
    """The artifact that is actually publicly downloadable, or None.

    Selects on the BUCKET rather than on `kind`, so it covers both the modern
    approved copy and legacy releases whose validated artifact was written
    straight into the public bucket before moderation existed.
    """
    return await db.scalar(
        select(ReleaseArtifact).where(
            ReleaseArtifact.release_id == release_id,
            ReleaseArtifact.s3_bucket == settings.s3_bucket_artifacts,
        )
    )


async def staged_artifact(db: AsyncSession, release_id: str) -> ReleaseArtifact | None:
    """The private, validated-but-unapproved artifact, or None."""
    return await db.scalar(
        select(ReleaseArtifact).where(
            ReleaseArtifact.release_id == release_id,
            ReleaseArtifact.s3_bucket == settings.s3_bucket_pending,
        )
    )


def public_download_url(artifact: ReleaseArtifact) -> str:
    """The address an approved artifact is served from - ALWAYS the public bucket.

    Deliberately ignores where the row currently points. The object key is the
    same in both buckets, so this URL is stable across the private->public move
    and can be minted (and SIGNED) before approval without ever being a working
    link: until an administrator approves, nothing exists at that address.

    That is the second layer of the guarantee. The first is that the API refuses
    to hand out this URL for an unapproved release; this one means that even if
    the first layer is bypassed - a leaked link, a forgotten filter, a signed
    blob someone kept - the bytes are simply not there.
    """
    return storage.public_url(settings.s3_bucket_artifacts, artifact.s3_key)


async def distribution_artifact(db: AsyncSession, release_id: str) -> ReleaseArtifact | None:
    """The artifact row describing this release's build, wherever it lives now.

    Public copy first, private staging second. Use this for SIZE and SHA256 (the
    bytes are identical in both places) - and use public_download_url() for the
    address. Do NOT use this to decide whether something is downloadable; that is
    public_artifact().
    """
    return (
        await public_artifact(db, release_id)
        or await staged_artifact(db, release_id)
    )


async def publish_artifact_public(db: AsyncSession, release: Release) -> ReleaseArtifact | None:
    """Copy the approved build from private staging into public storage.

    Idempotent: if the release already has a public artifact (re-approval, or a
    legacy release that was always public) the existing row is returned and
    nothing is copied.

    Returns None only when there is nothing to publish - which should not happen
    for a validated release, and is logged loudly because it would mean an
    approval produced no downloadable file.
    """
    existing = await public_artifact(db, release.id)
    if existing is not None:
        return existing

    staged = await staged_artifact(db, release.id)
    if staged is None:
        logger.error(
            "approve: release %s has no staged artifact to publish", release.id
        )
        return None

    # Same key in the public bucket - the Agent's URL shape is unchanged.
    await asyncio.to_thread(
        storage.copy, staged.s3_bucket, staged.s3_key,
        settings.s3_bucket_artifacts, staged.s3_key,
    )
    published = ReleaseArtifact(
        release_id=release.id,
        kind=PUBLIC_KIND,
        s3_bucket=settings.s3_bucket_artifacts,
        s3_key=staged.s3_key,
        size=staged.size,
        sha256=staged.sha256,
        content_type=staged.content_type,
        file_count=staged.file_count,
    )
    db.add(published)
    logger.info("approve: published artifact for release %s", release.id)
    return published


async def withdraw_artifact_public(db: AsyncSession, release: Release) -> bool:
    """Remove a release's bytes from public storage (reject / unpublish).

    This is what makes an administrator's decision real rather than cosmetic: a
    withdrawn release stops being downloadable even by someone who already knows
    the URL. The private staged copy is deliberately kept, so an administrator
    can still inspect what was submitted and a later approval can re-publish it.

    Returns True if something was actually removed.
    """
    pub = await public_artifact(db, release.id)
    if pub is None:
        return False

    # Make sure we can still inspect/re-publish later: if this release only ever
    # existed in the public bucket (a legacy release), copy it into private
    # staging before deleting the public object, so the bytes are not lost.
    if await staged_artifact(db, release.id) is None:
        try:
            await asyncio.to_thread(
                storage.copy, pub.s3_bucket, pub.s3_key,
                settings.s3_bucket_pending, pub.s3_key,
            )
            db.add(ReleaseArtifact(
                release_id=release.id, kind="validated",
                s3_bucket=settings.s3_bucket_pending, s3_key=pub.s3_key,
                size=pub.size, sha256=pub.sha256,
                content_type=pub.content_type, file_count=pub.file_count,
            ))
        except Exception:  # noqa: BLE001 - never block a takedown on an archive copy
            logger.warning(
                "withdraw: could not archive release %s before removing it from "
                "public storage; proceeding with the takedown", release.id,
                exc_info=True,
            )

    try:
        await asyncio.to_thread(storage.delete, pub.s3_bucket, pub.s3_key)
    except Exception:  # noqa: BLE001
        # The DB row is still removed below, so nothing will serve this URL from
        # the app. Log it so the object can be swept later.
        logger.error(
            "withdraw: failed to delete public object %s/%s for release %s",
            pub.s3_bucket, pub.s3_key, release.id, exc_info=True,
        )
    await db.delete(pub)
    logger.info("withdraw: removed public artifact for release %s", release.id)
    return True
