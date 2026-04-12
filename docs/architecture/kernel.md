# Kernel

::: tip Internal implementation このページは kernel の internal 実装を説明する。
public contract ではない。実装は変更される可能性がある。 public contract は
[manifest spec](/reference/manifest-spec) と [API reference](/reference/api)
を参照。 :::

Takos は AI によるソフトウェア民主化基盤。 kernel は Agent / Chat, Git, Storage,
Store, Auth を統合した単一のサービス。 これらは kernel features であり、group
ではない。アンインストール不可。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布する基盤。 以下は **kernel
features**（常時提供、削除・差し替え不可）:

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
  - **compute**: worker / service (常設 container) / attached container。consume
    は各 compute の中で宣言する
  - **resource**: sql / object-store / key-value / queue / vector-index / secret
    / analytics-engine / workflow / durable-object。public manifest の
    `storage:` は retired/internal history としてのみ扱う
  - **route**: hostname/path → compute のマッピング
  - **publish**: 外部 interface の公開情報

- **Layer 2: group (上位 bundling layer)** — 複数の primitive を束ねて、bulk
  lifecycle (snapshot / rollback / uninstall) と desired state management を
  提供する optional な仕組み

primitive は group に所属することも、standalone で存在することもできる。CLI は
group bulk コマンドを、API は control-plane の internal model をサポートする。

group は kernel features ではない (agent, git, storage, store は kernel 機能で
あり group ではない)。"app" は group の user-facing な呼び方。manifest
のファイル名は `.takos/app.yml`。

### `.takos/app.yml`

group の desired state を宣言する flat YAML。envelope なし、全 field
がトップレベル。

| field     | 役割                                                            |
| --------- | --------------------------------------------------------------- |
| `name`    | group 名（routing の hostname に使用）                          |
| `compute` | worker, container, attached container (consume は各 compute 内) |
| `routes`  | path → workload のマッピング                                    |
| `publish` | 外部 interface の公開情報                                       |

resource / storage の管理は control-plane の internal model で扱い、public
manifest の top-level field には含めない。

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

kernel は `{KERNEL_DOMAIN}` で serve する。 group は routing layer で独自の
hostname を持つ:

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

dispatch が hostname で kernel or group に振り分ける。 group 内に複数 worker
がある場合、dispatch が RoutingRecord の path + method で適切な worker を選ぶ。

routing の実装詳細は
[Control Plane - Routing layer](./control-plane.md#routing-layer) を参照。

## Resource broker

kernel は compute に対する resource / publication の解決を行う。

- sql, object-store, key-value, queue, vector-index, secret, analytics-engine,
  workflow, durable-object
- resource は space 単位で分離される
- public manifest は `storage` ではなく `publish` / `consume` を使う
- standalone resource は control-plane の internal model として扱う

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Publication と env injection

group が manifest で `publish` を宣言すると、deploy 時に kernel が publication
catalog を保存し、`compute.<name>.consume` を宣言した consumer にだけ env を
inject する。 publication は route publication と provider publication の 2 種類
で、必須 field は kind ごとに異なる。

### route publication

route publication は group が公開する interface の metadata。

```yaml
publish:
  - type: McpServer
    path: /mcp
  - type: UiSurface
    path: /
    title: Docs
```

必須 field:

- `type`
- `path`

### provider publication

provider publication は provider-backed credential/env bundle。

```yaml
publish:
  - name: takos-api
    provider: takos
    kind: api
    spec:
      scopes:
        - files:read
```

必須 field:

- `name`
- `provider`
- `kind`
- `spec`

`spec` は kind ごとに required / optional field が変わる。 route publication は
URL を持つ。 provider publication は provider が定義する outputs を consumer
ごとに env へ変換する。

deploy 時に kernel は:

1. manifest の `publish` を読む
2. publication catalog を保存する
3. route publication の URL、provider publication の outputs を解決する
4. `compute.<name>.consume` を宣言した consumer にだけ env として渡す

kernel features (Agent / Chat, Git, Store, Auth) は publication ではなく kernel
API として直接提供される。

### Scope enforcement

worker は独立した実行単位であり、kernel は worker 間の通信内容に介入しない。
scope enforcement は受信側 group の責務。

## Provider-backed credentials

Takos API access や OAuth client、Takos-managed resource access は app-layer
専用の特殊機構ではなく provider publication として扱う。

```yaml
publish:
  - name: takos-api
    provider: takos
    kind: api
    spec:
      scopes:
        - files:read

compute:
  web:
    consume:
      - publication: takos-api
        env:
          endpoint: INTERNAL_TAKOS_API_URL
          apiKey: INTERNAL_TAKOS_API_KEY
```

kernel は provider outputs を解決するが、consumer が要求していない publication
は inject しない。

## Dashboard

kernel が `/settings` で提供する space 管理 UI。 kernel SPA
の一部として統合。group 一覧、deploy/rollback、resource 管理、member 管理。

## Event bus

kernel は `/api/events` で space 内の group 間イベント通知を提供する。

fire-and-forget。配信保証はない。

kernel が発行するイベント:

- `group.deployed`, `group.deleted`, `group.rollback`, `group.unhealthy`

Event 処理の原則: idempotent, graceful, non-blocking。
