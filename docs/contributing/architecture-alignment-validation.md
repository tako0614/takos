# Architecture alignment validation

This guard documents `takos/paas/scripts/validate-architecture-alignment.ts`, a
text-only validation pass for stale terminology and path drift across the
`takosumi` product root and the shell-owned `takos/docs/contributing` docs.

## Checks

- `takos/paas/README.md` and `takos/docs/contributing/current-state.md` must
  describe the Takosumi shape as internal domains under `takosumi`,
  including the deploy/runtime domain wording.
- `takos/paas/README.md` and `takos/docs/contributing/**/*.md` must not describe
  `takos-deploy` or `takos-runtime` as stale top-level product roots or default
  top-level service boundaries unless the same paragraph qualifies them as
  internal domains, compatibility, or legacy wording.
- Required domain directories must exist under `apps/paas/src/domains`: `core`,
  `deploy`, `runtime`, `resources`, `routing`, `network`, `registry`, `audit`,
  `events`, `publications`, and `supply-chain`.

## Command

```sh
cd takos/paas
deno run --config deno.json --allow-read scripts/validate-architecture-alignment.ts
```

The script is dependency-free and reads only repository text/filesystem state.
