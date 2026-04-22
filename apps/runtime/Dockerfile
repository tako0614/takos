FROM denoland/deno:2.7.10 AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /workspace

# Build context is the ecosystem root so the runtime image can include the
# Takos monorepo packages and the standalone takos-cli source of truth.
COPY takos/deno.json takos/deno.lock* ./takos/
COPY takos/packages/common/ ./takos/packages/common/
COPY takos/packages/actions-engine/ ./takos/packages/actions-engine/
COPY takos/packages/runtime-service/ ./takos/packages/runtime-service/
COPY takos/packages/control/ ./takos/packages/control/
COPY takos/apps/runtime/ ./takos/apps/runtime/
COPY takos-cli/ ./takos-cli/

# Cache dependencies
WORKDIR /workspace/takos-cli
RUN deno cache src/index.ts

WORKDIR /workspace/takos
RUN deno cache apps/runtime/src/index.ts

FROM denoland/deno:alpine-2.7.10
ENV DENO_DIR=/deno-dir
WORKDIR /workspace

# These tools are required at runtime:
# - git/curl/wget/unzip: exposed via ALLOWED_COMMANDS for user actions
#   and used directly by the Store action downloader
# - ca-certificates: HTTPS connectivity
RUN apk add --no-cache \
    git \
    curl \
    wget \
    unzip \
    ca-certificates

COPY --from=builder /workspace /workspace
COPY --from=builder /deno-dir /deno-dir

# Install takos CLI globally
RUN printf '#!/bin/sh\ncd /workspace/takos-cli\nexec deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys=homedir src/index.ts "$@"\n' > /usr/local/bin/takos && chmod +x /usr/local/bin/takos

WORKDIR /workspace/takos/apps/runtime

# Run as non-root for security
RUN addgroup -S takos && adduser -S takos -G takos && \
    chown -R takos:takos /workspace /deno-dir
USER takos

# Set environment
ENV PORT=8080
# TAKOS_API_URL is injected at runtime by the container host (no default to prevent env mismatch)
# Inside CF Containers, traffic arrives via CF internal network (not direct HTTPS).
# CF_CONTAINER=true signals that the process runs inside a CF Container, bypassing HTTPS enforcement.
ENV CF_CONTAINER=true

EXPOSE 8080

CMD ["deno", \
    "run", \
    "--allow-read=.,../../packages,../../../takos-cli,/tmp,/repos", \
    "--allow-write=.,/tmp,/repos", \
    "--allow-env", \
    "--allow-net", \
    "--allow-run=/bin/bash,/bin/sh,/usr/bin/bash,/usr/bin/sh,/usr/local/bin/bash,bash,sh,pwsh,powershell,powershell.exe,cmd.exe,git,tar,node,npm,npx,pnpm,yarn,bun,esbuild,wrangler,takos,echo,ls,cat,pwd,mkdir,cp,mv,rm,touch,chmod,chown,head,tail,grep,find,sort,uniq,wc,diff,unzip,gzip,gunzip,zip,sed,awk,xargs,env,which,whereis,file,basename,dirname,realpath,readlink,tsc,webpack,vite,jest,vitest,mocha,ps,top,curl,wget,kill,killall,pkill,printenv", \
    "src/index.ts"]
