# Deploy System

::: tip Internal implementation このページは deploy system の internal
実装を説明する。 public contract ではない。実装は変更される可能性がある。 public
contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。`storage` / legacy deploy JWT /
space-wide env injection に関する記述は legacy implementation
の説明であり、現行の public app contract では使わない。 :::

Takos のデプロイシステムは **二層モデル**:

- **Layer 1: primitive (foundation)** — compute / storage / route / publish。
  それぞれ独立した 1st-class エンティティで、個別の lifecycle を持つ。
- **Layer 2: group (上位 bundling layer)** — primitive を束ねて、bulk lifecycle
  と desired state management を提供する optional な上位レイヤー。

primitive は group に所属することも、standalone で存在することもできる。manifest
deploy は「primitive 群を宣言 + group を作る」bulk wrapper にすぎない。

## Manifest format

`.takos/app.yml` は flat YAML。トップレベルに name, compute, routes, publish を
並べる。

```yaml
name: my-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

publish:
  - name: db
    provider: takos
    kind: sql
    spec:
      resource: app-db
      permission: write
  - name: browser
    type: McpServer
    path: /mcp

compute:
  web:
    consume:
      - publication: db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY

routes:
  - target: web
    path: /
```

envelope (`apiVersion` / `kind` / `metadata` / `spec`) は無い。全 field
がトップレベル。

## Compute

`compute` は deployable workload を宣言する。3 形態があり、field
の組み合わせで自動判定される。

| 形態                  | 判定条件                     | 動作                         |
| --------------------- | ---------------------------- | ---------------------------- |
| **Worker**            | `build` あり                 | serverless、request-driven   |
| **Service**           | `image` あり（`build` なし） | 常設、always-on container    |
| **Worker + Attached** | `build` + `containers` あり  | worker に container が紐づく |

### Worker

`build` がある = Worker。serverless で request-driven。

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

### Service（常設コンテナ）

`image` がある（`build` なし） = Service。always-on の long-running container。

```yaml
compute:
  inference:
    image: ghcr.io/my-org/ml-model@sha256:abc123
    port: 3000
```

Service は常時起動し、HTTP request を受け付ける。Worker と違い request
がなくても動作する。

### Worker + Attached container

`build` + `containers` がある = Worker に container が紐づく。 container は
namespace binding 経由で worker から参照される。

```yaml
compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: api
        artifactPath: dist/worker
    containers:
      renderer:
        image: ghcr.io/my-org/renderer@sha256:def456
```

### depends

compute 間の起動順序を `depends` で宣言する。depends は各 compute に書く。

```yaml
compute:
  api:
    build: ...
    depends: [db]
  worker:
    build: ...
    depends: [db, cache]
```

deploy pipeline は depends の DAG に沿って topological order で apply する。

### healthCheck

`healthCheck` は **Service / Attached container のみ** で設定できる。 Worker は
request-driven のため manifest で health check を宣言しない （Worker の
readiness は kernel が deploy 時に simple HTTP probe で判定する）。

```yaml
compute:
  inference:
    image: ghcr.io/my-org/ml-model@sha256:abc123
    port: 3000
    healthCheck:
      path: /health
      interval: 30 # 秒
      timeout: 5 # 秒
      unhealthyThreshold: 3
```

| field                | required | default | 説明                             |
| -------------------- | -------- | ------- | -------------------------------- |
| `path`               | no       | /health | HTTP GET を送る path             |
| `interval`           | no       | 30      | チェック間隔（秒）               |
| `timeout`            | no       | 5       | レスポンス待ちタイムアウト（秒） |
| `unhealthyThreshold` | no       | 3       | 連続失敗でunhealthy とみなす回数 |

### scaling

compute の scaling を設定する。

```yaml
compute:
  api:
    image: ghcr.io/my-org/api@sha256:abc123
    port: 8080
    scaling:
      minInstances: 1
      maxInstances: 10
```

| field          | required | default | 説明             |
| -------------- | -------- | ------- | ---------------- |
| `minInstances` | no       | 0       | 最小インスタンス |
| `maxInstances` | no       | -       | 最大インスタンス |

### triggers

compute に対して cron schedule を設定する。

```yaml
compute:
  batch:
    build: ...
    triggers:
      schedules:
        - cron: "0 * * * *" # 毎時実行
```

| field (schedules) | required | 説明    |
| ----------------- | -------- | ------- |
| `cron`            | yes      | cron 式 |

`triggers.queues` は retired。queue 連携は queue publication を consume
する通常の compute として扱う。

## Provider-backed resources

現行の public contract では stateful resource も provider publication
として宣言する。

| provider/kind            | outputs              |
| ------------------------ | -------------------- |
| `takos/sql`              | `endpoint`, `apiKey` |
| `takos/object-store`     | `endpoint`, `apiKey` |
| `takos/key-value`        | `endpoint`, `apiKey` |
| `takos/queue`            | `endpoint`, `apiKey` |
| `takos/vector-index`     | `endpoint`, `apiKey` |
| `takos/analytics-engine` | `endpoint`, `apiKey` |

```yaml
publish:
  - name: db
    provider: takos
    kind: sql
    spec:
      resource: app-db
      permission: write
```

### migration

SQL migration の運用は provider 実装に依存する。現行の public manifest contract
に は `storage.db.migrations` のような field はない。

## Routes

`routes` は hostname/path → compute のマッピング。

```yaml
routes:
  - target: web
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
  - target: web
    path: /
```

hostname は routing layer で管理:

- auto hostname: `{space-slug}-{name}.{TENANT_BASE_DOMAIN}`
- custom slug: `{slug}.{TENANT_BASE_DOMAIN}`
- custom domain: 任意（DNS 検証 + SSL）

## Publish

`publish` は公開メタデータまたは provider-backed output contract。env へは
`compute.<name>.consume` を宣言した consumer にだけ inject される。

```yaml
publish:
  - type: McpServer
    path: /mcp
  - type: UiSurface
    path: /
    title: Docs
```

→ explicit consume の env: `PUBLICATION_{NAME}_URL=https://{hostname}/{path}`

## Output mapping

現行 contract では auto binding は無く、consumer が output ごとに env
名を決める。

```yaml
compute:
  web:
    consume:
      - publication: db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
```

alias を省略した場合は provider の default env 名が使われる。

## CLI

CLI surface も二層モデルに沿って primitive と group を両方持つ。

### group bulk operations (manifest 経由)

```bash
takos deploy              # manifest の全 primitive を group として deploy
takos deploy --plan       # 差分プレビュー（non-mutating）
takos install             # catalog から group を space に install
takos rollback GROUP_NAME # group 単位の rollback
takos uninstall GROUP_NAME
takos group list          # group inventory
takos group show NAME
```

### primitive 個別操作

primitive は個別に作成・更新・削除できる。group に所属させない場合、それぞれが
独立した lifecycle unit になる。compute (worker / service) / route (custom
domain) の個別 CRUD は `/api/services/*` HTTP API 経由で行う。storage primitive
の CRUD / binding / data plane / secret 操作は `takos resource`
サブコマンドが提供する。

```bash
# storage (resource) の管理
takos resource list
takos resource create --body '{"name":"my-db","type":"sql","space_id":"ws_xxx"}'
takos resource view res_xxx
takos resource attach my-db --group my-app      # group 所属
takos resource detach my-db                      # group 解除

# binding (storage を compute に紐付け)
takos resource bind res_xxx --service svc_abc123

# data plane / secret 操作
takos resource sql <subcommand>       # SQL data plane (tables / query / export)
takos resource object <subcommand>    # object-store data plane
takos resource kv <subcommand>        # KV data plane
takos resource get-secret app-secret
takos resource rotate-secret app-secret

# compute / route は HTTP API を直接呼び出す
curl -X POST /api/services ...
curl -X POST /api/services/:id/custom-domains ...
```

CLI の詳細は [CLI リファレンス](/reference/cli) を参照。

既存 standalone primitive を後から group に所属させたい場合は
`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group` を呼ぶ。

## Primitive と group の関係

primitive (compute / storage / route / publish) は **1st-class エンティティ**
で、 それぞれ独立した lifecycle を持つ。group はその上にある **bundling layer**
で、 複数の primitive を束ねて bulk lifecycle (snapshot, rollback, uninstall) と
desired state management を提供する optional な仕組み。

- primitive は group に所属することも、standalone で存在することもできる
- group は kernel が追跡する bulk lifecycle unit。standalone primitive
  はそれぞれ単独の lifecycle unit
- manifest deploy は「primitive 群を宣言 + group を作る」bulk wrapper
- 既存の primitive を後から group に所属させることも可能
  (`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group`)

```
group "my-app" (bundling layer):
  compute: web    ┐
  publish: db     │ group の lifecycle で一括管理
  publish: files  │ (snapshot / rollback / uninstall)
  route: app      ┘

standalone primitive (group に属さない、それぞれ独立 lifecycle):
  compute: cron-job
  publish: shared-cache
  route: legacy-redirect
```

## Deploy pipeline

個別操作も manifest 操作も、同じ内部 pipeline を通る。

```
1. Desired state の生成
   - 個別: CLI の引数から
   - manifest: app.yml を parse して

2. Diff（現在の state と比較）

3. Apply（topological order）
   - storage → compute → routes → publish
   - per-compute depends で順序を制御

4. Binding injection
   - storage の bind: → 全 compute の env に inject
   - publish → space 内の全 group の env に inject（scoping なし）

5. Routing update
   - RoutingRecord を upsert
```

## Rollback

deploy は snapshot を持つ。rollback は snapshot を再適用する。

- code + config + bindings が戻る
- DB data は戻らない（forward-only migration）
- 個別 worker の rollback は deployment history から

## App Lifecycle

Group の install / update / rollback は Git repo と連携して動作する。

### Install

```bash
takos install owner/repo            # latest release から deploy
takos install owner/repo@v1.2.0    # 特定 version
```

1. Git repo の release/tag を解決
2. release に含まれる manifest を fetch
3. 通常の deploy pipeline で deploy
4. group に source repo と installed version を記録

### Update / Pin（design only / not in current CLI surface）

::: warning `takos update` / `takos pin` / `takos unpin` / `takos config` は
**current CLI surface には含まれません**（design only）。新しい release
を反映したい場合は `takos deploy URL --ref <new-ref>` または
`takos install owner/repo@<new-version>` を再実行してください。 :::

design 上の動作は次のとおり:

1. group の source repo と installed version を読む
2. Git repo の最新 release を確認
3. 新しい release があれば manifest を fetch → deploy
4. 前の deployment を snapshot として保持

### Version

Git tag が version の正本。manifest の `version` field は display 用。

```yaml
name: my-app
version: "1.2.0" # display 用。Git tag と一致させる慣習
```

### Source tracking

group は source 情報を持つ:

- `local`: takos deploy で手元から deploy
- `repo:owner/repo@v1.2.0`: takos install で repo から deploy

どちらの source の group も、新しい code を反映するには `takos deploy`
を再実行する。 （`takos update` / `takos pin` は current CLI surface
には含まれない。design only。）

## まとめ

```
Takos deploy system (二層モデル):

  Layer 2: group (上位 bundling layer)
    ↑ primitive を束ねて bulk lifecycle / desired state を提供
    ↑ optional — primitive は group なしでも存在できる

  Layer 1: primitive (foundation / 1st-class)
    - compute (worker / service / attached)
    - storage (sql / object-store / kv / queue / vector / secret / ...)
    - route
    - publish

  CLI surface:
    - primitive 個別: takos resource (+ /api/services/* HTTP API for compute/route)
    - group bulk:    takos deploy / install / rollback / uninstall
```

すべての primitive は kernel data model 上で独立して存在する。manifest と group
は primitive 群を束ねて扱うための上位レイヤーであり、必須ではない。
