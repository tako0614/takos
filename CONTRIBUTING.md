# Contributing to Takos

- Run Bun package scripts from this repo root
- Keep Takos implementation ownership inside this repo; do not move product
  logic to the ecosystem root
- Keep source ownership under `src/worker`, `src/routes`, `src/contracts`,
  `web`, and `containers/*`; do not reintroduce root `packages/*` as product
  implementation roots
- Treat `docs/` as the source of truth for Takos docs
- Treat tracked deployment files as templates only
- Keep public setup instructions working without private docs

Before opening a PR, update user-facing docs when behavior, API, or deployment
contracts change. Use `bun run docs:dev`, `bun run docs:build`, and
`bun run lint:docs` to verify docs changes locally.
