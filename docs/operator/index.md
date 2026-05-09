# Operator

Takos operator 向けの運用入口です。Takos product は Web UI / public API を
primary surface とし、初回セットアップ、operator login、PAT、課金、catalog
管理は Takos app から扱います。

Installable App Model 移行後、identity / billing / OIDC issuer の正本は
**Takosumi Accounts** です。Takos は service identifier
`takosumi.account.auth@v1` を anchor で resolve した issuer を consume し、 特定
hostname を contract にしません。operator はこの境界を意識し、Takos 自身を OAuth
provider として運用しない構成に揃えてください。

- 新モデル全体像:
  [/architecture/takosumi-accounts](/architecture/takosumi-accounts)
- Takos 側 (OIDC consumer) の env / route:
  [/apps/oidc-consumer](/apps/oidc-consumer)

CLI を primary UX にしません。manifest deploy engine や git/workflow bridge
を直接扱う場合の CLI は `takosumi` / `takosumi-git` の責務です。Takos product
側の CLI は互換・補助用途に限定し、新しい operator bootstrap
導線として増やさないでください。

## 現在の app 境界

`takos/app` の目標境界は次の通りです。

- `apps/api`: browser / API-facing gateway。trusted edge actor headers、 browser
  session、PAT、Takosumi Accounts 発行の OIDC token を検証し、Takos product API
  / UI を serve する。OAuth issuer / account / billing の正本 entrypoint
  ではない
- `apps/control`: migration window 中だけ残る legacy compatibility backend。
  既存 login / OAuth state / account / billing 実装は Takosumi Accounts へ抽出
  移管し、Takos 側では proxy / migration shim 以上に拡張しない

operator docs では Web UI / public API を Takos product の primary surface
として扱います。manifest deploy engine や workflow / git bridge を CLI
で扱う場合は `takosumi` / `takosumi-git` 側の責務です。

## 読む順番

1. [OIDC Setup](/operator/oidc-setup) で admin domain、Takosumi Accounts
   issuer、OIDC callback、secret 経路、および `OIDC_*` env を固定する
2. [Bootstrap](/operator/bootstrap) で初回 operator account を作り、Web UI から
   PAT を発行し、Takosumi Accounts 経由の OIDC client を設定する
3. [API Reference](/reference/api) で PAT / setup API の詳細を確認する

新モデルの周辺は次を参照してください。

- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が OIDC consumer
  として要求する env / route / claim
- [/architecture/takosumi-accounts](/architecture/takosumi-accounts) —
  OAuth/OIDC issuer / billing / app installation owner の正本
- [/architecture/installable-app-model](/architecture/installable-app-model) —
  ecosystem 全体の責務分離

## 原則

- operator の初回操作は Web UI を使う
- automation は Web で発行した PAT を secret store に保存して使う
- deploy 設定や secret の本番操作は `takos-private/` を正本にする
- application の git / workflow / manifest authoring CLI は `takosumi-git`
  に寄せる
- Takosumi kernel の direct CLI は explicit manifest path を受けるだけで、
  `.takosumi/` project convention を持たない
