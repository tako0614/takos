# 環境変数

アプリ全体の環境変数を `spec.env` で宣言的に管理する。デプロイ後の URL やリソース ID をテンプレート変数で自動注入できる。

## 基本

```yaml
env:
  required:
    - TAKOS_ACCESS_TOKEN
  inject:
    PUBLIC_URL: "https://example.com"
```

| field | 説明 |
| --- | --- |
| `required` | 必須環境変数のリスト。デプロイ時に未設定ならエラー |
| `inject` | テンプレート変数を使って値を自動注入 |

## テンプレート変数

<div v-pre>

`inject` の値には `{{...}}` 形式のテンプレート変数を使える。デプロイ後にシステムが実際の値に解決し、Worker / Container に環境変数として注入する。

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

存在しない名前を参照するとバリデーションエラーになる。

</div>

## Worker 固有の環境変数

特定の Worker だけに環境変数を設定することもできる。

```yaml
workers:
  web:
    build: ...
    env:
      PUBLIC_APP_NAME: Notes Assistant
      NODE_ENV: production
```

`spec.env` はアプリ全体、`workers.<name>.env` は特定の Worker にだけ適用される。

## 次のステップ

- [Routes](/apps/routes) --- ルートの定義方法
- [Workers](/apps/workers) --- Worker の定義方法
