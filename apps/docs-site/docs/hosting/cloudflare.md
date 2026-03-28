# Cloudflare

Takos を Cloudflare Workers にデプロイする方法。

## 必要なもの

- Cloudflare アカウント
- API トークン（Workers / D1 / R2 / KV の権限）
- `@takos/cli` がインストール済み

## セットアップ

### 1. API トークンを取得

Cloudflare ダッシュボードで API トークンを作成する。必要な権限:

| 権限 | 用途 |
| --- | --- |
| Workers Scripts: Edit | Worker のデプロイ |
| D1: Edit | データベースの作成・マイグレーション |
| R2: Edit | ストレージバケットの作成 |
| Workers KV Storage: Edit | KV Namespace の作成 |
| Account Settings: Read | アカウント情報の取得 |

### 2. 環境変数をセット

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

アカウント ID は Cloudflare ダッシュボードの URL から取得できる。

### 3. ログイン

```bash
takos login
takos whoami
```

## デプロイ

```bash
takos deploy-group --env staging
```

production にデプロイする場合:

```bash
takos deploy-group --env production
```

デプロイの詳細は [deploy-group](/deploy/deploy-group) を参照。

## Workers

Takos アプリの中核。V8 isolate 上で動く軽量な HTTP ハンドラ。

- `.takos/app.yml` の `workers` セクションで定義
- `deploy-group` が wrangler.toml を自動生成してデプロイ
- リソース binding は manifest から自動注入

詳しくは [Workers](/apps/workers) を参照。

## CF Containers

Docker コンテナを Cloudflare 上で実行する仕組み。Worker の Durable Object として動作する。

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25

workers:
  browser-host:
    containers: [browser]
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-browser-host
        artifact: browser-host
        artifactPath: dist/browser-host.js
```

`deploy-group` が以下を自動生成する:

1. Durable Object ホストクラス（`@cloudflare/containers` の `Container` を extends）
2. wrangler.toml の `[[containers]]` セクション
3. `[[durable_objects.bindings]]` セクション
4. `[[migrations]]` セクション

詳しくは [Containers](/apps/containers) を参照。

## D1 / R2 / KV

`resources` セクションで宣言すると、`deploy-group` が自動で作成・binding する。

```yaml
resources:
  primary-db:
    type: d1
    binding: DB
    migrations:
      up: .takos/migrations/primary-db/up
      down: .takos/migrations/primary-db/down
  assets:
    type: r2
    binding: ASSETS
  cache:
    type: kv
    binding: CACHE
```

<div v-pre>

デプロイ後のリソース命名規則:

| リソース | 命名規則 |
| --- | --- |
| D1 | `{groupName}-{env}-{resourceName}` |
| R2 | `{groupName}-{env}-{resourceName}` |
| KV | `{groupName}-{env}-{resourceName}` |

</div>

既存リソースがある場合は再利用される。

## Dispatch Namespace

テナントごとに Worker を論理分離するための仕組み。

```bash
takos deploy-group --env production --namespace production-tenants --group tenant-a
```

- `--namespace` で dispatch namespace にデプロイ
- `--group` で Worker 名のプレフィックスを変更
- namespace 内の Worker は dispatcher Worker 経由でアクセス

namespace の作成は Cloudflare ダッシュボードまたは API で事前に行う必要がある。

詳しくは [Dispatch Namespace](/deploy/namespaces) を参照。

## Cloudflare 固有の環境変数

control plane を Cloudflare にデプロイする場合に使う主要な環境変数:

| 変数 | 用途 |
| --- | --- |
| `ADMIN_DOMAIN` | 管理ドメイン |
| `TENANT_BASE_DOMAIN` | テナント用ベースドメイン |
| `CF_ACCOUNT_ID` | Cloudflare アカウント ID |
| `CF_ZONE_ID` | DNS ゾーン ID |
| `WFP_DISPATCH_NAMESPACE` | dispatch namespace 名 |
| `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY` | プラットフォーム署名鍵 |
| `STRIPE_*` | Stripe 決済連携 |

認証系:

| 変数 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | AI プロバイダ |

## 次に読むページ

- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
- [環境ごとの差異](/hosting/differences) --- Cloudflare とセルフホストの違い
- [セルフホスト](/hosting/self-hosted) --- Cloudflare を使わない場合
