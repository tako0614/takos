# Git source smoke

Safe-by-default smoke coverage for source adapters lives in
`scripts/git-source-smoke.ts`.

## Coverage

- Immutable manifest adapter snapshots a public manifest and verifies the
  manifest/source digest shape.
- Local upload adapter snapshots a temporary directory, verifies file discovery,
  and checks the local tree digest shape.
- Git adapter snapshots a ref without network or git execution by default.
- Optional real git execution is gated by both:
  - `TAKOS_RUN_GIT_SMOKE=1`
  - `TAKOS_GIT_SMOKE_REPO=<local-git-repo>`

When opt-in is enabled, the smoke uses `DenoGitCommandRunner` to resolve
`TAKOS_GIT_SMOKE_REF` (default: `HEAD`) and validates the resolved commit/tree
object ids.

## Commands

Default dry-run:

```sh
deno run --allow-env=TAKOS_RUN_GIT_SMOKE,TAKOS_GIT_SMOKE_REPO,TAKOS_GIT_SMOKE_REF --allow-read --allow-write scripts/git-source-smoke.ts
```

Opt-in real git run against a local checkout:

```sh
TAKOS_RUN_GIT_SMOKE=1 TAKOS_GIT_SMOKE_REPO=/path/to/repo TAKOS_GIT_SMOKE_REF=HEAD \
  deno run --allow-env=TAKOS_RUN_GIT_SMOKE,TAKOS_GIT_SMOKE_REPO,TAKOS_GIT_SMOKE_REF --allow-read --allow-write --allow-run=git scripts/git-source-smoke.ts
```
