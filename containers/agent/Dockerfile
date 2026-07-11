FROM rust:1.94-bookworm AS builder

WORKDIR /work/takos/containers/agent

COPY takos/containers/agent/Cargo.toml takos/containers/agent/Cargo.lock ./
COPY takos/containers/agent/src ./src
COPY takos-agent-engine /work/takos-agent-engine

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 takos

COPY --from=builder /work/takos/containers/agent/target/release/takos-agent /usr/local/bin/takos-agent

ENV PORT=8080 \
  TAKOS_AGENT_BIND_HOST=0.0.0.0

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/health || exit 1

USER takos
WORKDIR /app

CMD ["/usr/local/bin/takos-agent"]
