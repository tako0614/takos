# 環境変数

アプリ全体の環境変数をトップレベル `env` でキーバリュー形式に宣言する。compute ごとの `env` で上書きできる。storage の `bind:` で宣言した resource は全 compute に自動注入される。

## 優先順位

env の解決順 (低 → 高):
1. storage bind による自動 inject
2. publication env injection (`TAKOS_*_*_URL`)
3. top-level env
4. `compute.<name>.env`

高優先度が低優先度を override する。
key 衝突時は高優先度の値が使われる。

## 基本

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info
```

トップレベル `env` は全 compute に適用される。

## compute 固有の環境変数

特定の compute だけに環境変数を設定する、またはトップレベルの値を上書きする。

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    env:
      LOG_LEVEL: debug
      PUBLIC_APP_NAME: Notes Assistant
```

この例では `web` の `LOG_LEVEL` は `debug` に上書きされ、`NODE_ENV` はトップレベルの `production` が継承される。

## storage の自動注入

storage で `bind:` を設定すると、その binding が全 compute に環境変数として自動注入される。compute 側に `bindings` フィールドは存在しない。

```yaml
storage:
  db:
    type: sql
    bind: DB
  cache:
    type: key-value
    bind: CACHE

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

この例では `DB` と `CACHE` が `web` に自動注入される。

## Attached Container の環境変数

Worker 内の attached container にも個別の `env` を設定できる。

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
        image: ghcr.io/org/browser@sha256:def456
        port: 8080
        env:
          HEADLESS: "true"
```

## 完全な例

```yaml
name: my-app

env:
  NODE_ENV: production
  LOG_LEVEL: info

storage:
  db:
    type: sql
    bind: DB
  app-secret:
    type: secret
    bind: APP_SECRET
    generate: true

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    env:
      LOG_LEVEL: debug

  api:
    image: ghcr.io/org/api@sha256:abc123
    port: 8080
    env:
      API_MODE: strict
```

`web` と `api` の両方に `NODE_ENV`, `DB`, `APP_SECRET` が注入される。`web` の `LOG_LEVEL` は `debug` に上書きされる。

## 次のステップ

- [Routes](/apps/routes) --- ルートの定義方法
- [Workers](/apps/workers) --- Worker の定義方法
- [Manifest Reference](/reference/manifest-spec) --- field 一覧
