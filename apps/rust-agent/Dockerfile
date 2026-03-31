FROM rust:1.94-bookworm AS builder

WORKDIR /work

COPY packages/rust-agent-engine/Cargo.toml /work/packages/rust-agent-engine/Cargo.toml
COPY packages/rust-agent-engine/Cargo.lock /work/packages/rust-agent-engine/Cargo.lock
COPY packages/rust-agent-engine/src /work/packages/rust-agent-engine/src
COPY apps/rust-agent/Cargo.toml /work/apps/rust-agent/Cargo.toml
COPY apps/rust-agent/src /work/apps/rust-agent/src

RUN cargo build --manifest-path /work/apps/rust-agent/Cargo.toml --release

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 takos

COPY --from=builder /work/apps/rust-agent/target/release/takos-rust-agent /usr/local/bin/takos-rust-agent

ENV PORT=8080

USER takos
WORKDIR /app

CMD ["/usr/local/bin/takos-rust-agent"]
