# 環境変数

> このページでわかること: app.yml での環境変数の設定方法とテンプレート変数の使い方。

Takos では、アプリ全体の環境変数を `spec.env` で宣言的に管理できます。デプロイ後の URL やリソース ID をテンプレート変数で自動注入する仕組みもあります。

## 基本的な書き方

```yaml
env:
  required:
    - TAKOS_ACCESS_TOKEN
    - API_SECRET
  inject:
    PUBLIC_URL: "https://example.com"
```

| field | 説明 |
| --- | --- |
| `required` | 必須環境変数のリスト。デプロイ時に未設定ならエラーになります |
| `inject` | テンプレート変数を使ってデプロイ後の値を自動注入します |

## 必須環境変数

`required` に列挙した変数は、デプロイ時に設定されていないとエラーになります。

```yaml
env:
  required:
    - TAKOS_ACCESS_TOKEN
    - DATABASE_URL
```

これらの値は `wrangler secret put` などで事前に設定しておく必要があります。

## テンプレート変数

<div v-pre>

`inject` の値には `{{...}}` 形式のテンプレート変数を使えます。デプロイ後にシステムが実際の値に解決し、Worker / Container に環境変数として注入します。

```yaml
env:
  inject:
    BROWSER_API_URL: "{{routes.browser-api.url}}"
    EXECUTOR_API_URL: "{{routes.executor-api.url}}"
    DB_ID: "{{resources.main-db.id}}"
    CONTAINER_IP: "{{containers.browser.ipv4}}"
```

### 参照できる値

| テンプレート | 解決例 | 説明 |
| --- | --- | --- |
| `{{routes.<name>.url}}` | `https://app.takos.jp/session` | ルートのフル URL |
| `{{routes.<name>.domain}}` | `app.takos.jp` | ルートのドメイン |
| `{{routes.<name>.path}}` | `/session` | ルートのパス |
| `{{containers.<name>.ipv4}}` | `203.0.113.42` | コンテナの割当 IPv4 |
| `{{containers.<name>.port}}` | `8080` | コンテナのポート |
| `{{workers.<name>.url}}` | `https://host.workers.dev` | ワーカーの URL |
| `{{resources.<name>.id}}` | `abc-123` | リソース ID |

### 解決のタイミング

テンプレート変数はリソース作成、Worker デプロイ、Route 割り当てがすべて完了した後に解決されます。解決した値は `wrangler secret put` で各 Worker に注入されます。

### バリデーション

存在しない名前を参照するとパース時にバリデーションエラーになります。例えば、`routes` に `browser-api` が定義されていないのに `{{routes.browser-api.url}}` を参照するとエラーです。

</div>

## Worker 固有の環境変数

アプリ全体ではなく、特定の Worker だけに環境変数を設定することもできます。

```yaml
workers:
  web:
    build: ...
    env:
      PUBLIC_APP_NAME: Notes Assistant
      NODE_ENV: production
```

`spec.env` はアプリ全体に適用され、`workers.<name>.env` は特定の Worker にだけ適用されます。

## 実際の例: takos-computer

<div v-pre>

takos-computer では、ルートの URL をテンプレート変数で相互参照しています。

```yaml
env:
  required:
    - TAKOS_ACCESS_TOKEN
  inject:
    BROWSER_API_URL: "{{routes.browser-api.url}}"
    EXECUTOR_API_URL: "{{routes.executor-api.url}}"
```

デプロイ後、`BROWSER_API_URL` には `browser-api` ルートの実際の URL が、`EXECUTOR_API_URL` には `executor-api` ルートの実際の URL がそれぞれ注入されます。

</div>

## 次のステップ

- [Routes](/apps/routes) --- ルートの定義方法
- [Workers](/apps/workers) --- Worker の定義方法
- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
