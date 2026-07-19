# Changelog

All notable user-visible changes to the Takos distribution worker live here.
Takos is the OpenTofu-native AI Workspace distribution; it composes the embedded
Takosumi accounts plane, deploy-control seam, dashboard, and OpenTofu runner at
the self-hoster's own origin. Versions follow per-product semver; pre-1.0
breaking changes bump the minor.

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
