# Docker provider plugin smoke script

`scripts/docker-provider-smoke.ts` is a safe-by-default smoke entrypoint for the
local Docker provider plugin materialization path. It validates plugin/adapter
behavior and is not part of the PaaS kernel release gate.

## Default dry-run

Run without Docker access:

```sh
deno run --config deno.json --allow-env=TAKOS_RUN_DOCKER_SMOKE scripts/docker-provider-smoke.ts
```

Default behavior does not instantiate `DenoCommandDockerRunner`, does not
require Docker, and uses `LocalDockerProviderMaterializer` with its dry-run
runner. The script prints the generated Docker commands and operation statuses.

## Opt-in Docker execution

To execute real Docker commands, opt in explicitly and grant run permission:

```sh
TAKOS_RUN_DOCKER_SMOKE=1 deno run \
  --config deno.json \
  --allow-env=TAKOS_RUN_DOCKER_SMOKE \
  --allow-run=docker \
  scripts/docker-provider-smoke.ts
```

Only when `TAKOS_RUN_DOCKER_SMOKE=1` is set does the script inject
`DenoCommandDockerRunner` into `LocalDockerProviderMaterializer`. The smoke uses
a unique network/group suffix and prints cleanup hints for the created container
and network.

Expected real commands include:

- `docker network create takos-docker-smoke-<timestamp>`
- `docker image pull busybox:latest`
- `docker container create ... busybox:latest sh -c 'echo takos docker provider smoke'`
- `docker container start <generated-container-name>`
