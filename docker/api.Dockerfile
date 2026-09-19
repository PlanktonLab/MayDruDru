# Build context is the repo root: the uv workspace lockfile lives there.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /usr/local/bin/uv
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv PATH=/opt/venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 --user-group app

# Dependencies first so a code change does not re-resolve the environment.
# Only the manifests are needed; --no-install-workspace keeps our own packages out.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/renderer/pyproject.toml apps/renderer/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package maydru-api

# code stays root-owned and read-only for the runtime user; secrets come from the environment
# (.env, .venv and caches are excluded by api.Dockerfile.dockerignore)
COPY apps/api/ /app/
USER app
ENV HOME=/home/app
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
