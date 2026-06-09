# ExtSync Worker image (ZIP validation, static analysis, artifact packing)
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Worker reuses the API package (shared models/db) plus its own deps.
COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/worker/pyproject.toml /app/apps/worker/pyproject.toml
COPY packages /app/packages
RUN pip install --upgrade pip \
    && pip install -e "/app/packages/release-schema/python" \
    && pip install -e "/app/apps/api" \
    && pip install -e "/app/apps/worker[dev]"

COPY apps/api /app/apps/api
COPY apps/worker /app/apps/worker

ENV PYTHONPATH=/app/apps/api/src:/app/apps/worker/src:/app/packages

CMD ["python", "-m", "extsync_worker.main"]
