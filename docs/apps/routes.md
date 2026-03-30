# Routes

Worker / Container をどのパスで公開するかを宣言する。ドメインはシステムが自動付与するので書かない。

## 基本

```yaml
routes:
  - name: app
    target: web
    path: /
```

## 複数ルート

```yaml
routes:
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

<div v-pre>

## テンプレート変数からの参照

ルートの `name` は `spec.env.inject` で `{{routes.<name>.url}}` のように参照できる。

```yaml
env:
  inject:
    BROWSER_API_URL: "{{routes.browser-api.url}}"
```

| テンプレート | 説明 |
| --- | --- |
| `{{routes.<name>.url}}` | ルートのフル URL |
| `{{routes.<name>.domain}}` | ルートのドメイン |
| `{{routes.<name>.path}}` | ルートのパス |

</div>

テンプレート変数の全一覧は [環境変数](/apps/environment) を参照。

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `name` | yes | ルート名。テンプレート変数の参照キー |
| `target` | yes | 対象の Worker or Container 名 |
| `path` | no | 公開パス |
| `ingress` | no | ingress worker |
| `timeoutMs` | no | ルートのタイムアウト (ms) |

## 次のステップ

- [環境変数](/apps/environment) --- テンプレート変数の詳細
- [Workers](/apps/workers) --- Worker の定義方法
