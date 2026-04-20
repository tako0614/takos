# Workers

Worker は `compute.<name>.build` を持つ request-driven workload です。HTTP
ingress、lightweight job、MCP endpoint などを担当します。

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

## capability access

Worker が Takos API key や OAuth client を使う場合は capability grant を
`publish[].publisher/type` と `compute.<name>.consume` で受け取ります。SQL や
object store は publish ではなく resource API / runtime binding 側で扱います。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos-api
        env:
          endpoint: TAKOS_API_ENDPOINT
          apiKey: TAKOS_API_KEY
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

依存関係は `depends` で表します。resource 接続は publish ではなく resource API /
runtime binding で扱います。

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

queue consumer は resource API / runtime binding を使う通常の compute として
実装します。

## readiness

Worker は `healthCheck` を持ちません。deploy 時の readiness probe は
`compute.<name>.readiness` で上書きできます。

```yaml
compute:
  mcp:
    build: ...
    readiness: /mcp
```

指定した path は deploy 時に HTTP 200 を返す必要があります。200 を返さない
Worker は readiness failed として扱われます。201 / 204 / 3xx / 4xx / 5xx /
timeout (10s) も fail です。

worker に hostname / route がまだ割り当てられていない場合は、deploy 時の
readiness probe は skip されます。

## attached container

Worker には attached container をぶら下げられます。

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 3000
        healthCheck:
          path: /health
```

## field summary

| field                | required | 説明                                                   |
| -------------------- | -------- | ------------------------------------------------------ |
| `build`              | yes      | 現在は `fromWorkflow` のみ                             |
| `readiness`          | no       | deploy 時の readiness probe path。HTTP 200 のみ ready  |
| `containers`         | no       | attached container 定義                                |
| `depends`            | no       | 同一 manifest の compute 依存                          |
| `triggers.schedules` | no       | cron schedule                                          |
| `consume`            | no       | grant / publication outputs の明示 inject              |
| `env`                | no       | Worker 固有 env                                        |
| `scaling`            | no       | parser / desired metadata。runtime へ直接 apply しない |
