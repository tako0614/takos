# Kernel

::: tip Internal implementation このページは kernel の internal 実装を説明する。
public contract ではない。実装は変更される可能性がある。public contract は
[manifest spec](/reference/manifest-spec) と [API reference](/reference/api)
を参照。:::

Takos は AI によるソフトウェア民主化基盤。kernel は Agent / Chat, Git, Storage,
Store, Auth を統合した単一のサービス。これらは kernel features であり、group
ではない。アンインストール不可。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布する基盤。以下は **kernel
features**（常時提供、削除・差し替え不可）:

- **Agent / Chat**: AI との対話でソフトウェアを開発・運用
- **Git**: コード管理
- **Storage**: ファイル管理
- **Store**: catalog app / package の検索・配布・ActivityPub federation
- **Auth**: 認証・認可
- **Dashboard**: space 管理
- **Deploy / Routing**: external group のデプロイと公開
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

## Primitive と group

外部ワークロードは **primitive-first deploy model** で構成される:

- **Primitive** — service / deployment / route / publication / resource /
  consume edge などの個別 record
- **Group** — primitive を任意に束ねる state scope。所属 primitive は
  inventory、snapshot、rollback、uninstall などの group 機能を使える
- **Workload** — worker / service (常設 container) / attached
  container。内部では `services` / `deployments` に保存され、consume は各
  compute の中で宣言する
- **Resource** — sql / object-store / key-value / queue / vector-index / secret
  / analytics-engine / workflow / durable-object。内部では `resources`
  に保存され、group 所属の有無で CRUD / runtime binding の扱いは変わらない
- **Route / publication** — hostname/path → workload のマッピングと外部
  interface の公開情報

CLI は manifest / repository / catalog source から primitive declaration を
apply し、API は個別 primitive の管理もサポートする。

group は kernel features ではない (agent, git, storage, store は kernel 機能で
あり group ではない)。"app" は Store / UI 上の product label であり、deploy
model を説明するときは primitive / group を使う。manifest の互換ファイル名は
`.takos/app.yml` / `.takos/app.yaml`。

### `.takos/app.yml` / `.takos/app.yaml`

primitive desired declaration を書く flat YAML。envelope なし、全 field
がトップレベル。ファイル名には `app` が残るが、deploy model では deploy manifest
として扱う。

| field     | 役割                                                          |
| --------- | ------------------------------------------------------------- |
| `name`    | group 名（routing の hostname に使用）                        |
| `compute` | worker, service, attached container (consume は各 compute 内) |
| `routes`  | path → workload のマッピング                                  |
| `publish` | information sharing catalog                                   |

resource 自体は control-plane managed backing capability として扱う。SQL /
object-store / queue などの resource API / runtime binding は publish catalog
と分ける。

### Default app distribution

default app distribution の初期セットは以下の 3 つ。新規 space の bootstrap で
preinstall できるが、operator は別の app set に差し替えられる:

- takos-docs
- takos-excel
- takos-slide

default set に含まれても、primitive や group は特権化されない。

### Lifecycle

install → deploy → reconcile → rollback → uninstall

kernel は group 機能と primitive の個別管理を両方扱う。

## Routing

kernel は `{KERNEL_DOMAIN}` で serve する。group は routing layer で独自の
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

Session cookie は host-only の `__Host-tp_session` として発行する（`Domain`
attribute なし）。kernel と group subdomain では cookie を共有しない。

dispatch が hostname で kernel or group に振り分ける。group 内に複数 worker
がある場合、dispatch が RoutingRecord の path + method で適切な worker を選ぶ。

routing の実装詳細は
[Control Plane - Routing layer](./control-plane.md#routing-layer) を参照。

## Resource broker

kernel は compute に対する resource / publication の解決を行う。

- sql, object-store, key-value, queue, vector-index, secret, analytics-engine,
  workflow, durable-object
- resource は space 単位で分離される
- resource access は resource API / runtime binding で扱う。publish は
  route/interface metadata と Takos capability output に使う

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Publication / Capability grant と env injection

group が manifest で `publish` を宣言すると、deploy 時に kernel が information
sharing catalog を保存し、`compute.<name>.consume` を宣言した consumer にだけ
env を inject する。route publication は manifest の `publisher` + `type` +
`path` を基準とし、Takos capability grant は `publish[].publisher/type` として
保存される。

### route publication

route publication は group が公開する interface の metadata。`type` は custom
string で、core は type の意味を解釈しない。

```yaml
publish:
  - name: tools
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
  - name: docs
    type: UiSurface
    publisher: web
    path: /
    title: Docs
    spec:
      icon: book
```

必須 field:

- `name`
- `publisher`
- `type`
- `path`

### Takos capability grant

Takos capability grant は Takos API key / OAuth client の access output
declaration。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
```

必須 field:

- `name`
- `publisher`
- `type`
- `spec`

`publisher` は `takos`、`type` は Takos publisher type だけを受け付ける。`spec`
は type ごとに required / optional field が変わる。route publication の URL は
assigned hostname と manifest の `path` から生成され、path template は template
URL のまま扱う。Takos capability grant は type が定義する outputs を consumer
ごとに env へ変換する。

deploy 時に kernel は:

1. manifest の `publish` を読む
2. publication catalog を保存する
3. route publication の auto-hostname URL、Takos capability grant の outputs
   を解決する
4. `compute.<name>.consume` を宣言した consumer にだけ env として渡す

kernel features (Agent / Chat, Git, Store, Auth) は publication ではなく kernel
API として直接提供される。

### Scope enforcement

worker は独立した実行単位であり、kernel は worker 間の通信内容に介入しない。
scope enforcement は受信側 group の責務。

## Capability credentials

Takos API access や OAuth client は app-label 専用の特殊機構ではなく capability
grant として扱う。`publish[].publisher/type` として保存する。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
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

kernel は grant outputs を解決するが、consumer が要求していない publication は
inject しない。

## Dashboard

kernel が `/settings` で提供する space 管理 UI。kernel SPA
の一部として統合。group 一覧、deploy/rollback、resource 管理、member 管理。

## Event bus

kernel は `/api/events` で space 内の group 間イベント通知を提供する。

fire-and-forget。配信保証はない。

kernel が発行するイベント:

- `group.deployed`, `group.deleted`, `group.rollback`, `group.unhealthy`

Event 処理の原則: idempotent, graceful, non-blocking。
