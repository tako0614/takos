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
COPY tsconfig.base.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy required packages (source only — esbuild bundles from src)
COPY packages/common ./packages/common
COPY packages/browser-service ./packages/browser-service

# Copy takos-browser wrapper
COPY apps/browser/package.json ./apps/browser/
COPY apps/browser/tsconfig.json ./apps/browser/
COPY apps/browser/build.mjs ./apps/browser/
COPY apps/browser/src/index.ts ./apps/browser/src/
COPY scripts/build-container.mjs ./scripts/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Bundle takos-browser (esbuild bundles @takos/common from source directly)
WORKDIR /workspace/apps/browser
RUN node build.mjs

# Production stage — Playwright base image with Chromium pre-installed
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Install Node.js (Playwright image has it, but ensure correct version)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy pnpm workspace config for production dep install
COPY package.json ./
COPY .npmrc ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY --from=builder /workspace/packages/common ./packages/common
COPY --from=builder /workspace/packages/browser-service ./packages/browser-service
COPY apps/browser/package.json ./apps/browser/

# Install only production runtime deps (express, playwright-core)
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} && \
    pnpm install --frozen-lockfile --prod --filter @takos/browser...

# Copy bundled output
COPY --from=builder /workspace/apps/browser/dist ./apps/browser/dist

WORKDIR /workspace/apps/browser

# Run as non-root for security
RUN groupadd -r browser && useradd -r -g browser -m browser && \
    chown -R browser:browser /workspace && \
    mkdir -p /tmp/browser-profile && chown -R browser:browser /tmp/browser-profile
USER browser

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
