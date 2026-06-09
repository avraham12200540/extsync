"""Base schema with camelCase JSON aliases (TS-friendly) + shared response shapes."""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class CamelModel(BaseModel):
    """Serialize to camelCase, accept both camelCase and snake_case on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Page(CamelModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class OkResponse(CamelModel):
    ok: bool = True
