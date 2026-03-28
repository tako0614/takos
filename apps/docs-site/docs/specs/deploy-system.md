# Deploy System

Revision: 2026-03-27 current
Status: current public contract with implementation note

Takos の current deploy system は、**repo/ref から app deployment を作る** 方式です。
旧 docs の build/publish/promote 三段階モデルは現行 surface ではありません。

## このページで依存してよい範囲

- repo/ref + `.takos/app.yml` + workflow artifact という deploy contract
- `takos deploy` と `/api/spaces/:spaceId/app-deployments` family
- `takos deploy-group` による group deploy と resource provisioning
- validation / rollout / rollback の意味
- container host 自動生成と CF Containers ライフサイクル
- テンプレート変数の解決タイミングと注入フロー
- dispatch namespace ターゲティング
- `--wrangler-config` による直接デプロイ

## このページで依存してはいけない範囲

- `POST /api/services/:id/deployments` などの lower-level deploy route を primary contract とみなすこと
- bundle 単体 deploy を repo-local app deploy の説明に持ち込むこと
- `build` / `publish` / `promote` の旧 CLI を現行モデルとして読むこと

## implementation note

2026-03-27 時点では、public contract としての `app-deployments` family は docs / CLI / route registration に存在しますが、app deployment の主要 service メソッドはまだ end-to-end で接続されていません。

利用者にとって重要なのは次の区別です。

- repo-local app deploy の **採用面** は `app deployment`
- 今日の実装で完全に置き換わっていない **内部 fallback** は worker/service 単位の lower-level deployment

つまり、Takos が将来どの面を正本にしたいかはこのページに従い、今日の実装差分は compatibility gap として読む必要があります。
lower-level route を public contract に昇格させるわけではありません。

## deploy が入力に取るもの

app deploy は次を入力に取ります。

- target space
- repo ID
- ref (`branch`, `tag`, `commit`)
- repo 内の `.takos/app.yml`
- manifest が参照する workflow artifact

## deploy の考え方

Takos における deploy の最小単位は、worker bundle 単体ではありません。
app deployment は、manifest と artifact provenance を束ねた app-level mutation です。

そのため deploy の結果には、少なくとも次が含まれます。

- app metadata
- service / route / hostname
- resource inventory
- OAuth / MCP / file handler の reconcile
- app deployment record

## Group Deploy

`takos deploy-group` は、`.takos/app.yml` を読み込んで resource provisioning から worker / container deploy、secrets 注入、テンプレート変数解決までを一括実行するコマンドです。

### 内部フロー

```text
app.yml 読み込み
  ↓
Resource Provisioning
  - D1: Cloudflare D1 API で作成（既存なら再利用）
  - R2: Cloudflare R2 API で作成
  - KV: Cloudflare KV API で作成
  - secretRef (generate: true): ランダムトークンを生成（randomBytes(32).toString('hex')）
  ↓
Worker デプロイ
  - wrangler.toml を動的生成（generateWranglerConfig）
  - resource binding を注入（D1 の database_id / R2 の bucket_name / KV の namespace id）
  - CF Containers がある場合: [[containers]] + [[durable_objects]] セクション追加
  - wrangler deploy で実行
  ↓
Container デプロイ（CF Containers）
  - worker に紐づく container: wrangler config に含まれて一緒にデプロイ
  - container host エントリポイント自動生成（@cloudflare/containers の Container クラス）
  - Durable Object + migrations を自動設定
  ↓
Secrets 設定
  - secretRef の値を wrangler secret put で注入
  ↓
テンプレート変数解決
  - env.inject のテンプレートをデプロイ結果で解決
  - 解決した値を wrangler secret put で各 worker に注入
```

### CLI オプション

```bash
# 基本
takos deploy-group --env staging

# dispatch namespace 指定
takos deploy-group --env staging --namespace takos-staging-tenants

# dry-run
takos deploy-group --manifest .takos/app.yml --env production --dry-run

# 特定の worker / container のみデプロイ
takos deploy-group --env staging --worker web --worker api
takos deploy-group --env staging --container browser

# wrangler.toml 直接デプロイ
takos deploy-group --wrangler-config wrangler.toml --env staging --namespace takos-staging-tenants

# グループ名上書き / base domain 指定
takos deploy-group --env staging --group my-app --base-domain my-app.example.com
```

### Resource Provisioning

group deploy の最初のステップで、manifest の `spec.resources` に宣言されたリソースを Cloudflare API で作成します。

リソース名は `{groupName}-{env}-{resourceName}` の形式で Cloudflare 側に作成されます。binding 名は manifest の `binding` field を使い、省略時は `UPPER_SNAKE_CASE(resourceName)` に変換されます。

| リソース種別 | API | 結果 |
|---|---|---|
| `d1` | `POST /d1/database` | `database_id` (UUID) を取得 |
| `r2` | `POST /r2/buckets` | bucket 名を ID として使用 |
| `kv` | `POST /storage/kv/namespaces` | namespace `id` を取得 |
| `secretRef` | ローカル生成 | `randomBytes(32).toString('hex')` で生成 |

provisioned な resource は `Map<string, ProvisionedResource>` に保持され、後続の wrangler config 生成で binding として注入されます。

`--worker` / `--container` フィルタ指定時は、対象 worker が参照する resource のみ provisioning 対象になります。

## Container Host 自動生成

worker に `containers` 参照がある場合、deploy system は CF Containers に必要な設定を自動生成します。

### 生成される構成要素

container 名が `browser` の場合を例にとると:

| 項目 | 生成値 |
|---|---|
| Durable Object クラス名 | `BrowserContainer` (`{PascalCase(containerName)}Container`) |
| binding 名 | `BROWSER_CONTAINER` (`{UPPER_SNAKE(containerName)}_CONTAINER`) |
| wrangler.toml セクション | `[[containers]]` + `[[durable_objects.bindings]]` |
| migration | `[[migrations]]` に `new_classes: ["BrowserContainer"]` |
| ホストエントリポイント | `index.js` を一時ディレクトリに生成 |

### 自動生成されるホストエントリポイント

standalone container の場合、以下の最小限の `index.js` が一時ディレクトリに生成されます。

```js
import { Container } from '@cloudflare/containers';

export class BrowserContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5 minutes';

  async onStart() {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.BROWSER_CONTAINER.idFromName('default');
    const stub = env.BROWSER_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
```

### 自動生成される wrangler.toml セクション

```toml
name = "browser"
main = "index.js"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "BROWSER_CONTAINER"
class_name = "BrowserContainer"

[[containers]]
class_name = "BrowserContainer"
image = "./Dockerfile"
image_build_context = "."
instance_type = "basic"
max_instances = 10

[[migrations]]
tag = "v1"
new_classes = ["BrowserContainer"]
```

### worker に紐づく container の場合

worker の `containers` に名前が列挙されている場合、container の `[[containers]]` / `[[durable_objects.bindings]]` / `[[migrations]]` セクションは worker の wrangler.toml に統合されます。この場合、standalone 用のホストエントリポイントは生成されず、worker 自身の `main` がエントリポイントになります。

## containers と workers の関係

manifest には `containers` と `workers` を独立して定義し、worker の `containers` field で紐づけます。

```text
containers セクション
  ├── browser (Dockerfile 定義)
  └── executor (Dockerfile 定義)

workers セクション
  ├── browser-host
  │   └── containers: [browser]  ← CF Containers として紐づけ
  └── executor-host
      └── containers: [executor]

routes セクション
  ├── browser-api → target: browser-host
  └── executor-api → target: executor-host
```

container の deploy 方式は worker との紐づけによって決まります。

| 関係 | deploy 方式 | ライフサイクル |
|---|---|---|
| container が worker に紐づく | CF Containers（worker の wrangler config に統合） | Durable Object ライフサイクル管理 |
| container が worker に紐づかない | standalone container（ホストエントリポイント自動生成） | VPS ライクな常設コンテナ |

- worker に紐づく container は、worker の Durable Object として管理されます。`sleepAfter` などの CF Containers ライフサイクル制御が適用されます。
- worker に紐づかない standalone container は、自動生成されたホストエントリポイントで独立してデプロイされます。
- `ipv4: true` は standalone container（常設コンテナ）のみに意味があります。

## テンプレート変数の解決タイミング

manifest の `spec.env.inject` にはテンプレート変数を記述でき、deploy 結果から値を解決して各 worker に注入します。

### テンプレート構文

テンプレートは `${{ expression }}` の形式で記述します。`expression` はドット区切りのパスです。

```yaml
spec:
  env:
    inject:
      PUBLIC_URL: "${{ routes.web.url }}"
      DB_ID: "${{ resources.main-db.id }}"
```

### 解決タイミング

```text
Parse time:
  - テンプレート参照の構文検証
  - 参照先（routes/containers/workers/resources）の存在検証

Deploy time:
  - Resource provisioning 後: resource ID が確定
  - Worker deploy 後: worker URL が確定
  - Route setup 後: domain + path が確定
  - Container deploy 後: IPv4 が確定（常設の場合）
  ↓
  resolveTemplates() で全テンプレートを解決
  ↓
  解決した値を wrangler secret put で各 worker に注入
```

### 参照可能なコンテキスト

テンプレートから参照可能な値は以下の 4 カテゴリです。

| カテゴリ | パス例 | 値 |
|---|---|---|
| `routes` | `routes.web.url`, `routes.web.domain`, `routes.web.path` | deploy 後の URL / domain / path |
| `containers` | `containers.browser.ipv4` | standalone container の IPv4 アドレス |
| `workers` | `workers.api.url` | worker の URL |
| `resources` | `resources.main-db.id` | provisioned resource の ID |

### 注入方法

解決された値は、deploy 済みの全 worker に対して `wrangler secret put` で注入されます。各テンプレートキーが secret 名になります。

## Dispatch Namespace ターゲティング

`--namespace` を指定すると、worker は Cloudflare の dispatch namespace 内にデプロイされます。

### 動作の変更点

| 項目 | namespace なし | namespace あり |
|---|---|---|
| worker 名 | `{workerName}` | `{groupName}-{workerName}` |
| service binding の参照先 | `{targetName}` | `{groupName}-{targetName}` |
| wrangler.toml | 通常 | `dispatch_namespace` field が追加 |

### 生成される wrangler.toml の差分

```toml
# --namespace takos-staging-tenants の場合
name = "my-app-web"
main = "dist/worker"
compatibility_date = "2025-01-01"
dispatch_namespace = "takos-staging-tenants"

[[services]]
binding = "API"
service = "my-app-api"
```

dispatch namespace は、マルチテナント環境で worker を論理的に分離する仕組みです。namespace 内の worker 同士は `{groupName}-{workerName}` 形式の名前で service binding を通じて通信します。

## Wrangler Config 直接デプロイ

`--wrangler-config` を指定すると、app.yml をバイパスして既存の `wrangler.toml` を直接デプロイします。

```bash
takos deploy-group --wrangler-config wrangler.toml --env staging
takos deploy-group --wrangler-config wrangler.toml --env staging --namespace takos-staging-tenants
```

### 用途

- control plane など、app.yml を持たない worker のデプロイ
- 既存の wrangler.toml をそのまま使いたい場合

### namespace との組み合わせ

`--namespace` と組み合わせると、指定された `wrangler.toml` を読み込み、`dispatch_namespace` field を注入してからデプロイします。対象 env セクション (`[env.<env>]`) が存在すればそのセクションに、存在しなければ top-level に挿入されます。

### 制約

`--wrangler-config` は以下のオプションと排他です。

- `--manifest`（app.yml パスの明示指定時）
- `--worker` / `--container`（フィルタ指定）

## validation

deploy 前に少なくとも次を検証します。

- `.takos/app.yml` が `kind: App` であること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- service / resource / route 参照が整合していること
- OAuth auto env や source provenance 変更に approval が必要な場合は caller が承認していること
- `--worker` / `--container` フィルタの名前が manifest 内に存在すること

`takos deploy validate` は local manifest validation の入口です。

## public API / CLI

### CLI

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID

takos deploy-group --env staging --namespace takos-staging-tenants
takos deploy-group --manifest .takos/app.yml --env production --dry-run
takos deploy-group --wrangler-config wrangler.toml --env staging
```

### API

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/{pause|resume|abort|promote}
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

## deploy flow

```text
repo/ref
  -> validate .takos/app.yml
  -> resolve workflow artifact
  -> create or update app identity
  -> reconcile resources
  -> reconcile services / routes / hostnames
  -> reconcile OAuth / MCP / file handlers
  -> create app deployment record
  -> start rollout if needed
```

## rollout

rollout state は app deployment ごとに管理されます。
current public controls は次です。

- get rollout state
- pause
- resume
- abort
- promote

rollout は「段階的に公開する操作」であり、deploy そのものとは別の制御面です。
CLI では deploy/status/rollback が中心で、細かい rollout control は API 側を正本とします。

## rollback

rollback は「前の app deployment へ戻す」操作です。
次の意味は current contract に含めません。

- resource の即時削除
- schema/data の自動巻き戻し
- deploy 以前の全副作用の完全復元

## provider 差分

Takos は Cloudflare を primary surface としつつ、local-platform / Helm / OCI orchestrator 側へ同じ app deploy contract を投影します。
provider ごとの差分は [Platform Compatibility Matrix](/operations/platform-matrix) と [互換性と制限](/architecture/compatibility-and-limitations) を参照してください。

## non-goals / historical model

current public contract に **含まれない** もの:

- `takos build`
- `takos publish`
- `takos promote`
- top-level `takos rollback`
- multi-document package bundle spec
- worker/service/provider 単位の lower-level deploy route を public 正本にする説明

## 次に読むページ

- [`.takos/app.yml`](/specs/app-manifest)
- [CLI / Auth model](/specs/cli-and-auth)
- [API リファレンス](/reference/api)
