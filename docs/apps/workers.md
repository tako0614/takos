# Workers

Worker は `compute.<name>.build` を持つ request-driven workload です。HTTP
ingress、 lightweight job、MCP endpoint などを担当します。

## 基本

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

## resource access

Worker が DB や object store を使う場合は `storage` ではなく `publish + consume`
で env を受け取ります。

```yaml
publish:
  - name: primary-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
```

## depends

`depends` は同一 manifest の compute 名だけを参照します。

```yaml
compute:
  api:
    build: ...
  jobs:
    build: ...
    depends:
      - api
```

旧 `storage` への依存宣言は廃止されました。

## triggers

Worker が持てる trigger は schedule だけです。

```yaml
compute:
  jobs:
    build: ...
    triggers:
      schedules:
        - cron: "*/15 * * * *"
```

`triggers.queues` は retired です。queue consumer は queue publication を
consume した通常の compute として実装します。

## readiness

Worker は `healthCheck` を持ちません。deploy 時の readiness probe は
`compute.<name>.readiness` で上書きできます。

```yaml
compute:
  mcp:
    build: ...
    readiness: /mcp
```

root path が 200 を返さない Worker では明示しておくと安全です。

## attached container

Worker には attached container をぶら下げられます。

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:def456
        port: 3000
        healthCheck:
          path: /health
```

## field summary

| field                | required | 説明                              |
| -------------------- | -------- | --------------------------------- |
| `build`              | yes      | 現在は `fromWorkflow` のみ        |
| `readiness`          | no       | deploy 時の readiness probe path  |
| `containers`         | no       | attached container 定義           |
| `depends`            | no       | 同一 manifest の compute 依存     |
| `triggers.schedules` | no       | cron schedule                     |
| `consume`            | no       | publication outputs の明示 inject |
| `env`                | no       | Worker 固有 env                   |
| `scaling`            | no       | provider-specific scaling hint    |
