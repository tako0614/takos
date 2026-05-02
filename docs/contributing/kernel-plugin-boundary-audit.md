# Kernel / Plugin Boundary Audit

This document is the working checklist for keeping Takosumi docs aligned with
the kernel-only implementation model.

## Source of truth

- `takos/paas` owns the PaaS kernel: control-plane semantics, domains, API
  contracts, signed internal RPC, plan/apply, activation truth, resources,
  routing projections, publications, events, audit, and security policy.
- `packages/paas-contract/src/plugin.ts` owns the public kernel plugin ABI.
- `apps/paas/src/plugins/` owns the registry, env module loader, and no-I/O
  reference plugin.
- Self-host, cloud provider, database, queue, object-storage, KMS, secret
  backend, and runtime host implementations are plugin responsibilities.

## Current allowed in-kernel implementations

- In-memory/noop/reference adapters for conformance and local tests.
- Legacy local adapters and dry-run smoke scripts, as long as docs describe them
  as adapter/plugin conformance paths rather than kernel production wiring.
- Operator-only runtime config selectors that can choose `plugin` and fail fast
  when a selected plugin ID is not registered.

## Drift patterns to reject

- Describing Docker, Cloudflare, Postgres, Redis, S3, KMS, or secret backends as
  required kernel completion work.
- Treating self-host or cloud deploy proofs as part of the kernel release gate.
- Adding provider/backend/plugin selection to the public manifest or public
  deploy API.
- Reintroducing `takos-deploy` or `takos-runtime` as default top-level service
  boundaries instead of PaaS internal domains.

## 2026-04-29 audit result

- Updated the architecture milestone doc so runtime/routing completion is a
  kernel port/projection slice, not a local Docker milestone.
- Reclassified real backend and self-host docs as plugin-backed operator proofs.
- Added validation checks for README/current-state/system-plan plugin boundary
  wording.
- Current kernel validation baseline: `deno task test:all` passes with
  `240 passed | 0 failed`.
