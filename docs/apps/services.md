# Service

image-based の常設 container workload を `compute` 内で定義する。`image` があり
`build` がない compute エントリは自動的に Service と判定される。HTTP
API、webhook receiver、常設バックエンドなど always-on な container workload
向け。

## 基本

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 3000
```

`build` を持たず `image` を持つ compute エントリが Service になる。Service は
image-backed runtime に渡す listen port を推測しないため、`port` が必須です。

## ルート公開

Service は route の `target` として直接公開できる。

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 3000

routes:
  - target: api
    path: /api
```

## env

Service には環境変数を設定できる。publication を `consume` する compute
だけに、その outputs が注入される。Takos API key / OAuth client も
`takos.api-key` / `takos.oauth-client` という system publication source として
同じ `consume` contract で受け取る。

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 3000
    env:
      NODE_ENV: production
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        env:
          endpoint: TAKOS_API_ENDPOINT
          apiKey: TAKOS_API_KEY
```

## フィールド

| field         | required | type   | 説明                                                   |
| ------------- | -------- | ------ | ------------------------------------------------------ |
| `image`       | **yes**  | string | digest-pinned image ref (64-hex `sha256` digest)       |
| `port`        | **yes**  | number | listen port                                            |
| `dockerfile`  | no       | string | `image` 併用時の local/private build metadata          |
| `env`         | no       | object | container env                                          |
| `consume`     | no       | array  | publication consume                                    |
| `healthCheck` | no       | object | ヘルスチェック                                         |
| `volumes`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `scaling`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `depends`     | no       | array  | compute 名の配列                                       |

`triggers` は Worker 専用です。Service の `healthCheck` は deploy target に渡す
ヘルスチェック入力です。kernel の deploy 後定期監視 contract ではありません。

## deploy source の制約

`takos deploy` / `takos install` が full deployment pipeline を通るとき、Service
は `image` で解決される。`image` は digest pin (64-hex `sha256` digest) 必須。
Service compute の `dockerfile` は `image` と併用する local/private builder
metadata として扱う。`dockerfile` だけの Service は online deploy source
としては不十分で、builder が作った digest-pinned `image` を Service に渡します。
`port` は local/private builder metadata の有無にかかわらず必須です。

## Service vs Worker vs Attached Container

| 形態              | 判定条件                     | 動作                         | 典型用途                       |
| ----------------- | ---------------------------- | ---------------------------- | ------------------------------ |
| Worker            | `build` あり                 | serverless、request-driven   | ルーティング、軽量処理         |
| Service           | `image` あり（`build` なし） | always-on container          | API サーバー、常設バックエンド |
| Worker + Attached | `build` + `containers` あり  | worker に container が紐づく | executor、heavy processing     |

## 次のステップ

- [Containers](/apps/containers) --- worker-attached container workload
- [Routes](/apps/routes) --- service を公開する方法
- [Manifest Reference](/reference/manifest-spec) --- field 一覧
