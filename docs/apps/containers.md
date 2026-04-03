# Containers

Docker コンテナを定義して CF Containers として実行する。ブラウザ自動化や ML
推論など Docker が必要な処理向け。

## 基本

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    imageRef: ghcr.io/example/browser-service:2026-03-30
    provider: oci
    port: 8080
    instanceType: standard-2
    maxInstances: 25
```

## Worker に紐づける

```yaml
containers:
  browser:
    dockerfile: Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25

workers:
  browser-host:
    containers: [browser]
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: browser-host
        artifactPath: dist/host.js
```

Worker のコードからは `env.BROWSER_CONTAINER` で Durable Object
にアクセスできる。

## コンテナ環境変数

コンテナ固有の環境変数を `env` で設定できる。

```yaml
containers:
  browser:
    dockerfile: Dockerfile
    port: 8080
    env:
      NODE_ENV: production
      LOG_LEVEL: info
```

アプリ全体の環境変数は `spec.env` で設定する。詳しくは
[環境変数](/apps/environment) を参照。

## フィールド

| field          | required | 説明                                                                    |
| -------------- | -------- | ----------------------------------------------------------------------- |
| `dockerfile`   | yes      | Dockerfile パス                                                         |
| `imageRef`     | no       | `takos apply` / `takos deploy` が使う digest-pinned container image ref |
| `provider`     | no       | `oci`, `ecs`, `cloud-run`, `k8s`                                        |
| `port`         | yes      | コンテナのリッスンポート                                                |
| `instanceType` | no       | インスタンスタイプ (`basic`, `standard-2` など)                         |
| `maxInstances` | no       | 最大インスタンス数                                                      |
| `env`          | no       | コンテナ環境変数                                                        |

## containers vs services

`containers` は CF Containers (Worker に紐づく Durable Object)
専用。常設の独立稼働コンテナには `services` セクションを使う。

`takos apply` / `takos deploy` で online deploy する場合は digest pin された
`imageRef` (`@sha256:...`) が必要。`dockerfile` は source
定義として残るが、deploy path 自体は image ref を使う。

|             | containers                         | services                    |
| ----------- | ---------------------------------- | --------------------------- |
| 用途        | CF Containers (Worker に紐づく)    | 常設コンテナ (VPS/独立稼働) |
| IPv4 割当   | 不可                               | `ipv4: true` で可能         |
| Worker 連携 | `workers.<name>.containers` で参照 | routes の target で参照     |

詳しくは [Services](/apps/manifest) を参照。

## 次のステップ

- [Services](/apps/manifest) --- 常設コンテナの定義方法
- [Workers](/apps/workers) --- Worker の定義方法
- [Routes](/apps/routes) --- コンテナを公開する方法
