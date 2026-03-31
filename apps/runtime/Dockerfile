FROM denoland/deno:2 AS builder
WORKDIR /workspace

# Copy workspace config and lockfile
COPY deno.json deno.lock* ./

# Copy required packages
COPY packages/common/ ./packages/common/
COPY packages/actions-engine/ ./packages/actions-engine/
COPY packages/runtime-service/ ./packages/runtime-service/
COPY apps/runtime/ ./apps/runtime/
COPY apps/cli/ ./apps/cli/

# Cache dependencies
RUN deno cache apps/runtime/src/index.ts
RUN deno cache apps/cli/src/index.ts

FROM denoland/deno:alpine-2
WORKDIR /workspace

# These tools are required at runtime:
# - git/curl/wget/unzip: exposed via ALLOWED_COMMANDS for user actions
#   and used directly by the marketplace action downloader
# - ca-certificates: HTTPS connectivity
RUN apk add --no-cache \
    git \
    curl \
    wget \
    unzip \
    ca-certificates

COPY --from=builder /workspace /workspace
COPY --from=builder /root/.cache/deno /root/.cache/deno

# Install takos CLI globally
RUN printf '#!/bin/sh\nexec deno run --allow-all /workspace/apps/cli/src/index.ts "$@"\n' > /usr/local/bin/takos && chmod +x /usr/local/bin/takos

WORKDIR /workspace/apps/runtime

# Run as non-root for security
RUN addgroup -S takos && adduser -S takos -G takos && \
    chown -R takos:takos /workspace
USER takos

# Set environment
ENV PORT=8080
# TAKOS_API_URL is injected at runtime by the container host (no default to prevent env mismatch)
# Inside CF Containers, traffic arrives via CF internal network (not direct HTTPS).
# CF_CONTAINER=true signals that the process runs inside a CF Container, bypassing HTTPS enforcement.
ENV CF_CONTAINER=true

EXPOSE 8080

CMD ["deno", "run", "--allow-all", "src/index.ts"]
