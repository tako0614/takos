# Self-host compose plugin smoke plan

This plan covers the single-node self-host smoke for `compose.local.yml`. It is
an operator/plugin proof, not a PaaS kernel release criterion. The fast check is
dependency-free and does not start Docker; the manual smoke below is the real
Docker/Compose path for a host distribution.

## Static checklist

Run from `takos/paas`:

```sh
deno run --no-config --allow-read scripts/self-host-e2e-check.ts
```

The script validates that `compose.local.yml` contains the required services,
local env-file wiring, externally mapped ports, process-role env/labels,
smoke-safe dependency ordering, Docker socket/network wiring for the local OCI
orchestrator, and named volumes needed by a single-node self-host smoke.

## Manual Docker plugin smoke

Do not run these commands from automation unless explicitly requested. Run them
manually from `takos/paas` on a host with Docker Compose available.

1. Prepare an env file and replace placeholder secrets/keys as needed:

   ```sh
   cp .env.self-host .env.local
   $EDITOR .env.local
   ```

2. Re-run the static checklist against the compose file:

   ```sh
   deno run --no-config --allow-read scripts/self-host-e2e-check.ts
   ```

3. Ask Compose to render the configuration before starting containers:

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml config
   ```

4. Build and start the single-node stack:

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml up --build -d
   ```

5. Watch service health and logs until the stack is healthy:

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml ps

   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml logs -f \
       takos-paas-api takos-paas-router takos-paas-worker \
       takos-paas-runtime-agent takos-paas-log-worker takos-agent
   ```

6. Run HTTP health checks against the host-mapped ports:

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     deno run --allow-read --allow-env --allow-net scripts/local-smoke.mjs
   ```

7. Optional direct endpoint checks:

   ```sh
   curl -fsS http://127.0.0.1:8787/health
   curl -fsS http://127.0.0.1:8788/health
   curl -fsS http://127.0.0.1:8789/health
   curl -fsS http://127.0.0.1:8790/health
   curl -fsS http://127.0.0.1:8081/health
   curl -fsS http://127.0.0.1:8082/health
   ```

8. Tear down when done. Add `-v` only if you want to delete smoke data:

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml down

   # destructive cleanup:
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml down -v
   ```

## Expected service roles

- `takos-paas-api`
- `takos-paas-router`
- `takos-paas-worker`
- `takos-paas-runtime-agent`
- `takos-paas-log-worker`

Process boundaries are asserted through `TAKOS_PAAS_PROCESS_ROLE` and
`takos.io/process-role`.
