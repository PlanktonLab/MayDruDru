# Build context is the repo root.
# playwright must match the browsers baked into the base image, so this one image
# installs from apps/renderer/requirements.txt rather than the workspace lockfile.
FROM mcr.microsoft.com/playwright/python:v1.63.0-noble
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# CJK fonts baked into the image: replicas and step cards never load fonts from the network
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/* && fc-cache -f
COPY apps/renderer/requirements.txt .
RUN pip install -r requirements.txt
COPY apps/renderer/main.py apps/renderer/extract_js.py ./
# browsers live in /ms-playwright (world-readable); run as the image's unprivileged user
USER pwuser
EXPOSE 8100
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
