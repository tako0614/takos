# Contributing to Takos

- Run Deno tasks from this repo root
- Keep Takos implementation ownership inside this repo; do not move product
  logic to the ecosystem root
- Keep `packages/*` as the source of truth and treat `apps/*` as thin
  composition only
- Treat `docs/` as the source of truth for Takos docs
- Treat tracked deployment files as templates only
- Keep public setup instructions working without private docs

Before opening a PR, update user-facing docs when behavior, API, or deployment
contracts change. Use `deno task docs:dev`, `deno task docs:build`, and
`deno task lint:docs` to verify docs changes locally.
