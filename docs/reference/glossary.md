# 用語集

この用語集は、Takos Docs
を読むうえで最低限ぶれやすい語だけを揃えるためのものです。
仕様上の意味を優先し、実装の細部や列挙の網羅はここでは扱いません。

## Docs ラベル

### Current contract

利用者が依存してよい documented public surface。 manifest, CLI, API, example
がこの語で示す対象を優先して読む。

### Implementation note

current contract と実装 wiring の差分を示す注記。
「今日たまたま動くもの」の案内ではなく、差分の説明として読む。

### Public surface

利用者・運用者・組み込み側が直接触る面。 `.takos/app.yml`、`takos` CLI、`/api/*`
family などを含む。

### Internal model

control plane / provider / runtime の内部構造を説明する面。 重要でも public
contract とは限らない。

## 中核概念

### Kernel

Takos の基盤。Agent/Chat, Git, Storage, Store, Auth, Deploy, Routing, Resources, Billing を統合した単一サービス。`{KERNEL_DOMAIN}` で serve。

### Deploy Dashboard

kernel が /settings で提供する space 管理 UI。

### Space

所有・隔離の最上位単位（テナント）。session context で切り替え。

### Installed App

space に deploy された group の user-facing な呼び方。
first-party / third-party を問わず同じ manifest contract に従う。

### Repo

source と workflow artifact の起点。 deploy の source provenance を決める単位。

### Worker

public surface での deployable unit。manifest では `compute.<name>` に `build`
を持つエントリが Worker と判定される。内部管理 API family の正本は `/api/services`。

### Service

常設コンテナ workload。manifest では `compute.<name>` に `image` を持つ
（`build` を持たない）エントリが自動的に Service と判定される。digest pin された
`image` ベースの long-running HTTP service。

### Resource

compute が利用する backing capability。 sql, object-store, key-value, queue,
vector-index, secret, analytics-engine, workflow, durable-object などを
manifest の `storage` で宣言する。

### Binding

compute に resource を渡す名前付き接続。storage 側の `bind:` で env 名を指定すると、
manifest 内の全 compute の env に自動注入される。

## Deploy

### App Manifest (`.takos/app.yml`)

flat manifest の single-document YAML。 compute / storage / routes / publish / OAuth / MCP /
file handler を宣言する current contract。

### Primitive

deploy system の foundation layer。compute (worker / service / attached) /
storage / route / publish の 4 種類があり、それぞれ独立した 1st-class エンティ
ティで、個別の lifecycle を持つ。CLI / API で個別操作できる。

### Group

primitive 群を束ねる **上位 bundling layer**。複数の primitive を 1 つの単位
として扱い、bulk lifecycle (snapshot / rollback / uninstall) と desired state
management を提供する optional な仕組み。manifest deploy は group を作る bulk
wrapper にすぎず、primitive は group に所属することも standalone で存在する
こともできる。kernel features (agent, git, storage, store) は group ではない。
user-facing には「app」と呼ぶ。

### App

group の user-facing な呼び方。独立した概念としては存在しない。

### Publication

group が manifest で宣言する公開情報。必須 field は `type` と `path` の 2 つ（すべての publication は URL を持つ）。deploy 時に kernel が space 内のすべての group の env に inject する（scoping や dependency declaration なし）。kernel features (Agent / Chat, Git, Storage, Store, Auth) は publication ではなく kernel API として直接提供。

### App Deployment

repo/ref から manifest と artifact provenance を束ねて作成される deploy の単位。
public API family は `/api/spaces/:spaceId/app-deployments`。

### Rollout

app deployment を段階的に公開する制御。 pause / resume / abort / promote
の操作を持つ。

### Rollback

前の app deployment へ戻す操作。 データや schema の自動巻き戻しまで意味しない。

### Workflow Artifact

`.takos/workflows/` 配下の workflow が出力する build 成果物。 app deployment
が参照する artifact provenance の正本。

## AI 実行

### Thread

継続する対話や作業コンテキスト。

### Run

thread 上の 1 回の実行。 stream surface を持つ。

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

deploy された app が Takos API を呼ぶための Takos-managed token。 権限は
manifest 側の scope 宣言で制御する。

### OAuth Client

Takos API へアクセスする third-party app の登録単位。

### Scope

OAuth / managed token が要求・付与する権限の粒度。

## 配布と連携

### Store

kernel が提供する app の検索・配布・ActivityPub federation 機能。kernel の一部であり、group ではない。

### Canonical URL

app 自身が所有する正本 URL。 bookmark、share、reload、direct access はこの URL
を使う。

### Launch URL

deploy dashboard から app を開くための URL。

### MCP (Model Context Protocol)

repo や app がツール surface を公開するための主要 protocol。 manifest の
`publish` に `type: McpServer` として宣言する。

### File Handler

storage/file 系 UI から app を開く contract。manifest の
`publish` に `type: FileHandler` として宣言する。

## 実行基盤

### Control Plane

API, deploy, routing, run lifecycle, resource 管理を担当する Takos の制御面。

### Tenant Runtime

deploy された artifact が実際に request を処理する実行面。

### Provider

deploy backend の種類。 Cloudflare と local などの差分は operations /
architecture で扱う。
