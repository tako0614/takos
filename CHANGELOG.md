# Changelog

All notable user-visible changes to the Takos distribution worker live here.
Takos is the OpenTofu-native AI Workspace distribution; it composes the embedded
Takosumi accounts plane, deploy-control seam, dashboard, and OpenTofu runner at
the self-hoster's own origin. Versions follow per-product semver; pre-1.0
breaking changes bump the minor.

## 0.12.0 — Provider-neutral deployment adapters

- Make the provider-neutral resource contract authoritative and expose
  Takoform and direct Cloudflare as peer OpenTofu adapters, with the portable
  Takoform path as the default install choice.
- Replace the generic tool runtime plus executor split with one bounded Takos
  agent image deployed at three capacity tiers. Shell, browser, desktop, and
  writable Git hosting remain separately installed capabilities.
- Retire the incomplete Takos-owned Git Actions UI, API, triggers, and workflow
  queues. Existing persisted workflow history is preserved; writable Git and
  optional Actions execution belong to `takos-git`.
- Publish the same digest-pinned agent image to the Cloudflare registry and
  public GHCR, and fail closed unless their config and ordered layer digests
  match before the immutable Worker release is published.

## 0.11.20 — Portable AI Interface requirement

- Declare the exact `takosumi.ai.gateway@1` contract and `ai.chat` permission
  in the repository manifest instead of relying on a host-specific binding.
- Keep provider names, Interface IDs, endpoints, and credentials out of the
  repository; Takosumi resolves the Workspace Interface and short-lived grant
  for the Capsule OIDC pairwise principal.

## 0.11.3 — Provider-safe Cloudflare queue names

- Bound every Capsule-derived Cloudflare Queue name below the live provider's
  63-character limit while preserving the existing readable names when they
  already fit.
- Keep long names deterministic and collision-resistant with a stable digest,
  and exercise the boundary in the portable OpenTofu test gate.

## 0.11.2 — Required Cloudflare deployment contract

- Make the required `cloudflare` repository input match the OpenTofu module by
  removing its synthetic default and requiring an explicit account id.
- Keep the account coordinate separate from Provider Connection credentials.

## 0.11.1 — Installable Cloudflare deployment input

- Declare the non-secret Cloudflare deployment object as a reviewed repository
  input so Takosumi can create a direct Cloudflare Capsule without bypassing
  repository-owned install UX validation.
- Keep provider credentials in a separate Provider Connection and require the
  compatibility-derived ProviderBinding before Plan.

## 0.11.0 — Canonical managed Worker lifecycle

- Materialize managed Takos Workers through the canonical Takosumi EdgeWorker
  lifecycle and retire the former managed Cloudflare compatibility release.
- Fail closed before mutation when the reviewed managed binding set is missing
  or drifts from the release request.
- Keep the independently released Takos mobile client outside the distribution
  artifact and its release workflow.
- Repin the agent engine to the reviewed main commit and resolve the wrapper's
  `quinn-proto` dependency to the patched 0.11.15 release.
- Resolve the Takos website's vulnerable archive and glob transitive
  dependencies without changing its rendered product surface.

## 0.10.38 — Stable release publication repair

- Publish the sealed GitHub Release from the checked-out Takos repository so
  `--notes-from-tag` can verify and read the annotated release tag.
- Retain the failed v0.10.37 promotion's exact versioned OCI tags without
  overwrite; v0.10.38 is a newly built and qualified immutable candidate.

## 0.10.37 — Immutable release qualification

- Build one three-image candidate and bind its exact source, policy, toolchain,
  and OCI digests before any promotion.
- Qualify both a fresh install and an exact v0.10.36-to-v0.10.37 upgrade in an
  isolated production-equivalent replica without rebuilding the candidate.
- Use single-operator technical authorization while retaining fail-closed
  digest, health, failure-rehearsal, and registry-readback gates.

## 0.10.36 — Declared MCP Interface discovery

- Discover agent tools from ordinary resolved `mcp.server` Interfaces and
  Ready principal `InterfaceBinding` authority instead of a Takos-specific
  control-tool registry.
- Revalidate the exact Workspace, Capsule, binding, endpoint, and resolved
  revision on catalog reads and tool calls; revoked or drifting declarations
  fail closed and invocation credentials remain short-lived.
- Align the built-in operator-control Capsule with the same generic `endpoint`
  Output mapping used by every other declared runtime Interface.

## 0.10.35 — Capsule Source Options

- Publish the optional provider-neutral deployment chooser for the existing
  Cloudflare OpenTofu Capsule without changing the normal install authority.

## 0.10.0 — Takosumi 17-noun alignment

- Align the Takos-managed deploy path with Takosumi's final 17-noun model. The
  `scripts/takosumi-deploy.sh` wrapper now takes `TAKOSUMI_CAPSULE_ID`
  (env) / `--capsule` (flag) and calls `/api/v1/capsules/:id/plan` plus
  `/api/v1/plan-runs/:id/apply`. The deploy workflow passes
  `TAKOSUMI_CAPSULE_ID` and `TAKOSUMI_WORKSPACE_ID`. Operators driving the
  wrapper from CI update those secret names.
- Takos is managed by the embedded Takosumi deploy control as a `Capsule`: a
  plan Run plus apply Run records a new `StateVersion` and `Output`. Provider
  Connection, Provider Binding, and runner policy own provider credentials,
  state backend, and Cloudflare Container execution.
