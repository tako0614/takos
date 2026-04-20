# 用語集

この用語集は、Takos Docs
を読むうえで最低限ぶれやすい語だけを揃えるためのものです。
仕様上の意味を優先し、実装の細部や列挙の網羅はここでは扱いません。

## Docs ラベル

### Current contract

利用者が依存してよい documented public surface。manifest, CLI, API, example
がこの語で示す対象を優先して読む。

### Implementation note

current contract と実装 wiring の差分を示す注記。
「今日たまたま動くもの」の案内ではなく、差分の説明として読む。

### Public surface

利用者・運用者・runtime 側が直接触る面。`.takos/app.yml` /
`.takos/app.yaml`、`takos` CLI、`/api/*` family などを含む。

### Internal model

control plane / backend / runtime の内部構造を説明する面。重要でも public
contract とは限らない。

## 中核概念

### Kernel

Takos の基盤。Agent/Chat, Git, Storage, Store, Auth, Deploy, Routing, Resources,
Billing を統合した単一サービス。`{KERNEL_DOMAIN}` で serve。

### Deploy Dashboard

kernel が /settings で提供する space 管理 UI。

### Space

所有・隔離の最上位単位（テナント）。session context で切り替え。

### Installed Group

space に deploy された group。Store / UI では app と表示する場合があるが、
deploy model では primitive / group と呼び分ける。

### Repo

source と workflow artifact の起点。deploy の source provenance を決める単位。

### Worker

public surface での deployable unit。manifest では `compute.<name>` に `build`
を持つエントリが Worker と判定される。内部管理 API family は `/api/services`。

### Service

常設コンテナ workload。manifest では `compute.<name>` に `image` を持つ
（`build` を持たない）エントリが自動的に Service と判定される。digest pin された
`image` ベースの long-running HTTP service。

### Resource

compute が利用する backing capability。sql, object-store, key-value, queue,
vector-index, secret, analytics-engine, workflow, durable-object などは control
plane 側の `resources` record として扱う。group 所属の有無で CRUD / binding
の扱いは変わらない。`publish` catalog とは分ける。

### Binding

compute に capability や resource を渡す接続。publication の output を env
として渡す接続は `service_consumes` record として扱い、manifest では
`compute.<name>.consume` に宣言する。resource access は `publish` / `consume`
ではなく resource API / runtime binding 側で扱う。

## Deploy

### Deploy Manifest (`.takos/app.yml` / `.takos/app.yaml`)

flat manifest の single-document YAML。`name` / `compute` / `routes` / `publish`
を宣言する current contract。`.takos/app.yml` が既定の deploy manifest path
で、`.takos/app.yaml` も受け付ける。app catalog ではない。filename には `app`
が残るが、deploy model では primitive desired declaration を書く manifest
として扱う。

### Primitive records

control plane が個別に追跡する実体 record。workload は `services` と
`deployments`、resource は `resources`、公開情報は `publications`、routing は
routing / custom-domain record に保存される。deploy pipeline では publish
catalog と resource API / runtime binding を分ける。

### Group

`groups` row として保存される optional state scope。group 名、source metadata、
current snapshot pointer、reconcile status、inventory を持つ。group に所属する
primitive は inventory、snapshot、rollback、uninstall などの group
機能を使える。kernel features (agent, git, storage, store) は group ではない。

### App

Store / UI 上の product label。deploy model を説明するときは primitive / group /
worker / service / route / publication / resource を使う。

### Publication

space-level の information sharing catalog entry。`publications` record
として保存され、名前は space 内で一意。manifest 由来の publication は primitive
declaration の projection として保存され、API 由来の Takos capability grant は
`source_type=api` として存在できる。

route publication は route primitive から作られる catalog projection
で、`name` + `publisher` + `type` + `path` で表す。`publisher` は対応する
compute target であり、`publisher + path` は manifest の `routes[]` 1
件に一致する必要がある。Takos capability grant は `publisher: takos` と `type` +
`spec` で表す。publication / grant output は `compute.<name>.consume` を宣言した
consumer にだけ env として渡される。ここでの publish は resource creation
ではなく access output の共有を指す。kernel features (Agent / Chat, Git, Store,
Auth) は publication ではなく kernel API として直接提供される。

### Consume

service-level の依存 edge。`service_consumes` record として保存され、service が
publication 名を参照して output を env として受け取る。manifest で管理する
service では deploy 時に `service_consumes` を置き換える。個別 service では
`/api/services/:id/consumes` で直接管理できる。

### Group Deployment Snapshot

source provenance、manifest、artifact、実行 context を保存する group-scoped
immutable snapshot。HTTP API path family は
`/api/spaces/:spaceId/group-deployment-snapshots`。

### Rollout

group snapshot を段階的に公開する制御。pause / resume / abort / promote
の操作を持つ。

### Rollback

前の group snapshot へ戻す操作。データや schema の自動巻き戻しまで意味しない。

### Workflow Artifact

`.takos/workflows/` 配下の workflow が出力する build 成果物。group snapshot
が参照する artifact provenance。

## AI 実行

### Thread

継続する対話や作業コンテキスト。

### Run

thread 上の 1 回の実行。stream surface を持つ。

### Artifact

run の結果物。コード、設定、文書、レポートなどを含む。2 つの保存形式を持つ:

- **inline**: `content` field に文字列として保存 (テキスト系の小サイズ artifact
  向け)
- **file-backed**: `file_id` field に space storage の file ID を参照 (binary
  や大サイズ向け)

両 field は排他ではないが、通常は片方のみ使用される。

## 認証

### PAT (Personal Access Token)

CLI / automation 用の bearer token。

### Managed Token

deploy された group が Takos API を呼ぶための Takos-managed token。権限は
manifest 側の scope 宣言で制御する。

### OAuth Client

Takos API へアクセスする third-party OAuth client の登録単位。

### Scope

OAuth / managed token が要求・付与する権限の粒度。

## 配布と連携

### Store

kernel が提供する app-label / package の検索・配布・ActivityPub federation
機能。kernel の一部であり、group ではない。

### Canonical URL

group 自身が所有する基準 URL。bookmark、share、reload、direct access はこの URL
を使う。

### Launch URL

deploy dashboard から deployed UI を開くための URL。

### MCP (Model Context Protocol)

repo や group がツール surface を公開するための主要 protocol。manifest の
`publish` に `type: McpServer` として宣言する。MCP server catalog は deploy
manifest の `publish` entry で管理する。

### File Handler

storage/file 系 UI から handler UI を開く contract。manifest の `publish` に
`type: FileHandler` として宣言する。FileHandler catalog は deploy manifest の
`publish` entry で管理する。

## 実行基盤

### Control Plane

API, deploy, routing, run lifecycle, resource 管理を担当する Takos の制御面。

### Tenant Runtime

deploy された artifact が実際に request を処理する実行面。

### Backend

deploy backend の種類。Cloudflare と local などの差分は operator-only
configuration / architecture で扱う。public deploy manifest には backend
名を書かない。
