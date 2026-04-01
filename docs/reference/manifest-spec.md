# マニフェストリファレンス

このページは `.takos/app.yml` の current surface を要約します。`.takos/app.yml`
は group desired state を author する主要 source で、resource と binding は
Cloudflare-native の syntax が正本です。Takos runtime はこの spec を Cloudflare
backend と互換 backend の両方で実現します。

## トップレベル

| field           | required | type   | 説明                     |
| --------------- | -------- | ------ | ------------------------ |
| `apiVersion`    | yes      | string | `takos.dev/v1alpha1`     |
| `kind`          | yes      | string | `App`                    |
| `metadata.name` | yes      | string | アプリ名                 |
| `spec.version`  | yes      | string | デプロイ表示用バージョン |

## spec

| field          | required | 説明                            |
| -------------- | -------- | ------------------------------- |
| `workers`      | no       | Workers runtime workload        |
| `services`     | no       | 常設コンテナ workload           |
| `containers`   | no       | Worker に紐づく CF Containers   |
| `resources`    | no       | Cloudflare-native resource 定義 |
| `routes`       | no       | workload 公開ルート             |
| `env`          | no       | 環境変数と注入                  |
| `oauth`        | no       | OAuth client 設定               |
| `mcpServers`   | no       | MCP 公開設定                    |
| `fileHandlers` | no       | ファイルハンドラー              |
| `overrides`    | no       | 環境別 override                 |

## `workers.<name>`

| field         | required | 説明                       |
| ------------- | -------- | -------------------------- |
| `build`       | yes      | 現在は `fromWorkflow` のみ |
| `containers`  | no       | `spec.containers` の名前   |
| `bindings`    | no       | Cloudflare-native bindings |
| `triggers`    | no       | `schedules`, `queues`      |
| `env`         | no       | Worker 固有 env            |
| `healthCheck` | no       | ヘルスチェック             |
| `scaling`     | no       | スケーリング設定           |
| `dependsOn`   | no       | 他 workload への依存       |

## `services.<name>`

| field         | required | 説明                                              |
| ------------- | -------- | ------------------------------------------------- |
| `dockerfile`  | no       | local/offline build 用 Dockerfile path            |
| `imageRef`    | no       | online `takos apply` が使う deploy 済み image ref |
| `artifact`    | no       | `kind: image` の direct image artifact            |
| `provider`    | no       | `oci`, `ecs`, `cloud-run`, `k8s`                  |
| `port`        | yes      | listen port                                       |
| `bindings`    | no       | workers と同じ binding syntax                     |
| `triggers`    | no       | 現在は `schedules` のみ                           |
| `env`         | no       | service env                                       |
| `healthCheck` | no       | ヘルスチェック                                    |
| `volumes`     | no       | volume mount                                      |
| `dependsOn`   | no       | 他 workload への依存                              |

## `workers.<name>.bindings` / `services.<name>.bindings`

| key               | resource type     |
| ----------------- | ----------------- |
| `d1`              | `d1`              |
| `r2`              | `r2`              |
| `kv`              | `kv`              |
| `queues`          | `queue`           |
| `vectorize`       | `vectorize`       |
| `analyticsEngine` | `analyticsEngine` |
| `workflow`        | `workflow`        |
| `durableObjects`  | `durableObject`   |
| `services`        | 他 workload       |

## `resources.<name>`

共通フィールド:

| field        | required | 説明                            |
| ------------ | -------- | ------------------------------- |
| `type`       | yes      | Cloudflare-native resource kind |
| `binding`    | no       | runtime binding 名              |
| `generate`   | no       | secret 用自動生成               |
| `migrations` | no       | d1 用 migration path            |
| `limits`     | no       | 論理制限                        |

`type` に使える値:

| type              | 追加フィールド                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- |
| `d1`              | `migrations`                                                                       |
| `r2`              | -                                                                                  |
| `kv`              | -                                                                                  |
| `queue`           | `queue.maxRetries`, `queue.deadLetterQueue`, `queue.deliveryDelaySeconds`          |
| `vectorize`       | `vectorize.dimensions`, `vectorize.metric`                                         |
| `analyticsEngine` | `analyticsEngine.dataset`                                                          |
| `secretRef`       | `generate`                                                                         |
| `workflow`        | `workflow.service`, `workflow.export`, `workflow.timeoutMs`, `workflow.maxRetries` |
| `durableObject`   | `durableObject.className`, `durableObject.scriptName`                              |

`class` と `backing` はサポートしません。

`workflow` は manifest でも service settings API / tool
でも設定できます。dynamic binding でも `workflow.service` と `workflow.export`
の metadata が必要です。`workflow.service` は worker 名または service
名を参照します。

`services.<name>` は `dockerfile` / `imageRef` / `artifact.kind=image`
のいずれかが必要です。`takos apply` は full deployment pipeline
を通るため、`workers` は `build.fromWorkflow.artifactPath` から bundle
を解決し、`services` / `containers` は `imageRef` か `artifact.kind=image`
を使います。`dockerfile` だけでは online apply の deploy source
としては不十分です。

## routes[]

| field       | required | 説明                            |
| ----------- | -------- | ------------------------------- |
| `name`      | yes      | route 名                        |
| `target`    | yes      | worker / service / container 名 |
| `path`      | no       | 公開 path                       |
| `ingress`   | no       | ingress workload                |
| `timeoutMs` | no       | route timeout                   |
| `methods`   | no       | 許可 HTTP method                |

custom domain / hostname routing はこの manifest の canonical desired state
には含めません。これらは routing / observed surface として別 API で扱います。

## mcpServers[]

| field           | required | 説明                       |
| --------------- | -------- | -------------------------- |
| `name`          | yes      | MCP 名                     |
| `route`         | yes*     | `routes[].name` を参照     |
| `endpoint`      | yes*     | 外部 URL                   |
| `transport`     | yes      | `streamable-http`          |
| `authSecretRef` | no       | `type: secret` resource 名 |

`route` と `endpoint` は排他です。
