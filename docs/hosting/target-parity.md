# Distribution Target Parity

このページは `takos/deploy/distributions/*.json` で管理する Takos product
distribution target の current readiness を明示します。ここでの status は
operator-facing deploy artifact の完成度であり、Takosumi 上で動く tenant app の
manifest behavior とは別です。

## Status Definitions

| status         | meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `ga`           | production 推奨。schema / packaging / live proof / rollback runbook が release gate 済       |
| `beta`         | operator が明示的に採用可能。主要 artifact と runbook はあるが、live proof は opt-in         |
| `smoke-only`   | schema / dry-run smoke / artifact reference は検証済。実環境 deploy proof は未完             |
| `unsupported`  | current distribution target ではない。profile / runbook / validator 対象に含めない           |

Default CI は credential-free な proof だけを実行します。provider credentials、
cluster、account、public URL を必要とする proof は operator-owned evidence として
別 gate にします。

## Current Matrix

| target         | status       | current proof                                                                                   | promotion gate                                                                                                            |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare`   | `beta`       | schema validation, artifact refs, provider fixture proof command, dry-run service smoke          | takos-private wrangler split, staging deploy proof, `distribution:smoke --live`, provider live proof             |
| `aws`          | `smoke-only` | schema validation, Terraform/Helm refs, credential-free staging plan gate, provider fixture proof command, dry-run service smoke | `helm template` with `values-aws.yaml`, provider live proof, service live smoke |
| `gcp`          | `smoke-only` | schema validation, Terraform/Helm refs, credential-free staging plan gate, provider fixture proof command, dry-run service smoke | `helm template` with `values-gcp.yaml`, provider live proof, service live smoke |
| `kubernetes`   | `smoke-only` | schema validation, Helm chart ref, provider fixture proof command, dry-run service smoke         | `helm template`, kind/k3d install smoke, provider live proof, service live smoke                                          |
| `selfhosted`   | `smoke-only` | schema validation, compose ref, provider fixture proof command, dry-run service smoke            | self-host compose deploy proof, `distribution:smoke --live`, provider live proof, secret rotation runbook evidence        |
| `local`        | `unsupported` | local compose is a developer runtime, not a production distribution target                       | none; use `selfhosted` for bare metal / VM production packaging                                                           |
| `azure`        | `unsupported` | Takosumi fixture shape exists for provider development, but Takos product distribution is absent | add `deploy/distributions/azure.json`, artifact refs, runbook, validator coverage, and provider proof before promotion    |

## Evidence Commands

| proof                         | command                                                                                                                    | default gate |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
| schema + artifact validation  | `cd takos && deno task validate:distributions`                                                                             | yes          |
| dry-run service smoke metadata | `cd takos && deno task distribution:smoke --all`                                                                           | yes          |
| per-target live service smoke | `cd takos && deno task distribution:smoke --manifest deploy/distributions/<target>.json --live`                            | no           |
| provider fixture proof        | `cd takosumi && TAKOSUMI_PLUGIN_LIVE_PROVIDER=<target> TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/<target>.shape-v1.json deno task live-provisioning-smoke` | no           |
| provider live proof           | `cd takosumi && TAKOSUMI_PLUGIN_LIVE_PROVIDER=<target> TAKOSUMI_PLUGIN_LIVE_PROOF_MODE=live TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/<target>.shape-v1.json deno task live-provisioning-smoke` | no           |

## Artifact Ownership

Takos product distribution artifacts are owned by `takos/deploy/`. AWS and GCP
use `takos/deploy/terraform/environments/*-prod` plus `takos/deploy/helm/takos`
overlays. The README-only `takosumi/deploy/aws` and `takosumi/deploy/gcp`
directories are Takosumi provider runbooks, not release artifact directories for
Takos product distributions.

## Promotion Rules

Promotion is monotonic. A target can move from `smoke-only` to `beta` when its
packaging path can render or plan without cloud credentials and a credentialed
operator can attach one live proof record. A target moves from `beta` to `ga`
only after the live deploy path, live service smoke, rollback or cleanup path,
and secret rotation evidence are documented.

The status is intentionally conservative. Missing live proof keeps a target out
of `ga` even when the distribution profile validates.
