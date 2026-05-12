# Operator

Takos operator 向けの運用入口です。Takos product は Web UI / public API を
primary surface とし、初回セットアップと catalog 管理を扱います。operator
login、PAT、課金は operator が運用する account plane (managed example: Takosumi
Accounts) が owner です。

identity / billing / OIDC issuer は **operator が選んだ account plane**
が担います。 takosumi-cloud の Takosumi Accounts は managed reference の例で、
contract-compatible な 別 operator distribution に置き換え可能です
(`operator.identity.oidc` namespace export / OIDC discovery で得る
operator-configured endpoint を使う)。 Takos は OIDC consumer として 動き、 特定
hostname を contract にしません。 operator はこの境界を意識し、 Takos 自身を
OAuth provider として運用しない構成に揃えてください。

- 新モデル全体像:
  [https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- Takos 側 (OIDC consumer) の env / route:
  [/apps/oidc-consumer](/apps/oidc-consumer)

CLI を primary UX にしません。manifest deploy engine や git/workflow bridge
を直接扱う場合の CLI は `takosumi` / `takosumi-git` の責務です。

## 現在の app 境界

`takos/app` の目標境界は次の通りです。

- `apps/api`: browser / API-facing gateway。trusted edge actor headers、 browser
  session、Takosumi Accounts bearer / OIDC token を検証し、Takos product API /
  UI を serve する。OAuth issuer / account / billing の正本 entrypoint ではない
- `apps/control`: product-owned internal control backend。account / billing /
  OIDC issuer は持たない

operator docs では Web UI / public API を Takos product の primary surface
として扱います。manifest deploy engine や workflow / git bridge を CLI
で扱う場合は `takosumi` / `takosumi-git` 側の責務です。

## 読む順番

1. [OIDC Setup](/operator/oidc-setup) で admin domain、Takosumi Accounts
   issuer、OIDC callback、secret 経路、および `OIDC_*` env を固定する
2. [Account Migration](/operator/account-migration) で旧 Takos local account を
   Takosumi Account / OIDC consumer モデルへ寄せる
3. [Bootstrap](/operator/bootstrap) で初回 operator account を作り、Takosumi
   Accounts bearer と OIDC client を設定する
4. [API Reference](/reference/api) で Accounts bearer / setup API
   の詳細を確認する

新モデルの周辺は次を参照してください。

- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が OIDC consumer
  として要求する env / route / claim
- [/operator/account-migration](/operator/account-migration) — legacy Takos user
  を Takosumi Account へ移行する手順
- [https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — OAuth/OIDC issuer / billing / app installation owner の正本
- [https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  — ecosystem 全体の責務分離

## 原則

- operator の初回操作は Web UI を使う
- automation は Takosumi Accounts で発行した bearer を secret store
  に保存して使う
- deploy 設定や secret の本番操作は `takos-private/` を正本にする
- application の git / workflow / manifest authoring CLI は `takosumi-git`
  に寄せる
- Takosumi kernel の direct CLI は explicit manifest path を受けるだけで、
  `.takosumi/` project convention を持たない
