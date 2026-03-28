# Routes

> このページでわかること: app.yml の `routes` セクションの書き方と、HTTP エンドポイントの公開方法。

Routes は Worker や Container をどのパスで公開するかを宣言するセクションです。ドメインは app.yml に書きません。システムが自動付与します。

## 基本的な書き方

```yaml
routes:
  - name: app
    target: web
    path: /
```

これだけで Worker `web` がルートパス `/` で公開されます。

## 複数ルートの例

```yaml
routes:
  - name: browser-gui
    target: browser-host
    path: /gui
  - name: browser-api
    target: browser-host
    path: /session
  - name: browser-mcp
    target: browser-host
    path: /mcp
  - name: executor-api
    target: executor-host
    path: /dispatch
```

同じ Worker に複数のパスを割り当てたり、異なる Worker に異なるパスを割り当てたりできます。

## 全フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | ルート名。テンプレート変数で参照する際のキーになります |
| `target` | yes | 対象の Worker または Container 名 |
| `path` | no | 公開パス |
| `ingress` | no | ingress worker |
| `timeoutMs` | no | ルートのタイムアウト（ミリ秒） |

## テンプレート変数からの参照

<div v-pre>

ルートの `name` は、テンプレート変数の参照キーになります。`spec.env.inject` で `{{routes.<name>.url}}` のように使えます。

```yaml
routes:
  - name: browser-api
    target: browser-host
    path: /session

env:
  inject:
    BROWSER_API_URL: "{{routes.browser-api.url}}"
```

参照できる値:

| テンプレート | 説明 |
| --- | --- |
| `{{routes.<name>.url}}` | ルートのフル URL |
| `{{routes.<name>.domain}}` | ルートのドメイン |
| `{{routes.<name>.path}}` | ルートのパス |

</div>

## タイムアウト

長時間かかるリクエストを処理する場合、`timeoutMs` を設定できます。

```yaml
routes:
  - name: app
    target: web
    path: /
    timeoutMs: 30000    # 30 秒
```

## デプロイ後の URL

<div v-pre>

デプロイが完了すると、以下のような URL が自動的に割り当てられます。

```text
# Worker の直接 URL
https://{groupName}-{workerName}.your-subdomain.workers.dev

# Route で path を指定した場合
https://your-domain.example.com/session  → browser-host worker
https://your-domain.example.com/gui      → browser-host worker
```

</div>

## 次のステップ

- [環境変数](/apps/environment) --- テンプレート変数の詳細
- [Workers](/apps/workers) --- Worker の定義方法
- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
