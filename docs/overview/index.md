# Takos 全体像

Takos は、ユーザーの **Takosumi Account に install して使う AI workspace**
です。 Takos 自身は OAuth provider でも契約主体でもなく、Takosumi Account の
AppInstallation 台帳に install された OIDC consumer app として動きます。
プロダクト UI は kernel に埋め込むのではなく、Takos 上で動く group
として扱います。Store / UI では product label として app
と表示する場合があります。

このページは、`.takosumi/app.yml` / `.takosumi/manifest.yml` や CLI
の詳細に入る前に、「Takos をどの単位で理解すればよいか」を揃える入口です。

## このページで依存してよい範囲

- Takos の全体像
- Takosumi Account / Space / AppInstallation の階層
- 3 install path / 3 runtime mode のサマリ
- docs の読み順
- public 用語と internal 用語の大まかな対応

## このページで依存してはいけない範囲

- backend 固有の lower-level route
- internal table 名
- 個別 API / CLI / manifest の詳細契約

## Takos が扱う基本単位

Installable App Model では、所有権は次の階層で表現されます。 **Takosumi Account
→ Space → AppInstallation** が install boundary、その下に 従来の primitive /
group / resource / route が積まれます。

- **Takosumi Account**: 契約・billing・identity owner。OIDC issuer は service
  identifier `takosumi.account.auth@v1` を anchor で resolve した
  operator-injected endpoint として扱う
- **Space**: Takosumi Account 配下の install scope (`personal` / `team` /
  `org`)。AppInstallation の親
- **AppInstallation**: Takos などの app が install された 1 record。source
  commit / app manifest digest / runtime mode / binding / grant を保持する
  所有権の primitive
- **AppBinding**: AppInstallation に紐づく binding (OIDC / Postgres /
  object-store / domain / GitOps deploy intent / launch token)
- **AppGrant**: AppInstallation に対する capability grant。ユーザーが任意の
  タイミングで revoke 可能
- **RuntimeBinding**: AppInstallation を shared-cell / dedicated runtime に bind
  する record
- **Shape resource**: `worker@v1` / `web-service@v1` / `database-postgres@v1` /
  `custom-domain@v1` などの kernel-bound resource。 AppInstallation の
  `compiledManifestDigest` 経由で takosumi kernel に投下される
- **Group**: primitive を任意に束ねる state scope。所属 primitive は
  inventory、snapshot、rollback、uninstall などの group 機能を使える
- **Workload** (Worker / Service / Attached): deployable unit。内部では
  `services` と Deployment record の `desired` field に保存される
- **Resource**: control-plane managed backing capability (sql / object-store /
  kv / queue / ...)。内部では `resources` に保存され、group 所属の有無で CRUD /
  binding の扱いは変わらない
- **Route**: hostname / path → workload のマッピング
- **App metadata**: launcher / MCP / file handler などの app catalog metadata。
  kernel-bound manifest の `publications[]` ではなく Takos app catalog / runtime
  registry の surface として扱う
- **Cross-instance import**: 外部 service dependency は `.takosumi/manifest.yml`
  の `imports[]` + `serviceResolvers[]` で宣言し、hostname を contract にしない
- **App** (legacy product label): Store / UI 上の product label。Installable App
  Model では `.takosumi/app.yml` の `kind: InstallableApp` を canonical metadata
  単位として扱い、その parser / workflow / manifest compile は `takosumi-git`
  が所有する

## 3 install path

| Path             | 想定ユーザー           | 概要                                                                                        |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| Use Takos        | 一般ユーザー           | Takosumi Account 作成 → shared-cell AppInstallation → launch token で即 chat                |
| Install from Git | 開発者 / 透明性重視    | `takosumi.cloud/install?git=...&ref=...` から install preview → build / deploy              |
| Self-host        | 退出 / 企業 / 主権重視 | export bundle や Git clone から自前の takosumi に install。OIDC issuer は自由に差し替え可能 |

詳細は [Install paths](/apps/install-paths) を参照。

## 3 runtime mode

| Mode        | 概要                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| shared-cell | Takos 公式の prebuilt / warm 済み shared runtime に bind。data namespace / OIDC client / billing は installation ごと |
| dedicated   | 同じ source commit / manifest digest / data namespace を保ったまま専用 runtime に物理化                               |
| self-hosted | installation bundle を取り出し、別 takosumi に import した完全退出状態                                                |

所有権は AppInstallation に固定したまま、runtime だけ差し替えます。詳細は
[Runtime Modes](/architecture/runtime-modes) を参照。

## public と internal の読み分け

Takos Docs では、次の 3 層を分けて読みます。

1. public contract
2. implementation note
3. internal model

採用判断に使うのは `apps/` と `reference/` です。`architecture/` は、Takos
が内側でどう動いているかを理解するための章です。

## 代表的なユースケース

### Takos を install したい人

- `Use Takos` ボタン (managed shared-cell) または
  `takosumi.cloud/install?git=...&ref=...` (Git URL install) を使う
- install preview で permission / cost / source commit / publisher verification
  を確認する
- install 完了後は launch token で chat に直行
- 詳細は [Install paths](/apps/install-paths) と
  [Launch token](/apps/launch-token)

### materialize したい人

- shared-cell で運用していた AppInstallation を専用 runtime に物理化したい人
- Takosumi Accounts の AppInstallation API / UI から source commit / data
  namespace / OIDC binding / domain を保ったまま遷移
- 詳細は [Runtime Modes](/architecture/runtime-modes)

### self-host したい人

- 退出 / 主権 / 企業要件で完全自前運用したい人
- Takosumi Accounts の export API で installation bundle を取り出し、
  `takosumi-git install ./takos.bundle --to https://my-takosumi.example.com`
  で自前 runtime に import する
- OIDC issuer は Keycloak / Authentik / Auth0 / 任意 OIDC に差し替え可能
- 詳細は [Upgrade / Export](/platform/upgrade-export)

### primitive を配備したい人

- deploy manifest (`.takosumi/manifest.yml`) を書く
- workflow artifact を用意する (`.takosumi/workflows/*.yml`)
- workflow / artifact 解決は `takosumi-git` が担当し、kernel には `workflowRef`
  と installer-only placeholder を除いた compiled manifest だけを
  `POST /v1/deployments` で渡す
- operator / debug の direct apply だけ `takosumi` CLI の explicit manifest path
  を使う
- legacy `takos deploy` / `takos install` は compatibility surface
  としてのみ扱う

### space を運用したい人

- deploy dashboard から resources / deploys / installed groups を見る
- default app distribution の product root と installed groups を見分けて
  install / uninstall / replace する

### operator

- space / repo / resource / route の関係を把握する
- rollback / runtime execution context / source provenance を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- Installable App Model の正本は
  [Installable App Model](/architecture/installable-app-model)
- 所有権 ledger は [AppInstallation](/architecture/app-installation)
- OAuth / OIDC issuer の置き場所は
  [Takosumi Accounts](/architecture/takosumi-accounts)
- Takos が OIDC consumer になる立場は [OIDC consumer](/apps/oidc-consumer)
- Takos の product boundary と service set の正本は
  [System Architecture](/architecture/system-architecture)
- kernel 概念と service split の関係は [アーキテクチャ](/architecture/) と
  [Kernel](/architecture/kernel)
- primitive の deploy/runtime contract は [Deploy 構成](/apps/) と
  [デプロイ](/deploy/)
- 用語の canonical ref は [用語集](/reference/glossary)
- CLI / API は [リファレンス](/reference/)
- 実装ステータスと split shell の現状は
  [takosumi Current State](/takosumi/current-state)

## 次に読むページ

- [はじめる](/get-started/)
- [Install paths](/apps/install-paths)
- [Deploy 構成](/apps/)
- [デプロイ](/deploy/)
