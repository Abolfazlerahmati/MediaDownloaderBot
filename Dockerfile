# syntax=docker/dockerfile:1
# MediaDownloaderBot container image.
# NOTE: this image was NOT built or run in the authoring sandbox (no Docker daemon available).
# Build and smoke-test it on your host with: docker compose build && docker compose run --rm app check
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg is required for stream copy, validation and metadata embedding.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 mediabot \
 && useradd --system --uid 10001 --gid mediabot --home-dir /app --shell /usr/sbin/nologin mediabot

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-compile -r requirements.txt

COPY pyproject.toml README.md ./
COPY mediabot ./mediabot
RUN pip install --no-compile --no-deps . && rm -rf /root/.cache

RUN mkdir -p /data && chown -R mediabot:mediabot /data
ENV DATA_DIR=/data \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=8080 \
    RESTART_SUPERVISED=true
EXPOSE 8080
USER mediabot

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/login', timeout=4)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "python", "-m", "mediabot"]
CMD ["run"]
