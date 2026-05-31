FROM oven/bun:1.3

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY shims ./shims
COPY src ./src
COPY db ./db
COPY scripts ./scripts

RUN bun install --frozen-lockfile

RUN useradd -r -m takos && chown -R takos:takos /workspace
USER takos

ENV NODE_ENV=production

CMD ["bun", "src/worker/local-platform/unified-entrypoint.ts"]
