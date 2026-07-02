FROM oven/bun:1.3

WORKDIR /workspace/takos

COPY takos/package.json takos/bun.lock takos/bunfig.toml takos/tsconfig.json ./
COPY takos/src ./src
COPY takos/db ./db
COPY takosumi /workspace/takosumi

RUN bun install --frozen-lockfile

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/worker/local-platform/unified-entrypoint.ts"]
