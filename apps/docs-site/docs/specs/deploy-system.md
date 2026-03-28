# Deploy System

Deploy は、repo の中身を取り出して Takos が管理する環境（Cloudflare Workers / Containers / D1 / R2 / KV）で動かす操作です。

## 2 つの Deploy 方法

Takos には 2 つのデプロイコマンドがあります。目的に合わせて使い分けてください。

### `takos deploy` --- Store 経由デプロイ

Takos control plane を通してデプロイします。Store に公開するアプリはこちらを使います。

```bash
# space にアプリをデプロイ
takos deploy --space SPACE_ID --repo REPO_ID --ref main

# デプロイ状態の確認
takos deploy status --space SPACE_ID

# ロールバック
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

- UI からも trigger 可能
- CI/CD パイプラインに組み込める
- rollout（段階的公開）を制御できる

### `takos deploy-group` --- 直接デプロイ

手元から Cloudflare API を直接呼んでデプロイします。ローカル開発・テスト向けです。

```bash
# ステージング環境にデプロイ
takos deploy-group --env staging

# dry-run で確認だけ
takos deploy-group --manifest .takos/app.yml --env production --dry-run

# 特定の worker / container だけデプロイ
takos deploy-group --env staging --worker web --worker api
takos deploy-group --env staging --container browser

# dispatch namespace を指定（マルチテナント）
takos deploy-group --env staging --namespace takos-staging-tenants

# wrangler.toml を直接デプロイ（control plane 自体のデプロイ等）
takos deploy-group --wrangler-config wrangler.toml --env staging
```

### どちらを使う？

| ケース | コマンド |
|---|---|
| Store に公開するアプリ | `takos deploy` |
| 開発中・テスト | `takos deploy-group` |
| control plane 自体のデプロイ | `takos deploy-group --wrangler-config` |

## Deploy の流れ

デプロイを実行すると、以下の順番で処理が進みます。

```text
1. .takos/app.yml を読み込み → バリデーション
2. リソースを作成（D1, R2, KV, secret）
   - 既存リソースがあれば再利用
3. Worker をデプロイ
   - wrangler.toml を動的生成
   - リソースの binding を注入
4. Container をデプロイ（定義がある場合）
   - CF Containers の設定を自動生成
5. Route を割り当て（ドメイン自動付与）
6. テンプレート変数を解決 → 環境変数として注入
→ 結果: アプリが動いている
```

## Deploy 後、何がどこで動いているか

デプロイが完了すると、以下のリソースが Cloudflare 上に作成されます。

| コンポーネント | 実行環境 | 命名規則 |
|---|---|---|
| Worker | Cloudflare Workers | <span v-pre>`{groupName}-{workerName}`</span> |
| Container | CF Containers (Durable Object) | Worker に紐づいてデプロイ |
| DB | Cloudflare D1 | <span v-pre>`{groupName}-{env}-{resourceName}`</span> |
| Storage | Cloudflare R2 | <span v-pre>`{groupName}-{env}-{resourceName}`</span> |
| KV | Cloudflare KV Namespace | <span v-pre>`{groupName}-{env}-{resourceName}`</span> |
| Route | Cloudflare Workers Routes | manifest の routes 定義に従う |

### URL の例

```text
# Worker
https://my-app-web.your-domain.workers.dev

# Route が設定されている場合
https://app.example.com/api  → my-app-api worker
https://app.example.com/     → my-app-web worker
```

## 失敗したときは？

### よくあるエラーと対処

#### バリデーションエラー

```text
Error: app.yml must have kind: App
```

`.takos/app.yml` の `kind` field が `App` になっているか確認してください。

```text
Error: workflow path must be under .takos/workflows/
```

`build.fromWorkflow.path` が `.takos/workflows/` 配下を指しているか確認してください。

```text
Error: worker "xxx" not found in manifest
```

`--worker` で指定した名前が `.takos/app.yml` の workers セクションに存在するか確認してください。

#### リソース作成失敗

```text
Error: Failed to create D1 database
```

- Cloudflare API トークンに D1 の権限があるか確認
- アカウントの D1 クォータに空きがあるか確認

#### デプロイ失敗

```text
Error: wrangler deploy failed
```

- `takos deploy-group --dry-run` で事前確認
- wrangler のログを確認（`--verbose` オプション）
- binding の参照先リソースが存在するか確認

### ロールバック

`takos deploy` でデプロイした場合:

```bash
# 前のデプロイに戻す
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

ロールバックは「前の app deployment の状態に戻す」操作です。以下は自動では行われません。

- DB スキーマ・データの巻き戻し
- R2 / KV に書き込まれたデータの削除
- 外部サービスへの副作用の復元

`takos deploy-group` の場合は、以前のコードで再度 `deploy-group` を実行してください。

### デプロイ前のバリデーション

デプロイ前に manifest だけ検証したい場合:

```bash
takos deploy validate
```

以下の項目が検証されます。

- `.takos/app.yml` が `kind: App` であること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- service / resource / route の参照が整合していること
- `--worker` / `--container` フィルタの名前が manifest 内に存在すること

## 高度な機能

### Dispatch Namespace（マルチテナント）

`--namespace` を指定すると、worker は Cloudflare の dispatch namespace 内にデプロイされます。テナントごとに worker を論理分離する場合に使います。

```bash
takos deploy-group --env staging --namespace takos-staging-tenants
```

namespace を指定すると、以下が変わります。

| 項目 | namespace なし | namespace あり |
|---|---|---|
| worker 名 | <span v-pre>`{workerName}`</span> | <span v-pre>`{groupName}-{workerName}`</span> |
| service binding の参照先 | <span v-pre>`{targetName}`</span> | <span v-pre>`{groupName}-{targetName}`</span> |
| wrangler.toml | 通常 | `dispatch_namespace` field が追加 |

### Wrangler Config 直接デプロイ

`--wrangler-config` を指定すると、app.yml をバイパスして既存の `wrangler.toml` を直接デプロイします。

```bash
# control plane のデプロイ
takos deploy-group --wrangler-config wrangler.toml --env staging

# namespace と組み合わせ
takos deploy-group --wrangler-config wrangler.toml --env staging --namespace takos-staging-tenants
```

**用途:**

- control plane など、app.yml を持たない worker のデプロイ
- 既存の wrangler.toml をそのまま使いたい場合

**制約:** `--wrangler-config` は `--manifest`、`--worker`、`--container` とは同時に使えません。

`--namespace` と組み合わせると、指定された wrangler.toml に `dispatch_namespace` field を注入してからデプロイします。

### Container Host 自動生成

worker に `containers` 参照がある場合、デプロイ時に CF Containers に必要な設定が自動生成されます。

container 名が `browser` の場合の例:

| 生成される項目 | 値 |
|---|---|
| Durable Object クラス名 | `BrowserContainer` |
| binding 名 | `BROWSER_CONTAINER` |
| wrangler.toml セクション | `[[containers]]` + `[[durable_objects.bindings]]` |
| migration | `new_classes: ["BrowserContainer"]` |
| ホストエントリポイント | `index.js`（standalone の場合のみ） |

**worker に紐づく container** は worker の wrangler.toml に統合されます。**worker に紐づかない standalone container** は、自動生成されたホストエントリポイントで独立してデプロイされます。

| 関係 | deploy 方式 |
|---|---|
| worker に紐づく | worker の wrangler config に統合。Durable Object ライフサイクル管理 |
| standalone（紐づかない） | ホストエントリポイント自動生成。常設コンテナとして動作 |

### テンプレート変数

<span v-pre>manifest の `spec.env.inject` に `${{ expression }}` 形式でテンプレートを記述すると、デプロイ結果から値を解決して各 worker に環境変数として注入します。</span>

```yaml
spec:
  env:
    inject:
      PUBLIC_URL: "${{ routes.web.url }}"
      DB_ID: "${{ resources.main-db.id }}"
```

参照可能な値:

| カテゴリ | パス例 | 内容 |
|---|---|---|
| `routes` | `routes.web.url` | デプロイ後の URL |
| `containers` | `containers.browser.ipv4` | standalone container の IPv4 |
| `workers` | `workers.api.url` | worker の URL |
| `resources` | `resources.main-db.id` | リソースの ID |

テンプレートはリソース作成・worker デプロイ・route 割り当てがすべて完了した後に解決され、`wrangler secret put` で各 worker に注入されます。

## Store 経由デプロイの API

`takos deploy` が内部で使う API です。UI 連携や CI/CD から直接叩く場合に参照してください。

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/{pause|resume|abort|promote}
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

### Rollout 制御

rollout は「段階的に公開する操作」で、deploy とは別の制御面です。API で以下を操作できます。

- rollout 状態の取得
- 一時停止（pause）
- 再開（resume）
- 中止（abort）
- 即時完了（promote）

## 参考: 内部アーキテクチャ

::: details 実装者向け: deploy の内部フロー

### Store 経由デプロイ (`takos deploy`) の内部処理

```text
repo/ref
  → validate .takos/app.yml
  → resolve workflow artifact
  → create or update app identity
  → reconcile resources
  → reconcile services / routes / hostnames
  → reconcile OAuth / MCP / file handlers
  → create app deployment record
  → start rollout if needed
```

### Group Deploy (`takos deploy-group`) の内部処理

```text
app.yml 読み込み
  ↓
Resource Provisioning
  - D1: Cloudflare D1 API で作成（既存なら再利用）
  - R2: Cloudflare R2 API で作成
  - KV: Cloudflare KV API で作成
  - secretRef (generate: true): randomBytes(32).toString('hex') で生成
  ↓
Worker デプロイ
  - wrangler.toml を動的生成（generateWranglerConfig）
  - resource binding を注入（D1 の database_id / R2 の bucket_name / KV の namespace id）
  - CF Containers がある場合: [[containers]] + [[durable_objects]] セクション追加
  - wrangler deploy で実行
  ↓
Container デプロイ（CF Containers）
  - worker に紐づく container: wrangler config に含まれて一緒にデプロイ
  - standalone container: ホストエントリポイント自動生成
  - Durable Object + migrations を自動設定
  ↓
Secrets 設定
  - secretRef の値を wrangler secret put で注入
  ↓
テンプレート変数解決
  - env.inject のテンプレートをデプロイ結果で解決
  - 解決した値を wrangler secret put で各 worker に注入
```

### Resource Provisioning の詳細

リソース名は <span v-pre>`{groupName}-{env}-{resourceName}`</span> の形式で Cloudflare 側に作成されます。binding 名は manifest の `binding` field を使い、省略時は `UPPER_SNAKE_CASE(resourceName)` に変換されます。

| リソース種別 | API | 結果 |
|---|---|---|
| `d1` | `POST /d1/database` | `database_id` (UUID) を取得 |
| `r2` | `POST /r2/buckets` | bucket 名を ID として使用 |
| `kv` | `POST /storage/kv/namespaces` | namespace `id` を取得 |
| `secretRef` | ローカル生成 | ランダムトークン |

`--worker` / `--container` フィルタ指定時は、対象 worker が参照する resource のみ provisioning されます。

### Container Host 自動生成の詳細

standalone container の場合、以下の `index.js` が一時ディレクトリに生成されます。

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

自動生成される wrangler.toml:

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

### Provider 差分

Takos は Cloudflare を primary surface としつつ、local-platform / Helm / OCI orchestrator へ同じ app deploy contract を投影します。provider ごとの差分は [Platform Compatibility Matrix](/operations/platform-matrix) と [互換性と制限](/architecture/compatibility-and-limitations) を参照してください。

:::

## 次に読むページ

- [`.takos/app.yml`](/specs/app-manifest) --- manifest の書き方
- [CLI / Auth model](/specs/cli-and-auth) --- 認証と CLI の設定
- [API リファレンス](/reference/api) --- API の詳細
