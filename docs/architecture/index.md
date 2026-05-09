# アーキテクチャ

Takos は AI によるソフトウェア民主化基盤。Installable App Model (Git-installed
Materializable App Model) のもとで、Takos 自身は Takosumi Account に install
される OIDC consumer app として動きます。OAuth provider / billing は Takosumi
Accounts に集約し、takosumi kernel は compute-only を保ちます。

## Installable App Model 章 (5 page)

Takos の最上位構造は、次の **5 page** で全体像が掴めます (entity 数の "5"
と偶然一致しますが、ここで列挙しているのはこの section が指す **page 数**
です)。先にここを読むのが推奨です。

- [Installable App Model](./installable-app-model.md) — Git-installed
  Materializable App Model の正本。責務分離と全体図
- [Takosumi Accounts](./takosumi-accounts.md) — OIDC issuer / billing owner /
  app installation owner の正本
- [AppInstallation](./app-installation.md) — 所有権 ledger と AppBinding /
  AppGrant / RuntimeBinding / InstallationEvent
- [Runtime Modes](./runtime-modes.md) — shared-cell / dedicated / self-hosted
  の遷移
- [Installer Pipeline](./installer-pipeline.md) — takosumi-git の Git URL
  install pipeline (fetch → app.yml parse → workflow run → manifest compile →
  kernel deploy)

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布するための統合基盤。

Takos product service set が提供する user-facing feature は次の通りです。
このうち takosumi kernel が持つのは manifest apply / routing projection /
resource provisioning / provider reconciliation だけです。

- **Agent / Chat**（AI の中核体験）
- **Git**（コード管理）
- **Storage**（ファイル管理）
- **Store**（配布 / カタログ）
- **Deploy**（takosumi kernel の manifest apply engine）
- **Routing**（takosumi kernel の hostname / path → workload projection）
- **Resources**（takosumi kernel の sql / object-store / kv / queue
  provisioning）

takosumi kernel が **持たないもの**:

- **Auth / OIDC issuer** → [Takosumi Accounts](./takosumi-accounts.md)
  (`takosumi.account.auth@v1` を anchor resolve した operator endpoint) が担当
- **Billing** → Takosumi Cloud billing が担当 (請求主体は Takosumi Account)
- **App marketplace / workflow / cron / consent screen** → takosumi-git および
  takosumi-cloud 側が担当
- **Agent / Chat / Git / Storage / Store** → Takos product service / app feature
  であり、takosumi kernel feature ではない

これは Installable App Model の根幹原則です。kernel に identity / billing を
混ぜると compute substrate の純粋性が死ぬので、絶対に再導入しないでください。

外部ワークロードは authoring/API surface では **primitive-first deploy model**:

- **primitive**: service / deployment / route / publication / resource / consume
  edge などの authoring/API projection
- **group**: primitive を任意に束ねる state scope。所属 primitive は inventory、
  snapshot、rollback、uninstall などの group 機能を使える
- **manifest**: primitive desired declaration の入力。group 専用形式ではない
- **resource**: SQL / object-store / queue などの backing capability。group
  所属の有無で resource CRUD / runtime binding の扱いは変わらない

## Internal model

control plane / runtime の内部構造は、Installable App Model の sibling として
次のように並びます。

- **takosumi kernel**: kernel の実装（manifest deploy engine、provider DAG、
  outputs resolver、idempotent apply）。OAuth / billing / account を持たない
- **takosumi-git**: installer / manifest compiler / GitOps deploy bridge。 Git
  URL fetch、`.takosumi/app.yml` parse、`.takosumi/workflows/*.yml` run、
  artifact resolve、binding 注入、manifest compile、kernel への deploy を担う
- **Takosumi Accounts**: takosumi-cloud の account plane。OIDC issuer
  (`takosumi.account.auth@v1`)、upstream IdP broker (Google / GitHub / Passkey /
  Enterprise OIDC)、billing account、team / org owner
- **AppInstallation ledger**: 所有権の primitive 台帳。Takosumi Account → Space
  → AppInstallation の階層と、serviceImports metadata / AppBinding / AppGrant /
  RuntimeBinding / InstallationEvent を持つ
- **control plane**: kernel の API, DB, deploy pipeline, routing 実装
- **tenant runtime**: group の実行面（dispatch, worker, container）

## Backend

- Cloudflare: tracked reference Workers backend (固有用語の対応は
  [Glossary - Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
  を参照)
- local: 検証用 backend
- backend / adapter で backend 差分を閉じ込める。backend 名は operator-only
  configuration で、public deploy manifest には書かない

## SoT 参照

- Installable App Model 正本:
  [Installable App Model](./installable-app-model.md)
- 所有権 ledger: [AppInstallation](./app-installation.md)
- OIDC issuer / billing: [Takosumi Accounts](./takosumi-accounts.md)
- runtime mode: [Runtime Modes](./runtime-modes.md)
- installer pipeline: [Installer Pipeline](./installer-pipeline.md)
- service set / repository boundary:
  [System Architecture](./system-architecture.md)
- meta-object / Deployment / ProviderObservation / GroupHead などの Core 定義:
  [Core Contract v1.0](/takosumi/core/01-core-contract-v1.0)
- 実装 split status: [takosumi Current State](/takosumi/current-state)
- `.takosumi/app.yml` (installer-bound):
  [`.takosumi/app.yml` Spec](/reference/app-yml-spec)
- `.takosumi/manifest.yml` (kernel-bound):
  [Manifest Reference](/reference/manifest-spec)
- binding catalog: [Binding Catalog](/reference/binding-catalog)
- install API: [Install API](/reference/install-api)
- 用語と canonical ref: [Glossary](/reference/glossary)

## 詳細ページ

- [Takos System Architecture](./system-architecture.md) — Takos 全体の service /
  repository boundary と相互関係
- [Kernel](./kernel.md) — takosumi kernel の compute-only
  な定義、routing、publication
- [Deploy System](./deploy-system.md) — primitive と group 機能の deploy
  pipeline
- [Publication / Consume](./app-publications.md) — publication の仕組みと env
  injection
- [Control Plane](./control-plane.md) — API, DB, routing layer
- [Tenant Runtime](./tenant-runtime.md) — dispatch, worker execution, container
- [互換性と制限](./compatibility.md) — backend parity
