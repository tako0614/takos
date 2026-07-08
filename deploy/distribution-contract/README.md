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

## Resource Shape Topology

`shapeTopology` records how the Takos distribution maps to Takosumi generic
Resource Shapes:

```text
takos-worker -> EdgeWorker
takos-agent  -> ContainerService
backing data -> SQLDatabase / KVStore / ObjectBucket / Queue
```

Git hosting is worker-native: read-only Smart HTTP clone/fetch is served by
`takos-worker` from the `ObjectBucket` (R2) git object store, so it maps to the
`EdgeWorker` + `ObjectBucket` shapes above rather than a separate container
service. Push goes through the Takos repository API, not Git Smart HTTP.

This is distribution-profile evidence, not a new Takos-specific Resource Shape
and not a replacement for the OpenTofu module under `deploy/opentofu`. Takos
must not introduce a catch-all `takosumi_takos` resource. If the distribution
needs a service form that the current generic shapes cannot express, add the
missing generic shape in Takosumi only after the Resource Shape prior-art gate
passes.

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
