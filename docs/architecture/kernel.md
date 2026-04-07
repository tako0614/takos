# Kernel

::: tip Internal implementation
このページは kernel の internal 実装を説明する。
public contract ではない。実装は変更される可能性がある。
public contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。
:::

Takos は AI によるソフトウェア民主化基盤。
kernel は Agent / Chat, Git, Storage, Store, Auth を統合した単一のサービス。
これらは kernel features であり、group ではない。アンインストール不可。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布する基盤。
以下は **kernel features**（常時提供、削除・差し替え不可）:

- **Agent / Chat**: AI との対話でソフトウェアを開発・運用
- **Git**: コード管理
- **Storage**: ファイル管理
- **Store**: app の検索・配布・ActivityPub federation
- **Auth**: 認証・認可
- **Dashboard**: space 管理
- **Deploy / Routing**: group (外部 app) のデプロイと公開
- **Resources**: sql, object-store, key-value 等のリソース管理
- **Billing**: 課金

kernel が持たないもの:

- group 固有の UI
- group 固有の DB schema
- group 固有の queue や background job

## Space

space は Takos の分離単位。法人のようなもの。

- 1 space = 1 tenant
- user は space に所属する
- compute, data, routing が space 単位で分離される
- Space の切り替えは UI / session で行う（domain ではない）

## Primitives と Group (二層モデル)

外部ワークロードは **二層モデル** で構成される:

- **Layer 1: primitive (foundation)** — 1st-class エンティティ。それぞれ独立した
  lifecycle を持つ
  - **compute**: worker / service (常設 container) / attached container
  - **storage**: sql / object-store / key-value / queue / vector-index / secret
    / analytics-engine / workflow / durable-object
  - **route**: hostname/path → compute のマッピング
  - **publish**: 外部 interface の公開情報

- **Layer 2: group (上位 bundling layer)** — 複数の primitive を束ねて、bulk
  lifecycle (snapshot / rollback / uninstall) と desired state management を
  提供する optional な仕組み

primitive は group に所属することも、standalone で存在することもできる。CLI /
API は両層を 1st-class でサポートする (`takos worker` などの primitive 個別
コマンド + `takos deploy` などの group bulk コマンド)。

group は kernel features ではない (agent, git, storage, store は kernel 機能で
あり group ではない)。"app" は group の user-facing な呼び方。manifest のファイル
名は `.takos/app.yml`。

### `.takos/app.yml`

group の desired state を宣言する flat YAML。envelope なし、全 field がトップレベル。

| field | 役割 |
| --- | --- |
| `name` | group 名（routing の hostname に使用） |
| `compute` | worker, container, attached container |
| `storage` | sql, object-store, key-value, queue, vector-index, secret |
| `routes` | path → workload のマッピング |
| `publish` | 外部 interface の公開情報 |

### Default groups

4 つの default group が preinstall される:

- takos-computer
- takos-docs
- takos-excel
- takos-slide

user-facing には "default apps" と呼ぶ。

### Lifecycle

install → deploy → reconcile → rollback → uninstall

kernel は group の bulk lifecycle と standalone primitive の個別 lifecycle を
両方管理する。

## Routing

kernel は `{KERNEL_DOMAIN}` で serve する。
group は routing layer で独自の hostname を持つ:

```text
Kernel ({KERNEL_DOMAIN}):
  /          → chat UI (SPA)
  /api/*     → kernel API
  /auth/*    → OAuth, session
  /settings  → dashboard

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）
```

Cookie は `.{parent-domain}` にセットし kernel と group で共有する。

dispatch が hostname で kernel or group に振り分ける。
group 内に複数 worker がある場合、dispatch が RoutingRecord の path + method で適切な worker を選ぶ。

routing の実装詳細は [Control Plane - Routing layer](./control-plane.md#routing-layer) を参照。

## Resource broker

kernel は compute (worker / service) に storage を binding する。

- sql, object-store, key-value, queue, vector-index, secret, analytics-engine, workflow, durable-object
- storage は space 単位で分離される
- manifest の `storage` で宣言した場合は deploy 時に group の primitive として
  作成される。standalone primitive として CLI / API 経由で個別に作成することも
  できる
- 既存 storage を後から group に所属させることも可能

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Publication と env injection

group が manifest で `publish` を宣言すると、deploy 時に kernel が
**space 内のすべての group の env** に inject する。
publication の必須 field は `type` と `path` の 2 つ。
すべての publication は URL を持つため `path` は必須。

```yaml
# takos-docs の manifest
publish:
  - type: McpServer
    path: /mcp
  - type: UiSurface
    path: /
    title: Docs
```

deploy 時に kernel は:

1. manifest の `publish` を読む
2. publication の URL を解決する（group の hostname + `path`）
3. **space 内のすべての group の env に inject する**（dependency declaration や scoping なし）

```
# space 内のすべての group の env に inject される例（auto hostname を使用）
TAKOS_DOCS_MCPSERVER_URL=https://team-a-docs.app.example.com/mcp
```

kernel features (Agent / Chat, Git, Storage, Store, Auth) は publication ではなく
kernel API として直接提供される。

### Scope enforcement

worker は独立した実行単位であり、kernel は worker 間の通信内容に介入しない。
scope enforcement は受信側 group の責務。

## App token

kernel は deploy 時に group ごとの JWT (RS256) を発行する。

group が `scopes` を宣言すると token が発行され、env に `TAKOS_APP_TOKEN` として inject される。

claims: `sub: group:{name}`, `scope`, `space_id`, `iss: takos-kernel`, `aud: takos-app`

## Dashboard

kernel が `/settings` で提供する space 管理 UI。
kernel SPA の一部として統合。group 一覧、deploy/rollback、resource 管理、member 管理。

## Event bus

kernel は `/api/events` で space 内の group 間イベント通知を提供する。

fire-and-forget。配信保証はない。

kernel が発行するイベント:

- `group.deployed`, `group.deleted`, `group.rollback`, `group.unhealthy`

Event 処理の原則: idempotent, graceful, non-blocking。
