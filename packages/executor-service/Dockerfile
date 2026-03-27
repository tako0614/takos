# Build stage — uses monorepo root as Docker context
ARG PNPM_VERSION=9.15.4
FROM node:20-slim AS builder

# Install pnpm
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /workspace

# Copy workspace manifests and lockfile
COPY package.json ./
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy required packages
COPY packages/common ./packages/common
COPY packages/agent-core ./packages/agent-core
COPY packages/control/tsconfig.base.json ./packages/control/
COPY packages/control/core ./packages/control/core
COPY packages/control/src ./packages/control/src
COPY packages/control/agent ./packages/control/agent
COPY packages/actions-engine ./packages/actions-engine
COPY packages/executor-service ./packages/executor-service

# Copy build script
COPY scripts/build-container.mjs ./scripts/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build @takos/common first
WORKDIR /workspace/packages/common
RUN pnpm run build

# Bundle agent-executor (esbuild resolves control-core imports into a single file)
WORKDIR /workspace/packages/executor-service
RUN node build.mjs

# Builder uses Debian slim for broader build compatibility (native deps).
# Production uses Alpine for minimal image size — only JS artifacts are copied.
FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /workspace

# Copy pnpm workspace config for production dep install
COPY package.json ./
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY --from=builder /workspace/packages/common ./packages/common
COPY --from=builder /workspace/packages/actions-engine ./packages/actions-engine
COPY --from=builder /workspace/packages/agent-core ./packages/agent-core
COPY --from=builder /workspace/packages/control/core ./packages/control/core
COPY --from=builder /workspace/packages/control/agent ./packages/control/agent
COPY --from=builder /workspace/packages/executor-service ./packages/executor-service

# Install only production runtime deps (langchain, hono)
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} && \
    pnpm install --frozen-lockfile --prod --filter @takos/executor-service...

# Copy bundled output
COPY --from=builder /workspace/packages/executor-service/dist ./packages/executor-service/dist

WORKDIR /workspace/packages/executor-service

# Run as non-root for security
RUN addgroup -S agent && adduser -S agent -G agent && \
    chown -R agent:agent /workspace
USER agent

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
