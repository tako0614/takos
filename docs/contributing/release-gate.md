# Release Gate Script

`scripts/release-gate.ts` runs the safe local release gates for `takos`
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
2. Agent docs validator: `deno task validate:agent-docs`
3. Architecture alignment validator:
   `scripts/validate-architecture-alignment.ts`
4. `deno task docs:build`
5. Process role validator: `deno task validate:process-roles`
6. Distribution profile validator: `deno task validate:distributions`
7. Helm chart validator: `deno task validate:helm`
8. Release manifest build: `scripts/build-release-manifest.ts`
9. Compose config render: `deno task local:config`

## Output

Progress and child command output are written to stderr. Stdout is reserved for
a JSON object containing:

- overall `ok` boolean
- whether `--keep-going` was used
- start/finish timestamps and total `durationMs`
- command names in execution order
- pass/fail/skip counts
- per-gate command name, command argv, exit code, duration, stdout, and stderr
