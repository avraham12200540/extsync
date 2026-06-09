# ExtSync Signing service — isolated, not exposed to the public internet.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY packages /app/packages
RUN pip install --upgrade pip \
    && pip install -e "/app/packages/release-schema/python" \
    && pip install -e "/app/apps/api"

COPY apps/api /app/apps/api

ENV PYTHONPATH=/app/apps/api/src:/app/packages

EXPOSE 8090
CMD ["uvicorn", "extsync_signing.main:app", "--host", "0.0.0.0", "--port", "8090"]
