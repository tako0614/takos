# Attached Container

Worker に紐づく container workload を `compute.<name>.containers` 内で定義する。
ブラウザ自動化、heavy computation、external binary を必要とする host process など、
Worker から呼び出したい image-backed workload 向け。

Attached Container はトップレベルの compute エントリではなく、Worker の `containers`
map 内に定義する。

## 基本

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: host
        artifactPath: dist/host.js
    containers:
      browser:
        image: ghcr.io/org/browser@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
```

## コンテナ環境変数

コンテナ固有の環境変数を `env` で設定できる。

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: host
        artifactPath: dist/host.js
    containers:
      browser:
        image: ghcr.io/org/browser@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
        env:
          NODE_ENV: production
          LOG_LEVEL: info
```

アプリ全体の環境変数はトップレベル `env` で設定する。詳しくは
[環境変数](/apps/environment) を参照。

## フィールド

Worker の `containers` map 内で定義する各 container のフィールド。

| field | required | type | 説明 |
| --- | --- | --- | --- |
| `image` | **yes** | string | digest-pinned container image (64-hex `sha256` digest) |
| `port` | no | number | コンテナのリッスンポート |
| `instanceType` | no | string | provider 別 instance enum |
| `scaling` | no | object | `{ minInstances?, maxInstances? }` |
| `env` | no | object | コンテナ環境変数 |
| `volumes` | no | object | volume mount |
| `healthCheck` | no | object | ヘルスチェック |
| `depends` | no | array | compute 名の配列 |
| `dockerfile` | no | string | local build 用 (local provider only) |

`readiness` は Worker 専用です。Attached Container は `healthCheck` を使います。

## deploy source の制約

`takos deploy` / `takos install` で online deploy する場合は
digest pin された `image` が必要。`image` は 64-hex の `sha256` digest を含む
必要がある。

## Attached Container vs Service vs Worker

| 形態 | 定義場所 | 動作 | route target | 典型用途 |
| --- | --- | --- | --- | --- |
| Worker | `compute.<name>` (with `build`) | serverless、request-driven | yes | ルーティング、軽量処理 |
| Service | `compute.<name>` (with `image`) | always-on container | yes | API サーバー、常設バックエンド |
| Attached Container | `compute.<name>.containers.<name>` | worker に紐づく container | **no** | browser / executor / host process |

attached container は **routes の `target` にできない**。`routes` は親 worker / service を
対象に書き、そこから attached container を呼び出す。

Worker コードからは attached container reference を通じて参照する。current
runtime では DurableObjectNamespace-compatible な handle として利用できる。

## 次のステップ

- [Services](/apps/services) --- always-on container workload (Service)
- [Workers](/apps/workers) --- Worker の定義方法
- [Routes](/apps/routes) --- workload を公開する方法
