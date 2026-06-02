# Takos GA Roadmap

Takos is the AI-first chat and agent product. It consumes Takosumi as the
installer / deployment ledger and uses OpenTofu-native source and distribution
artifacts for GA.

## Current Direction

- The product runtime is a single Takos Worker plus Git and agent containers.
- Product deploy artifacts live in `deploy/opentofu`, `deploy/helm`, and
  `deploy/distributions`.
- App source repositories should expose deploy intent as OpenTofu outputs.
- The canonical app output is `takos_app_manifest`, read from
  `tofu output -json` and converted into Takos internal deployment records.
- Legacy flat YAML app manifests remain an internal compatibility parser for
  old fixtures and imports, not a public authoring surface.

## Completed

- [x] Product infrastructure artifacts live under `deploy/opentofu`.
- [x] Rename product gates to `opentofu:helm-values`,
      `opentofu:helm-values:check`, `opentofu:plan-gate`, and
      `validate:opentofu-secrets`.
- [x] Add OpenTofu output parser for `takos_app_manifest` / `takos_app`.
- [x] Prefer OpenTofu module files over `package.json` in installable source
      detection.
- [x] Convert bundled app and catalog consumer repositories to `outputs.tf`
      with `takos_app_manifest`.
- [x] Add `validate:default-app-opentofu` to verify default app outputs through
      OpenTofu and the Takos parser.
- [x] Add `validate:selfhost-no-managed-credentials` to prove self-hosted
      OpenTofu and Helm artifacts stay free of managed-only credentials.
- [x] Add `validate:source-launcher-proof` to prove an OpenTofu-only Git source
      runs through `tofu output -json`, Takosumi install, and the Takos launcher
      route.
- [x] Add `validate:agent-local-proof` to prove run queue dispatch, agent
      control RPC memory / run-event side effects, and mock-LLM container
      execution.

## GA Work

### Source Contract

- [x] Convert `takos-docs`, `takos-slide`, `takos-excel`, `takos-computer`,
      `yurucommu`, and `road-to-me` to include `outputs.tf` with
      `takos_app_manifest`.
- [x] Add a fixture repo that contains no Takos-specific manifest file and
      evaluates only from OpenTofu outputs.
- [x] Prove that fixture through the full Git source install path.
- [x] Remove public docs that teach the flat YAML app manifest as an authoring
      surface after bundled apps migrate.

### Product Runtime

- [x] Prove chat, memory, Git, tool, and agent flows against the single Worker
      route split.
- [x] Prove queued agent dispatch through control RPC memory writes and run
      event records with a mock-LLM container execution gate.
- [x] Prove Git container and agent container images are digest-pinned in the
      release manifest.
- [x] Prove bundled apps auto-install on new Space creation and can be
      uninstalled as normal Installations.

### Distribution

- [x] Run `bun run opentofu:helm-values:check`.
- [x] Run `bun run validate:opentofu-secrets`.
- [x] Run `bun run validate:distributions`.
- [x] Run `bun run validate:selfhost-no-managed-credentials`.
- [x] Run `tofu validate` in `deploy/opentofu/environments/selfhosted`.
- [x] Run `bun run validate:source-launcher-proof`.
- [x] Run `bun run validate:agent-local-proof`.
- [x] Run `bun run validate:default-app-opentofu`.
- [x] Run `bun run opentofu:plan-gate` in a runner with `tofu` installed.
- [x] Run `bun run release-gate` after OpenTofu, Helm, docs, and product checks
      are green.

### Live Evidence

- [ ] Browser proof: signup -> Use Takos -> first Space -> bundled apps.
- [ ] Source proof: Git repo -> `tofu output -json` -> Takosumi install ->
      Takos launcher.
- [ ] Agent proof: chat -> agent execution container -> memory/audit record.
- [ ] Self-host proof: OpenTofu + Helm deployment without managed-only
      credentials.

## Required Local Gates

```bash
bun run check
bun run opentofu:helm-values:check
bun run validate:opentofu-secrets
bun run validate:distributions
bun run validate:selfhost-no-managed-credentials
bun run validate:source-launcher-proof
bun run validate:agent-local-proof
bun run validate:default-app-opentofu
bun test src/worker/application/services/source
```

`bun run opentofu:plan-gate` is required before release promotion when the
runner has the `tofu` CLI installed.
