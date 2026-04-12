# マニフェストリファレンス

`.takos/app.yml` の canonical public contract です。

## 1. top-level fields

| field       | required | type   | 説明                |
| ----------- | -------- | ------ | ------------------- |
| `name`      | yes      | string | group 名            |
| `version`   | no       | string | display 用 version  |
| `compute`   | no       | object | workload map        |
| `routes`    | no       | array  | route 定義          |
| `publish`   | no       | array  | publication catalog |
| `env`       | no       | object | top-level env       |
| `overrides` | no       | object | 環境別 override     |

retired:

- `storage`
- top-level `scopes`
- top-level `oauth`
- `compute.<name>.capabilities`

## 2. compute

### 2.1 Worker

`build` を持つ compute は worker です。

| field                             | required | type   | 説明                   |
| --------------------------------- | -------- | ------ | ---------------------- |
| `build.fromWorkflow.path`         | yes      | string | workflow path          |
| `build.fromWorkflow.job`          | yes      | string | job 名                 |
| `build.fromWorkflow.artifact`     | yes      | string | artifact 名            |
| `build.fromWorkflow.artifactPath` | no       | string | artifact 内 path       |
| `readiness`                       | no       | string | readiness probe path   |
| `containers`                      | no       | object | attached container map |
| `triggers.schedules`              | no       | array  | cron schedule          |
| `consume`                         | no       | array  | publication consume    |
| `env`                             | no       | object | local env              |
| `depends`                         | no       | array  | compute 依存           |
| `scaling`                         | no       | object | provider-specific hint |
| `maxInstances`                    | no       | number | legacy scaling alias   |

### 2.2 Service

`image` を持つ compute は service です。

| field          | required | type   | 説明                   |
| -------------- | -------- | ------ | ---------------------- |
| `image`        | yes      | string | digest-pinned image    |
| `port`         | yes      | number | listen port            |
| `dockerfile`   | no       | string | local build 用         |
| `healthCheck`  | no       | object | health check           |
| `volumes`      | no       | object | volume mount           |
| `scaling`      | no       | object | provider-specific hint |
| `instanceType` | no       | string | instance hint          |
| `maxInstances` | no       | number | legacy scaling alias   |
| `consume`      | no       | array  | publication consume    |
| `env`          | no       | object | local env              |
| `depends`      | no       | array  | compute 依存           |

### 2.3 Attached container

worker の `containers` 配下に定義します。

| field          | required | type   | 説明                   |
| -------------- | -------- | ------ | ---------------------- |
| `image`        | yes      | string | image                  |
| `port`         | no       | number | listen port            |
| `env`          | no       | object | local env              |
| `healthCheck`  | no       | object | health check           |
| `volumes`      | no       | object | volume mount           |
| `scaling`      | no       | object | provider-specific hint |
| `instanceType` | no       | string | instance hint          |
| `maxInstances` | no       | number | legacy scaling alias   |
| `consume`      | no       | array  | publication consume    |
| `depends`      | no       | array  | compute 依存           |
| `dockerfile`   | no       | string | local build 用         |

`build.fromWorkflow.artifactPath` を省略した worker deploy では `dist/worker.js`
が既定値として使われます。`maxInstances` は `scaling.maxInstances` の legacy
alias です。

## 3. consume

```yaml
consume:
  - publication: shared-db
    env:
      endpoint: DATABASE_URL
      apiKey: DATABASE_API_KEY
```

| field         | required | type   | 説明                      |
| ------------- | -------- | ------ | ------------------------- |
| `publication` | yes      | string | publication 名            |
| `env`         | no       | object | output 名 -> env 名 alias |

同じ compute が同じ publication を重複参照すると invalid です。

## 4. triggers

```yaml
triggers:
  schedules:
    - cron: "0 * * * *"
```

`triggers.queues` は retired です。

## 5. depends

`depends` は同一 manifest の compute 名だけを参照します。

```yaml
depends:
  - api
```

## 6. routes

```yaml
routes:
  - target: web
    path: /
    methods: [GET, POST]
    timeoutMs: 30000
```

| field       | required | type     | 説明              |
| ----------- | -------- | -------- | ----------------- |
| `target`    | yes      | string   | compute 名        |
| `path`      | yes      | string   | `/` で始まる path |
| `methods`   | no       | string[] | allowed methods   |
| `timeoutMs` | no       | number   | timeout           |

## 7. publish

`publish` には 2 形態あります。route publication は公開経路を定義し、 provider
publication は provider-backed resource を定義します。required fields は別です。

### 7.1 route publication

```yaml
publish:
  - name: browser
    type: McpServer
    path: /mcp
    transport: streamable-http
```

required fields:

| field  | required | type   | 説明                   |
| ------ | -------- | ------ | ---------------------- |
| `name` | yes      | string | publication 名         |
| `type` | yes      | string | route publication 種別 |
| `path` | yes      | string | route path             |

optional route metadata:

- `transport`
- `authSecretRef`
- `title`
- `mimeTypes`
- `extensions`
- `icon`

route publication の代表的な `type`:

| type          | type-specific fields                                      |
| ------------- | --------------------------------------------------------- |
| `McpServer`   | `transport`, `authSecretRef`, `title`                     |
| `FileHandler` | `mimeTypes` または `extensions` の少なくとも一方, `title` |
| `UiSurface`   | `title`, `icon`                                           |

### 7.2 provider publication

```yaml
publish:
  - name: shared-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write
```

| field      | required | type   | 説明               |
| ---------- | -------- | ------ | ------------------ |
| `name`     | yes      | string | publication 名     |
| `provider` | yes      | string | provider 名        |
| `kind`     | yes      | string | provider kind      |
| `spec`     | yes      | object | kind-specific spec |

provider publication の output は `consume.env` で明示的に alias できます。
alias を省略した output は provider の default env 名を使います。

### 7.3 built-in Takos kinds

| provider/kind            | required spec fields     | outputs                              |
| ------------------------ | ------------------------ | ------------------------------------ |
| `takos/api`              | `scopes`                 | `endpoint`, `apiKey`                 |
| `takos/oauth-client`     | `redirectUris`, `scopes` | `clientId`, `clientSecret`, `issuer` |
| `takos/sql`              | `resource`               | `endpoint`, `apiKey`                 |
| `takos/object-store`     | `resource`               | `endpoint`, `apiKey`                 |
| `takos/key-value`        | `resource`               | `endpoint`, `apiKey`                 |
| `takos/queue`            | `resource`               | `endpoint`, `apiKey`                 |
| `takos/vector-index`     | `resource`               | `endpoint`, `apiKey`                 |
| `takos/analytics-engine` | `resource`               | `endpoint`, `apiKey`                 |

resource kinds では `permission` も optional に指定できます。値は `read`,
`write`, `admin` です。

## 8. env

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info
```

publication outputs と local env が衝突すると deploy / settings update
は失敗します。

## 9. overrides

```yaml
overrides:
  production:
    env:
      LOG_LEVEL: warn
    compute:
      web:
        scaling:
          minInstances: 2
```

`compute`, `routes`, `publish`, `env` を部分 override できます。
