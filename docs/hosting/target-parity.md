# ディストリビューションターゲットの対応状況

> このページでわかること: 各ホスティング環境への Takos デプロイの完成度。

## Status の定義

| status        | 意味                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| `ga`          | 本番推奨。schema / packaging / live proof / rollback runbook が release gate 済     |
| `beta`        | operator が明示的に採用可能。主要 artifact と runbook はあるが live proof は opt-in |
| `smoke-only`  | schema / dry-run smoke / artifact reference は検証済。実環境 deploy proof は未完    |
| `unsupported` | 対応ターゲットではない。profile / runbook / validator の対象には含めない            |

default CI では credential-free な proof のみを実行します。provider credential /
cluster / アカウント / public URL が必要な proof は operator 所有の evidence
として別 gate にします。

## マトリクス

| ターゲット   | status        | proof                                                                                                                         | promotion gate                                                                                                        |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `cloudflare` | `beta`        | schema validation / artifact ref / provider fixture proof / dry-run service smoke                                             | takos-private の wrangler 分割、staging deploy proof、`distribution:smoke --live`、provider live proof                |
| `aws`        | `smoke-only`  | schema validation / Terraform / Helm ref / credential-free staging plan gate / provider fixture proof / dry-run service smoke | `values-aws.yaml` での `helm template`、provider live proof、service live smoke                                       |
| `gcp`        | `smoke-only`  | schema validation / Terraform / Helm ref / credential-free staging plan gate / provider fixture proof / dry-run service smoke | `values-gcp.yaml` での `helm template`、provider live proof、service live smoke                                       |
| `kubernetes` | `smoke-only`  | schema validation / Helm chart ref / provider fixture proof / dry-run service smoke                                           | `helm template`、kind / k3d インストール smoke、provider live proof、service live smoke                               |
| `selfhosted` | `smoke-only`  | schema validation / compose ref / provider fixture proof / dry-run service smoke                                              | self-host compose deploy proof、`distribution:smoke --live`、provider live proof、secret rotation runbook の evidence |
| `local`      | `unsupported` | local compose は開発用 runtime。本番ディストリビューションには含めない                                                        | bare metal / VM 本番には `selfhosted` を使う                                                                          |
| `azure`      | `unsupported` | Takosumi 側に provider 開発用の fixture はあるが、Takos プロダクトのディストリビューションは未整備                            | `deploy/distributions/azure.json` / artifact ref / runbook / validator / provider proof を整備した上で promotion      |

## Evidence コマンド

| proof                           | コマンド                                                                                                                                                                                                                 | default gate |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| schema + artifact validation    | `cd takos && deno task validate:distributions`                                                                                                                                                                           | yes          |
| dry-run service smoke metadata  | `cd takos && deno task distribution:smoke --all`                                                                                                                                                                         | yes          |
| ターゲット別 live service smoke | `cd takos && deno task distribution:smoke --manifest deploy/distributions/<target>.json --live`                                                                                                                          | no           |
| provider fixture proof          | `cd takosumi && TAKOSUMI_PLUGIN_LIVE_PROVIDER=<target> TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/<target>.shape-v1.json deno task live-provisioning-smoke`                                      | no           |
| provider live proof             | `cd takosumi && TAKOSUMI_PLUGIN_LIVE_PROVIDER=<target> TAKOSUMI_PLUGIN_LIVE_PROOF_MODE=live TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/<target>.shape-v1.json deno task live-provisioning-smoke` | no           |

## Artifact の所有

Takos プロダクトのディストリビューション artifact は `takos/deploy/`
配下が所有します。AWS と GCP は `takos/deploy/terraform/environments/*-prod` と
`takos/deploy/helm/takos` の overlay を使います。`takosumi/deploy/aws` /
`takosumi/deploy/gcp` は README のみで、Takosumi の provider runbook
用途であり、Takos プロダクトの artifact ディレクトリではありません。

## Promotion ルール

promotion は単調進行です。クラウド認証情報なしで packaging path を render / plan
でき、認証済 operator が live proof を 1 件添付できれば `smoke-only` → `beta`
に上げられます。`beta` → `ga` は、live deploy パス・live service smoke・rollback
もしくは cleanup パス・secret rotation の evidence が揃って初めて可能です。

status は意図的に保守的です。distribution profile が validate を通過しても、live
proof が無ければ `ga` には上げません。
