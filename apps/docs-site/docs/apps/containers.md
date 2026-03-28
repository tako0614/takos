# Containers

> このページでわかること: app.yml の `containers` セクションの書き方と、Worker との紐づけ方法。

Containers は Docker コンテナとして実行されるサービスの定義です。ブラウザ自動化、ML 推論、ヘビーなバッチ処理など、Docker が必要な場合に使います。

## 基本的な書き方

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25
```

`browser` がコンテナ名です。Worker の `containers` フィールドからこの名前で参照します。

## 全フィールド

| field | required | 説明 |
| --- | --- | --- |
| `dockerfile` | yes | Dockerfile のパス |
| `port` | yes | コンテナのリッスンポート |
| `instanceType` | no | インスタンスタイプ（`basic`, `standard-2` など） |
| `maxInstances` | no | 最大インスタンス数 |
| `ipv4` | no | `true` で専用 IPv4 を割り当て（独立稼働コンテナ向け） |
| `env` | no | コンテナ環境変数 |

## Worker に紐づけるパターン

Worker の `containers` フィールドでコンテナを参照すると、CF Containers (Durable Object) として Worker に統合されます。これが最も一般的なパターンです。

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

デプロイ時に以下が自動生成されます。

| 生成される項目 | 値（コンテナ名が `browser` の場合） |
| --- | --- |
| Durable Object クラス名 | `BrowserContainer` |
| binding 名 | `BROWSER_CONTAINER` |
| wrangler.toml セクション | `[[containers]]` + `[[durable_objects.bindings]]` |
| migration | `new_classes: ["BrowserContainer"]` |

Worker のコードからは、`env.BROWSER_CONTAINER` として Durable Object にアクセスできます。

```typescript
interface Env {
  BROWSER_CONTAINER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.BROWSER_CONTAINER.idFromName("default");
    const stub = env.BROWSER_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
```

## 独立稼働パターン

Worker に紐づけず、コンテナ単体で動かすこともできます。`ipv4: true` を指定すると専用 IPv4 が割り当てられます。

```yaml
containers:
  my-api:
    dockerfile: Dockerfile
    port: 3000
    ipv4: true
```

独立稼働コンテナの場合:

- ホストエントリポイントが自動生成されます
- 常設コンテナとして動作します

<div v-pre>

テンプレート変数 `{{containers.<name>.ipv4}}` で他の Worker から IP アドレスを参照できます。

</div>

## 使い分け

| | Worker に紐づけ | 独立稼働 (`ipv4: true`) |
| --- | --- | --- |
| 実行方式 | Durable Object ライフサイクル管理 | 常設コンテナ |
| デプロイ | Worker の wrangler config に統合 | ホストエントリポイント自動生成 |
| アクセス方法 | Worker 経由 | 専用 IPv4 で直接 |
| 用途 | オンデマンド起動が必要な処理 | 常時起動が必要な処理 |

## 複数コンテナの例

1 つのアプリに複数のコンテナを定義して、それぞれ異なる Worker に紐づけることもできます。

```yaml
containers:
  browser:
    dockerfile: packages/browser-service/Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25
  executor:
    dockerfile: packages/executor-service/Dockerfile
    port: 8080
    instanceType: basic
    maxInstances: 100

workers:
  browser-host:
    containers: [browser]
    build: ...
  executor-host:
    containers: [executor]
    build: ...
```

これは takos-computer の実際の構成と同じパターンです。

## 次のステップ

- [Workers](/apps/workers) --- Worker の定義方法
- [Routes](/apps/routes) --- コンテナを公開する方法
- [Worker + Container サンプル](/examples/worker-with-container) --- 完全なサンプル
