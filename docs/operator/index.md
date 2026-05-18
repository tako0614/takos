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
として扱います。AppSpec install / Deployment apply を CLI で扱う場合は
`takosumi` 側の責務です。

## 読む順番

1. [OIDC Setup](/operator/oidc-setup) — admin domain、Takosumi Accounts issuer、
   OIDC callback、secret 経路、`OIDC_*` env を設定する
2. [アカウントモデル](/operator/account-model) — Takos app-local profile と
   Takosumi Account の境界を確認する
3. [初回セットアップ](/operator/bootstrap) — 初回 operator account を作成し、
   Takosumi Accounts bearer と OIDC client を設定する
4. [API リファレンス](/reference/api) — Accounts bearer / setup API の詳細

関連:

- [OIDC Consumer](/apps/oidc-consumer) — Takos が OIDC consumer として要求する
  env / route / claim
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — OAuth/OIDC issuer / billing / app installation owner の責務

## 原則

- 初回操作は Web UI から行う
- automation は Takosumi Accounts で発行した bearer を secret store に保存して使う
- 本番の deploy 設定と secret 操作は `takos-private/` で管理する
- アプリの git / workflow / manifest authoring は `takosumi` を使う
- Takosumi installer API は `.takosumi.yml` AppSpec を扱い、Takos product は
  source discovery convention を持たない
