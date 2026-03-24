# Contributing to Takos

- Run Node and pnpm commands from this repo root
- Keep implementation ownership inside `takos/`; do not move product logic to
  the ecosystem root
- Keep `packages/*` as the source of truth and treat `apps/*` as thin
  composition only
- `home-agent` is private-only and should not be treated as OSS product flow
- Treat tracked deployment files as templates only
- Keep public setup instructions working without private docs

Before opening a PR, update user-facing docs when behavior, API, or deployment
contracts change.
