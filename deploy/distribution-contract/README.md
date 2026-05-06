# Takos Distribution Contract

This directory owns the Takos product distribution profile contract.

- `takos-distribution-profile-v1.schema.json` is the structural contract for
  `deploy/distributions/*.json`.
- `deno task validate:distributions` validates every official profile against
  this schema before running artifact path, provider proof, fixture, service
  set, and smoke metadata checks.
- Takosumi owns deploy/runtime lifecycle semantics. This contract only describes
  Takos product distribution overlays and the evidence needed to prove each
  target.
