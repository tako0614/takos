FROM oven/bun:1.3

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/takos/containers/git
COPY takos/containers/git/package.json takos/containers/git/bun.lock takos/containers/git/bunfig.toml takos/containers/git/tsconfig.json ./
COPY takos/containers/git/shims ./shims
COPY takos/containers/git/src ./src
COPY takos/src/contracts /workspace/takos/src/contracts
COPY takosumi /workspace/takosumi

RUN mkdir -p node_modules /workspace/node_modules \
  && chown -R bun:bun node_modules /workspace

USER bun
RUN bun install --frozen-lockfile

ENV PORT=8790
EXPOSE 8790

CMD ["bun", "src/index.ts"]
