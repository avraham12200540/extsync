# ExtSync API image
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps: libpq for psycopg, build tools for argon2-cffi wheels fallback
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Install the API package (editable so the bind-mount in compose picks up edits)
COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY packages /app/packages
RUN pip install --upgrade pip \
    && pip install -e "/app/packages/release-schema/python" \
    && pip install -e "/app/apps/api[dev]"

COPY apps/api /app/apps/api

# Alembic config + migrations live inside the API package (apps/api/alembic.ini)
WORKDIR /app/apps/api
ENV PYTHONPATH=/app/apps/api/src:/app/packages

EXPOSE 8000
CMD ["uvicorn", "extsync_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
