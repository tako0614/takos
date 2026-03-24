# Build stage
ARG PNPM_VERSION=9.15.4
FROM node:20-slim AS builder

# Install pnpm
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /workspace

# Copy pnpm workspace config and lockfile from root
COPY package.json ./
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy common and actions-engine packages
COPY packages/common ./packages/common
COPY packages/actions-engine ./packages/actions-engine
COPY packages/runtime-service ./packages/runtime-service

# Copy takos-runtime package
COPY apps/runtime/package.json ./apps/runtime/
COPY apps/runtime/tsconfig.json ./apps/runtime/
# Only copy the runtime wrapper entrypoint. The canonical service implementation
# lives in packages/runtime-service.
COPY apps/runtime/src/index.ts ./apps/runtime/src/index.ts

# Copy takos-cli package (single source from repo root)
COPY apps/cli/package.json ./apps/cli/
COPY apps/cli/tsconfig.json ./apps/cli/
COPY apps/cli/tsup.config.ts ./apps/cli/
COPY apps/cli/src ./apps/cli/src

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build @takos/common and @takos/actions-engine first
WORKDIR /workspace/packages/common
RUN pnpm run build

WORKDIR /workspace/packages/actions-engine
RUN pnpm run build

# Build @takos/runtime-service to JS so `node dist/index.js` can load it without a TS loader.
WORKDIR /workspace
RUN pnpm --filter @takos/runtime-service build

# Build runtime
WORKDIR /workspace/apps/runtime
RUN pnpm run build

# Build takos-cli
WORKDIR /workspace/apps/cli
RUN pnpm run build

# Builder uses Debian slim for broader build compatibility (native deps).
# Production uses Alpine for minimal image size — only JS artifacts are copied.
FROM node:20-alpine

# These tools are required at runtime:
# - git/curl/wget/unzip: exposed via ALLOWED_COMMANDS (src/config.ts) for user actions
#   and used directly by the marketplace action downloader
# - ca-certificates: HTTPS connectivity
RUN apk add --no-cache \
    git \
    curl \
    wget \
    unzip \
    ca-certificates

# esbuild and pnpm are in ALLOWED_COMMANDS — needed at runtime for user build operations
ARG PNPM_VERSION
RUN npm install -g esbuild@0.24.2 pnpm@${PNPM_VERSION}

WORKDIR /workspace

# Copy pnpm workspace config and install production dependencies
COPY package.json ./
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
# Copy built workspace packages from builder (includes dist directory)
COPY --from=builder /workspace/packages/common ./packages/common
COPY --from=builder /workspace/packages/actions-engine ./packages/actions-engine
COPY --from=builder /workspace/packages/runtime-service ./packages/runtime-service
COPY apps/runtime/package.json ./apps/runtime/

# Install production dependencies for runtime
RUN pnpm install --frozen-lockfile --prod

# Copy built runtime files
COPY --from=builder /workspace/apps/runtime/dist ./apps/runtime/dist

# Install takos-cli
# tsup bundles workspace deps (actions-engine) into the output, so we strip
# workspace:* references before installing only the external runtime deps.
WORKDIR /cli
COPY --from=builder /workspace/apps/cli/dist ./dist
COPY --from=builder /workspace/apps/cli/package.json ./package.orig.json
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.orig.json','utf8')); \
  for(const section of ['dependencies','devDependencies']){ \
    for(const[k,v]of Object.entries(p[section]||{})){if(String(v).startsWith('workspace:'))delete p[section][k];} \
  } \
  require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));" && \
  pnpm install --prod

# Create takos command wrapper
RUN printf '#!/bin/sh\nNODE_PATH=/cli/node_modules exec node /cli/dist/index.cjs "$@"\n' > /usr/local/bin/takos && chmod +x /usr/local/bin/takos

WORKDIR /workspace/apps/runtime

# Run as non-root for security
RUN chown -R node:node /workspace /cli
USER node

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
# TAKOS_API_URL is injected at runtime by the container host (no default to prevent env mismatch)
# Inside CF Containers, traffic arrives via CF internal network (not direct HTTPS).
# CF_CONTAINER=true signals that the process runs inside a CF Container, bypassing HTTPS enforcement.
ENV CF_CONTAINER=true

EXPOSE 8080

CMD ["node", "dist/index.js"]
