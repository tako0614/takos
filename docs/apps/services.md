# Service

image-based の常設 container workload を `compute` 内で定義する。`image` があり
`build` がない compute エントリは自動的に Service と判定される。HTTP API、webhook
receiver、常設バックエンドなど always-on な container workload 向け。

## 基本

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:abc123
    port: 3000
```

`build` を持たず `image` を持つ compute エントリが Service になる。

## ルート公開

Service は route の `target` として直接公開できる。

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:abc123
    port: 3000

routes:
  - target: api
    path: /api
```

## env

Service には環境変数を設定できる。storage の `bind:` で宣言した resource は全 compute に自動注入される。

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:abc123
    port: 3000
    env:
      NODE_ENV: production
```

## フィールド

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `image` | **yes** | string | digest-pinned image ref (`@sha256:...`) |
| `port` | **yes** | number | listen port |
| `dockerfile` | no | string | local build 用 Dockerfile path (local provider only) |
| `triggers` | no | object | `schedules` または `queues` |
| `env` | no | object | container env |
| `healthCheck` | no | object | ヘルスチェック |
| `volumes` | no | object | volume mount |
| `scaling` | no | object | `{ minInstances?, maxInstances? }` |
| `instanceType` | no | string | provider 別 instance enum |
| `depends` | no | array | storage / compute 名の配列 |

## deploy source の制約

`takos deploy` / `takos install` が full deployment pipeline
を通るとき、Service は `image` で解決される。`image` は digest pin (`@sha256:...`) 必須。
`dockerfile` だけでは online deploy source としては不十分。

## Service vs Worker vs Attached Container

| 形態 | 判定条件 | 動作 | 典型用途 |
| --- | --- | --- | --- |
| Worker | `build` あり | serverless、request-driven | ルーティング、軽量処理 |
| Service | `image` あり（`build` なし） | always-on container | API サーバー、常設バックエンド |
| Worker + Attached | `build` + `containers` あり | worker に container が紐づく | browser automation、executor |

## 次のステップ

- [Containers](/apps/containers) --- worker-attached container workload
- [Routes](/apps/routes) --- service を公開する方法
- [Manifest Reference](/reference/manifest-spec) --- field 一覧
