FROM oven/bun:1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY dist ./dist

# oven/bun is Debian-based: use groupadd/useradd (Alpine addgroup/adduser absent).
RUN groupadd -r takos && useradd -r -g takos -d /app takos && \
    chown -R takos:takos /app
USER takos

ENV PORT=8080
ENV CF_CONTAINER=true

EXPOSE 8080

CMD ["bun", "dist/index.js"]
