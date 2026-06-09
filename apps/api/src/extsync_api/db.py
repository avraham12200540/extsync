"""Async database engine/session and the declarative Base."""
from __future__ import annotations

import datetime as dt
from collections.abc import AsyncIterator

from sqlalchemy import DateTime, types
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class UtcDateTime(types.TypeDecorator):
    """Timezone-aware datetime that always reads/writes UTC.

    Postgres timestamptz already returns aware datetimes, but SQLite returns
    naive ones. This decorator normalizes both so comparisons with
    timezone-aware `datetime.now(UTC)` never raise. Stored as DateTime(timezone=True).
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)

    def process_result_value(self, value, dialect):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.timezone.utc)
        return value.astimezone(dt.timezone.utc)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    # Map every `Mapped[datetime]` column to the UTC-aware type above.
    type_annotation_map = {dt.datetime: UtcDateTime}


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_pre_ping=True,
            future=True,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


def configure_engine(engine: AsyncEngine) -> None:
    """Override the engine/sessionmaker (used by tests with SQLite)."""
    global _engine, _sessionmaker
    _engine = engine
    _sessionmaker = async_sessionmaker(
        bind=engine, expire_on_commit=False, autoflush=False
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yields a session, commits on success, rolls back on error."""
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
