# Attached Container

Worker に紐づく container workload を `compute.<name>.containers` 内で定義する。
heavy computation、external binary を必要とする host process など、Worker
から呼び出したい image-backed workload 向け。

Attached Container はトップレベルの compute エントリではなく、Worker の
`containers` map 内に定義する。Attached Container は runtime binding / health
check の接続先を推測しないため、`port` が必須です。

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
      worker:
        image: ghcr.io/org/worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
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
      worker:
        image: ghcr.io/org/worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
        env:
          NODE_ENV: production
          LOG_LEVEL: info
```

group 全体の環境変数はトップレベル `env` で設定する。詳しくは
[環境変数](/apps/environment) を参照。

Attached container も Worker / Service と同じように `consume` できます。必要な
publication だけを明示し、outputs はその container にだけ env として inject
されます。ただし attached container は public route publication の publisher には
しません。外部に出す interface は親 Worker / Service が publish します。

## フィールド

Worker の `containers` map 内で定義する各 container のフィールド。

| field         | required      | type   | 説明                                                      |
| ------------- | ------------- | ------ | --------------------------------------------------------- |
| `image`       | online deploy | string | digest-pinned container image (64-hex `sha256` digest)    |
| `port`        | yes           | number | コンテナのリッスンポート                                  |
| `scaling`     | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `env`         | no            | object | コンテナ環境変数                                          |
| `consume`     | no            | array  | publication consume                                       |
| `volumes`     | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `healthCheck` | no            | object | ヘルスチェック                                            |
| `depends`     | no            | array  | compute 名の配列                                          |
| `dockerfile`  | local only    | string | local/private build 用。online deploy では `image` も必要 |

`readiness` は Worker 専用です。Attached Container の `healthCheck` は deploy
target に渡すヘルスチェック入力です。kernel の deploy 後定期監視 contract
ではありません。

## deploy source の制約

`takos deploy` / `takos install` で group snapshot として online deploy
する場合は digest pin された `image` が必要。`image` は 64-hex の `sha256`
digest を含む必要がある。`dockerfile` は `image` と併用する local/private
builder metadata であり、`dockerfile` だけの attached container は current
public deploy manifest として invalid。`port` は local/private builder metadata
付き manifest でも online deploy でも必須。

## Attached Container vs Service vs Worker

| 形態               | 定義場所                           | 動作                       | route target | 典型用途                       |
| ------------------ | ---------------------------------- | -------------------------- | ------------ | ------------------------------ |
| Worker             | `compute.<name>` (with `build`)    | serverless、request-driven | yes          | ルーティング、軽量処理         |
| Service            | `compute.<name>` (with `image`)    | always-on container        | yes          | API サーバー、常設バックエンド |
| Attached Container | `compute.<name>.containers.<name>` | worker に紐づく container  | **no**       | executor / host process        |

attached container は **routes の `target` にできない**。`routes` は親 worker /
service を対象に書き、そこから attached container を呼び出す。route publication
の `publisher` も親 worker / service にします。

Worker コードからは attached container reference を通じて参照する。binding 名は
child 名を uppercase に正規化した `${NAME}_CONTAINER` になる。たとえば `worker`
なら `env.WORKER_CONTAINER` を使う。current runtime では
DurableObjectNamespace-compatible な handle として利用できる。

`__TAKOS_ATTACHED_CONTAINER_${NAME}_URL` 形式の internal URL env は runtime
generated の内部実装であり、public contract ではない。

## 次のステップ

- [Services](/apps/services) --- always-on container workload (Service)
- [Workers](/apps/workers) --- Worker の定義方法
- [Routes](/apps/routes) --- workload を公開する方法
