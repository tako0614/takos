# オペレーター向けガイド

> このページでわかること: Takos をオペレーターとして運用するときの全体像。

Takos の認証・課金・アカウント管理は、オペレーターが運用する account plane
(リファレンス: Takosumi Accounts) が担当します。Takos 自体は OIDC consumer
として動くだけで、自前の認証サーバーは持ちません。

- [Takosumi Accounts のアーキテクチャ](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- [Takos 側の OIDC 設定](/apps/oidc-consumer)

## Takos app の構成

`takos/app` は以下の構成です。

- `apps/api`: ブラウザ・API 向けゲートウェイ。セッション管理と Takos product API を提供
- `apps/control`: product-owned internal control backend。account / billing /
  OIDC issuer は持たない

operator docs では Web UI / public API を Takos product の primary surface
として扱います。manifest deploy engine や workflow / git bridge を CLI
で扱う場合は `takosumi` / `takosumi-git` 側の責務です。

## 読む順番

1. [OIDC Setup](/operator/oidc-setup) で admin domain、Takosumi Accounts
   issuer、OIDC callback、secret 経路、および `OIDC_*` env を固定する
2. [Account Model](/operator/account-model) で Takos app-local profile と
   Takosumi Account / OIDC consumer モデルの境界を確認する
3. [Bootstrap](/operator/bootstrap) で初回 operator account を作り、Takosumi
   Accounts bearer と OIDC client を設定する
4. [API Reference](/reference/api) で Accounts bearer / setup API
   の詳細を確認する

新モデルの周辺は次を参照してください。

- [/apps/oidc-consumer](/apps/oidc-consumer) — Takos が OIDC consumer
  として要求する env / route / claim
- [/operator/account-model](/operator/account-model) — Takos app-local profile
  と Takosumi Account / OIDC consumer model の境界
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
