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

Takos の共通基盤。identity、space、capability、deploy、resource、metering
を扱う。

### Workspace Shell

workspace と infrastructure を見るための最小 UI。 app の launch は行うが、app
自体の canonical UI を所有しない。

### Workspace / Space

所有・隔離の最上位単位。 public surface では `workspace`、internal model では
`space` が主に使われる。

### Installed App

workspace に接続された app。 first-party / third-party を問わず同じ app contract
に従う。

### Repo

source と workflow artifact の起点。 deploy の source provenance を決める単位。

### Worker

public surface での deployable unit。manifest では `spec.workers.*` が current
contract で、内部管理 API family の正本は `/api/services`。

### Service

internal model での実行単位。 public manifest では worker service
がその入口になる。

### Resource

service が利用する backing capability。 D1, R2, KV, Queue などを manifest
で宣言する。

### Binding

service に resource や他 service を渡す名前付き接続。

## Deploy

### App Manifest (`.takos/app.yml`)

`kind: App` の single-document YAML。 service / resource / route / OAuth / MCP /
file handler を宣言する current contract。

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

run の結果物。 コード、設定、文書、レポートなどを含む。

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

default distribution に含まれる first-party catalog app。 package discovery /
recommendation / federation UX を提供するが、kernel 自体ではない。

### Canonical URL

app 自身が所有する正本 URL。 bookmark、share、reload、direct access はこの URL
を使う。

### Shell Launch URL

Takos UI から app を開くための workspace-scoped URL。 shell はここから app を
iframe で開くか redirect するかを決める。

### MCP (Model Context Protocol)

repo や app がツール surface を公開するための主要 protocol。 manifest の
`spec.mcpServers` で宣言する。

### File Handler

storage/file 系 UI から app を開く contract。

## 実行基盤

### Control Plane

API, deploy, routing, run lifecycle, resource 管理を担当する Takos の制御面。

### Tenant Runtime

deploy された artifact が実際に request を処理する実行面。

### Provider

deploy backend の種類。 Cloudflare と local などの差分は operations /
architecture で扱う。
