# Containers

Docker コンテナを定義して CF Containers として実行する。ブラウザ自動化や ML 推論など Docker が必要な処理向け。

## 基本

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
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

Worker のコードからは `env.BROWSER_CONTAINER` で Durable Object にアクセスできる。

## 独立稼働

`ipv4: true` で専用 IPv4 が割り当てられ、Worker なしで独立稼働する。

```yaml
containers:
  my-api:
    dockerfile: Dockerfile
    port: 3000
    ipv4: true
```

<div v-pre>

テンプレート変数 `{{containers.<name>.ipv4}}` で他の Worker から IP アドレスを参照できる。詳しくは [環境変数](/apps/environment) を参照。

</div>

## コンテナ環境変数

コンテナ固有の環境変数を `env` で設定できる。

```yaml
containers:
  my-api:
    dockerfile: Dockerfile
    port: 3000
    env:
      NODE_ENV: production
      LOG_LEVEL: info
```

アプリ全体の環境変数は `spec.env` で設定する。詳しくは [環境変数](/apps/environment) を参照。

## フィールド

| field | required | 説明 |
| --- | --- | --- |
| `dockerfile` | yes | Dockerfile パス |
| `port` | yes | コンテナのリッスンポート |
| `instanceType` | no | インスタンスタイプ (`basic`, `standard-2` など) |
| `maxInstances` | no | 最大インスタンス数 |
| `ipv4` | no | `true` で専用 IPv4 を割り当て (独立稼働向け) |
| `env` | no | コンテナ環境変数 |

## 次のステップ

- [Workers](/apps/workers) --- Worker の定義方法
- [Routes](/apps/routes) --- コンテナを公開する方法
