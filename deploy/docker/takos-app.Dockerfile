FROM denoland/deno:2.7.10

WORKDIR /workspace
ENV DENO_DIR=/deno-dir

COPY app/deno.json app/deno.lock ./app/
COPY app/apps ./app/apps
COPY app/packages ./app/packages
COPY git/packages/git-contract ./git/packages/git-contract

WORKDIR /workspace/app
RUN deno cache apps/api/src/index.ts

ENV PORT=8080
EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "apps/api/src/index.ts"]
