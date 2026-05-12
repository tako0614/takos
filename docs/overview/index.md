# Takos 全体像

Takos は **Takosumi PaaS の上で動作する self-hostable な AI-first chat & agent
platform**。`chat / agent / memory / space` を core 機能として持ち、Takos
distribution の bundled apps は新規 Space 作成時に auto-install される。Takos は
Takosumi の unique top consumer であり、Takosumi の一部や architecture 上の 特権
layer ではない。 OAuth provider / 契約主体 / billing owner は operator
が運用する account plane が持ち、 Takos は OIDC consumer として動く。 OIDC
issuer の hostname は operator が選ぶ (managed example は
`accounts.takosumi.cloud` だが、 別 operator distribution に置き換え可能)。
プロダクト UI は kernel に埋め込むのではなく Takos product surface
として提供し、 Store / UI では bundled / third-party app を product label として
app と表示する場合がある。 (identity の正本は
[ecosystem design-principles](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/design-principles.md)
参照)

このページは、`.takosumi/app.yml` / `.takosumi/manifest.yml` や CLI
の詳細に入る前に、「Takos をどの単位で理解すればよいか」を揃える入口です。

## Takos が扱う基本単位

Installable App Model では、所有権は次の階層で表現されます。 **Takosumi Account
→ Space → AppInstallation** が install boundary、その下に 従来の primitive /
group / resource / route が積まれます。

- **Takosumi Account**: 契約・billing・identity owner。OIDC issuer は
  `operator.identity.oidc` namespace export / OIDC discovery から得る
  operator-selected endpoint として扱う
- **Space**: Takosumi Account 配下の install scope (`personal` / `team` /
  `org`)。AppInstallation の親
- **AppInstallation**: bundled / third-party app が install された 1
  record。source commit / app manifest digest / runtime mode / binding / grant
  を保持する 所有権の primitive
- **AppBinding**: AppInstallation に紐づく binding (OIDC / Postgres /
  object-store / domain / GitOps deploy intent / launch token)
- **AppGrant**: AppInstallation に対する capability grant。ユーザーが任意の
  タイミングで revoke 可能
- **RuntimeBinding**: AppInstallation を shared-cell / dedicated runtime に bind
  する record
- **Shape resource**: `worker@v1` / `web-service@v1` / `database-postgres@v1` /
  `custom-domain@v1` などの kernel Shape resource。 AppInstallation の
  `compiledManifestDigest` 経由で takosumi kernel に投下される
- **Group**: primitive を任意に束ねる state scope。所属 primitive は
  inventory、snapshot、rollback、uninstall などの group 機能を使える
- **Workload** (Worker / Service / Attached): deployable unit。内部では
  `services` と Deployment record の `desired` field に保存される
- **Resource**: Takosumi-kernel managed backing capability (sql / object-store /
  kv / queue / ...)。内部では `resources` に保存され、group 所属の有無で CRUD /
  binding の扱いは変わらない
- **Route**: hostname / path → workload のマッピング
- **App metadata**: launcher / MCP / file handler などの app catalog metadata。
  compiled Shape manifest の `publications[]` ではなく Takos app catalog /
  runtime registry の surface として扱う
- **Namespace export**: operator / account plane / billing などの dependency は
  `operator.identity.oidc` / `operator.billing.default` のような Space-visible
  namespace export と explicit grant / account API で扱う。kernel manifest
  には書かない
- **App**: Store / UI 上の product label。Installable App Model では
  `.takosumi/app.yml` の `kind: InstallableApp` を metadata 単位として扱い、その
  parser / workflow / manifest compile は `takosumi-git` が所有する

## 3 install path

| Path             | 想定ユーザー           | 概要                                                                                                                   |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Use Takos        | 一般ユーザー           | Takosumi Account / Space 作成 → bundled apps auto-install → launch token で即 chat                                     |
| Install from Git | 開発者 / 透明性重視    | app repo を operator-selected install UI (managed example: `takosumi.cloud/install?...`) から preview → build / deploy |
| Self-host        | 退出 / 企業 / 主権重視 | Takos product distribution と app export bundle を自前 Takosumi instance に移す                                        |

詳細は [Install paths](/apps/install-paths) を参照。

## 3 runtime mode

| Mode        | 概要                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| shared-cell | Takos 公式の prebuilt / warm 済み shared runtime に bind。data namespace / OIDC client / billing は installation ごと |
| dedicated   | 同じ source commit / manifest digest / data namespace を保ったまま専用 runtime に物理化                               |
| self-hosted | installation bundle を取り出し、別 takosumi に import した完全退出状態                                                |

所有権は AppInstallation に固定したまま、runtime だけ差し替えます。詳細は
[Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
を参照。

## public と internal の読み分け

Takos Docs では、次の 3 層を分けて読みます。

1. public contract
2. implementation note
3. internal model

採用判断に使うのは `apps/` と `reference/` です。`architecture/` は、Takos
が内側でどう動いているかを理解するための章です。

## 代表的なユースケース

### Takos を始めたい人

- operator Accounts の `/start?takos_url=...` に向く `Use Takos` ボタン (managed
  shared-cell) で Takosumi Account / Space を作る
- 新規 Space 作成時に bundled apps が auto-install される
- launch token で chat に直行する
- 詳細は [Install paths](/apps/install-paths) と
  [Launch token](https://github.com/tako0614/takosumi-cloud/blob/master/docs/apps/launch-token.md)

### materialize したい人

- shared-cell で運用していた AppInstallation を専用 runtime に物理化したい人
- operator account plane の AppInstallation API / UI から source commit / data
  namespace / OIDC binding / domain を保ったまま遷移
- 詳細は
  [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)

### self-host したい人

- 退出 / 主権 / 企業要件で完全自前運用したい人
- Takos product distribution は `takos/deploy/` と operator runbook に従って
  deploy し、AppInstallation export bundle は自前 Takosumi instance に import
  する
- OIDC issuer は import 先の Takosumi Accounts。Keycloak / Authentik / Auth0
  等は upstream IdP として接続可能
- 詳細は [Upgrade / Export](/platform/upgrade-export)

### primitive を配備したい人

- deploy manifest (`.takosumi/manifest.yml`) を書く
- workflow artifact を用意する (`.takosumi/workflows/*.yml`)
- workflow / artifact 解決は `takosumi-git` が担当し、kernel には `workflowRef`
  と installer-only placeholder を除いた compiled manifest だけを
  `POST /v1/deployments` で渡す
- operator / debug の direct apply だけ `takosumi` CLI の explicit manifest path
  を使う
- operator / debug の direct apply は `takosumi` CLI の explicit manifest path
  を使う

### space を運用したい人

- deploy dashboard から resources / deploys / installed groups を見る
- bundled app distribution の product root と installed groups を見分けて
  install / uninstall / replace する

### operator

- space / repo / resource / route の関係を把握する
- rollback / runtime execution context / source provenance を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- Installable App Model の正本は
  [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
- 所有権 ledger は
  [AppInstallation](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
- OAuth / OIDC issuer の置き場所は
  [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
- Takos が OIDC consumer になる立場は [OIDC consumer](/apps/oidc-consumer)
- Takos の product boundary と service set の正本は
  [System Architecture](/architecture/system-architecture)
- kernel 概念と service split の関係は [アーキテクチャ](/architecture/) と
  [Kernel](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/kernel.md)
- primitive の deploy/runtime contract は [Deploy 構成](/apps/) と
  [デプロイ](/deploy/)
- 用語の canonical ref は
  [用語集](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/glossary.md)
- CLI / API は [リファレンス](/reference/)
- 実装ステータスと split shell の現状は
  [takosumi Current State](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/index.md)

## 次に読むページ

- [はじめる](/get-started/)
- [Install paths](/apps/install-paths)
- [Deploy 構成](/apps/)
- [デプロイ](/deploy/)
