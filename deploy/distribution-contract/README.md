# Takos Distribution Contract

This directory owns the Takos product distribution profile contract.

- `takos-distribution-profile-v1.schema.json` is the structural contract for
  `deploy/distributions/*.json`.
- `bun run check` validates the tracked profile with the rest of the Takos
  product. Takos owns its immutable Worker release descriptor and the narrow
  product materializer; it does not own plan/apply/destroy or a second Run
  ledger.
- Takosumi owns deploy/runtime lifecycle semantics. This contract only describes
  Takos product distribution overlays and the evidence needed to prove each
  target.

## Service Form Topology

`shapeTopology` is a distribution description of how Takos maps to generic
Service Forms when an operator chooses the optional form flow:

```text
takos-worker -> EdgeWorker
takos-agent  -> ContainerService
backing data -> SQLDatabase / KVStore / ObjectBucket / Queue
```

Git hosting is not part of this distribution topology. It belongs to the
independent `takos-git` Capsule and is consumed through declared Interfaces.

This is distribution-profile metadata, not a new Takos-specific Service Form
and not a replacement for the OpenTofu module under `deploy/opentofu`. Takos
must not introduce a catch-all `takosumi_takos` resource. If the distribution
needs a form that existing generic forms cannot express, add a portable generic
form to Takoform and an explicit Takosumi adapter. The existing
`product:activate` / `product:pre-destroy` commands are limited to artifact
materialization that the Cloudflare provider cannot express; they are not a
generic Takos lifecycle API.

## Artifact Ownership

The only shipped distribution target is Cloudflare. Distribution artifacts are
the single Takos product OpenTofu root module under `takos/deploy/opentofu`
(`modules/cloudflare` is its target implementation) and the wrangler worker
template under `takos/deploy/cloudflare`, recorded as the official profile
`takos/deploy/distributions/cloudflare.json`. There are no AWS/GCP OpenTofu
environments and no Helm overlays under `takos/deploy/` — multi-cloud topology
is retired (see `takos/AGENTS.md`).
Official profiles must keep artifact refs inside the Takos deploy template
unless they intentionally point at sibling source modules consumed in-process.
Takosumi account/control-plane source is embedded by the Takos worker; it is not
listed as separate distribution worker artifacts.
