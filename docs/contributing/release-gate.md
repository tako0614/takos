# Release Gate Script

`scripts/release-gate.ts` runs the safe local release gates for `takos`
sequentially and emits a machine-readable JSON summary on stdout.

## Usage

```sh
deno run --config deno.json --allow-run=deno --allow-env scripts/release-gate.ts
```

By default the script stops on the first failed command and marks the remaining
gates as skipped. To continue through every gate and collect a full failure
list:

```sh
deno run --config deno.json --allow-run=deno --allow-env scripts/release-gate.ts --keep-going
```

## Gate order

1. `deno task check`
2. Agent docs validator: `deno task validate:agent-docs`
3. Architecture alignment validator:
   `scripts/validate-architecture-alignment.ts`
4. `deno task docs:build`
5. Service set validator: `deno task validate:service-set`
6. Distribution profile schema and artifact validator:
   `deno task validate:distributions`
7. Observability artifact validator: `deno task validate:observability`
8. Patch management validator: `deno task validate:patch-management`
9. Migration safety validator: `deno task validate:migration-safety`
10. Legal docs validator: `deno task validate:legal-docs`
11. Release promotion validator: `deno task validate:release-promotion`
12. Helm chart validator: `deno task validate:helm`
13. Helm overlay generator drift check: `deno task helm:check-overlays`
14. Terraform output to Helm values fixture check:
    `deno task terraform:helm-values:check`
15. Release manifest build: `scripts/build-release-manifest.ts`
16. Compose config render: `deno task local:config`

The GitHub `release-gate` workflow also sets up Helm v3 and a kind cluster, then
runs
`TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN=1 TAKOS_HELM_INSTALL_TEST_CRDS=1 deno task helm:template-smoke`
and `TAKOS_HELM_INSTALL_TEST_CRDS=1 deno task helm:install-smoke` before the
script gate so chart rendering, client install dry-run, and real cluster install
regressions fail CI while the local safe release-gate script stays
credential-free.

GitHub PR/release workflows also set up Terraform 1.9.8 and run
`deno task terraform:plan-gate`. The plan gate uses committed staging tfvars and
`terraform_plan_mode = true` to produce AWS/GCP plan summaries without live
cloud credentials; full plan text is uploaded as a workflow artifact.

## Output

Progress and child command output are written to stderr. Stdout is reserved for
a JSON object containing:

- overall `ok` boolean
- whether `--keep-going` was used
- start/finish timestamps and total `durationMs`
- command names in execution order
- pass/fail/skip counts
- per-gate command name, command argv, exit code, duration, stdout, and stderr

## Phase 1.x Acceptance Gates との関係

本 17 gates は **1.0 Core Release (Part I)** の release readiness を検証します。
1.x Installable App Model (Phase 1.1-1.7) の acceptance gates は ROADMAP.md Part
III に列挙され、acceptance-test-backlog.md の P-Phase 1.x.* で詳述されます。
これらは本 17 gates の **下流** で実施され、Phase 1.x release tag (`v1.X.0`) の
独立 release-gate として運用されます。
