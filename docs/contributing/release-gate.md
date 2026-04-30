# Release Gate Script

`scripts/release-gate.ts` runs the safe local release gates for `takos/paas`
sequentially and emits a machine-readable JSON summary on stdout.

## Usage

```sh
deno run --config deno.json --allow-run=deno --allow-env scripts/release-gate.ts
```

By default the script stops on the first failed command and marks the remaining
gates as skipped. To continue through every gate and collect a full failure
list:

```sh
deno run --config deno.json --allow-run=deno --allow-env scripts/release-gate.ts --keep-going
```

## Gate order

1. `deno task check`
2. `deno task test:all`
3. `deno lint`
4. `deno fmt --check`
5. Process role validator: `scripts/validate-process-roles.ts`
6. Architecture alignment validator:
   `scripts/validate-architecture-alignment.ts`
7. Self-host E2E compose check: `scripts/self-host-e2e-check.ts`
8. Compose smoke default dry-run: `scripts/compose-smoke.ts`
9. Router config smoke dry-run: `scripts/router-config-smoke.ts`
10. Git source smoke dry-run: `scripts/git-source-smoke.ts`
11. Object storage smoke dry-run: `scripts/object-storage-smoke.ts`
12. Postgres storage smoke dry-run: `scripts/postgres-storage-smoke.ts`
13. Redis queue smoke dry-run: `scripts/redis-queue-smoke.ts`
14. Docker provider smoke dry-run: `scripts/docker-provider-smoke.ts`
15. Compose real smoke dry-run: `scripts/compose-real-smoke.ts`
16. Runtime agent API smoke: `scripts/runtime-agent-api-smoke.ts`
17. Real backend readiness no-start check: `scripts/real-backend-readiness.ts`
18. Release manifest build: `scripts/build-release-manifest.ts`
19. PaaS in-process smoke: `scripts/paas-smoke.ts`

The compose, git, object-storage, postgres, redis queue, docker, and
compose-real smokes are forced into dry-run mode by setting their opt-in
execution variables to `0` in the child process environment.

## Output

Progress and child command output are written to stderr. Stdout is reserved for
a JSON object containing:

- overall `ok` boolean
- whether `--keep-going` was used
- start/finish timestamps and total `durationMs`
- command names in execution order
- pass/fail/skip counts
- per-gate command name, command argv, exit code, duration, stdout, and stderr
