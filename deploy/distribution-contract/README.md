# Takos Distribution Contract

This directory owns the Takos product distribution profile contract.

- `takos-distribution-profile-v1.schema.json` is the structural contract for
  `deploy/distributions/*.json`.
- `bun scripts/build-release-manifest.ts` records the schema digest and each
  official profile digest in the release manifest. The release gate uses that
  manifest evidence; do not document a standalone distribution validator unless
  the matching package script exists.
- Takosumi owns deploy/runtime lifecycle semantics. This contract only describes
  Takos product distribution overlays and the evidence needed to prove each
  target.

## Artifact Ownership

The only shipped distribution target is Cloudflare. Distribution artifacts are
the Takos product OpenTofu module + environment under `takos/deploy/opentofu`
(`modules/cloudflare`, `environments/cloudflare-prod`) and the wrangler worker
template under `takos/deploy/cloudflare`, recorded as the official profile
`takos/deploy/distributions/cloudflare.json`. There are no AWS/GCP OpenTofu
environments and no Helm overlays under `takos/deploy/` — multi-cloud topology
is retired (see `takos/AGENTS.md`).
Official profiles must keep artifact refs inside the Takos deploy template
unless they intentionally point at sibling source modules consumed in-process.
Takosumi account/control-plane source is embedded by the Takos worker; it is not
listed as separate distribution worker artifacts.
