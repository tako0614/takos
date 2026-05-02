# Manifest (Shape Model)

このページは新しい **Shape + Provider + Template** model における
manifest envelope の書き方をまとめます。`resources[]` で portable な
[Shape](./shape-catalog.md) resource を declarative に並べ、`template:` で
[Template](./templates.md) を呼び、`${ref:...}` syntax で resource 間の
output を配線します。

> 旧 `target` + `services[]` (legacy profile model) を使う環境向けの
> reference は [Manifest Spec (legacy)](/reference/manifest-spec) を参照
> してください。新 model はそれを段階的に置き換えます。

## Envelope 概観

```yaml
name: my-app                        # logical app name
template:                           # optional: Template invocation
  ref: web-app-on-cloudflare@v1
  inputs: { ... }
resources:                          # optional: portable Shape resources
  - shape: object-store@v1
    name: assets
    provider: cloudflare-r2
    requires: [presigned-urls]
    spec: { name: app-assets }
```

`template` と `resources[]` は併用できます。`template` の expansion 結果に
`resources[]` を **append** する semantics です ([§ template と resources の併用](#template-と-resources-の併用))。

## `resources[]` field

各 entry は contract の `ManifestResource`:

```ts
interface ManifestResource {
  readonly shape: string;        // "object-store@v1" 等
  readonly name: string;         // resource 論理名 (manifest scope)
  readonly provider: string;     // provider id e.g. "aws-s3"
  readonly spec: JsonValue;      // shape の Spec 型に validate される
  readonly requires?: readonly string[];  // capability requirement
  readonly metadata?: JsonObject;
}
```

- `name` は manifest 内で unique。`${ref:<name>.<field>}` で参照されます。
- `spec` は `<shape>.validateSpec` で validate (`shape: object-store@v1` なら
  `ObjectStoreShape.validateSpec`)。
- `provider` の `implements` が `shape` と一致しない場合は manifest reject。

## `${ref:...}` / `${secret-ref:...}` syntax {#ref-syntax}

resource 間の配線は **string interpolation** で行います。kernel が DAG
解決後に `RefResolver` で展開します。

```yaml
resources:
  - shape: database-postgres@v1
    name: db
    provider: aws-rds
    spec: { version: "16", size: small }

  - shape: web-service@v1
    name: api
    provider: aws-fargate
    spec:
      image: ghcr.io/example/api@sha256:0123...
      port: 8080
      scale: { min: 1, max: 3 }
      bindings:
        DATABASE_URL: ${ref:db.connectionString}
        DB_PASSWORD:  ${secret-ref:db.passwordSecretRef}
```

Syntax 仕様 (cf.
[`manifest-resource.ts`](https://github.com/takos-jp/takosumi/blob/main/src/sdk/manifest.ts) /
contract `parseRef` / `extractRefs`):

| 記法                                  | 意味                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `${ref:<name>.<field>}`               | 別 resource の **non-secret** output field を埋め込む             |
| `${secret-ref:<name>.<field>}`        | secret reference URI (`secret://...`) を埋め込む                  |

- `<name>` / `<field>` は `[A-Za-z_][\w-]*` パターン。
- `<field>` が当該 Shape の `outputFields` に含まれていなければ reject。
- 1 文字列内に複数 `${ref:...}` を混在可能。string concatenation 用途も OK。

## Capability `requires`

`resources[].requires` は **そのリソースに対する capability 要件** です。
provider が declare している `capabilities` が `requires` を superset で
満たさないと selection で reject されます。

```yaml
resources:
  - shape: object-store@v1
    name: assets
    provider: cloudflare-r2
    requires: [presigned-urls, multipart-upload]   # 通る
    spec: { name: app-assets }

  - shape: object-store@v1
    name: archive
    provider: cloudflare-r2
    requires: [versioning]   # cloudflare-r2 は versioning を declare していない → reject
    spec: { name: app-archive }
```

検証は contract `capabilitySubsetIssues(required, provided, path)` (cf.
[provider-plugin.ts](https://github.com/takos-jp/takosumi/blob/main/src/operator/client_registry.ts))
で行われます。

## DAG / topological apply order

`${ref:...}` は **依存 edge** を作ります。kernel は manifest を topological
sort して以下の順で adapter を呼びます:

1. **DAG build** — `extractRefsFromValue(spec)` で各 resource の参照先を抽出。
2. **Cycle detection** — 自己ループ / 相互参照を検出した場合は reject。
3. **Apply phase (topological order)** — 各 resource の `provider.apply(spec, ctx)` を順に実行。
   `ctx.refResolver.resolve(...)` は既に apply 済み resource の outputs を
   返します。
4. **Status phase** — apply 後に各 resource の `status(handle, ctx)` で確認。
5. **Rollback on failure** — apply phase で失敗した時点までに作られた
   resource は **逆順** に `destroy(handle, ctx)` されます (best effort)。

## Template と resources の併用

```yaml
name: my-app
template:
  ref: web-app-on-cloudflare@v1
  inputs:
    serviceName: app
    image: ghcr.io/example/app@sha256:abcd...
    port: 8080
    domain: app.example.com

resources:
  - shape: object-store@v1
    name: backups
    provider: aws-s3
    requires: [versioning, server-side-encryption]
    spec: { name: app-backups, versioning: true }
```

template が `app` / `db` / `assets` / `domain` を expand した上に、追加で
`backups` resource が aws-s3 で apply されます。`${ref:app.url}` のような
template 内部の参照は template 側で既に解決されており、外側 `resources[]`
からも `${ref:app.url}` で参照できます。

## Side-by-side: legacy profile vs new shape model

::: code-group

```yaml [legacy (target + services)]
target: cloudflare
services:
  app:
    runtime: cloudflare-container
    image: ghcr.io/example/app@sha256:abcd...
    port: 8080
  db:
    profile: aws-rds
    version: "16"
domains:
  - host: app.example.com
    service: app
```

```yaml [new (resources[] + ${ref:...})]
name: my-app
resources:
  - shape: database-postgres@v1
    name: db
    provider: aws-rds
    spec: { version: "16", size: small }

  - shape: web-service@v1
    name: app
    provider: cloudflare-container
    spec:
      image: ghcr.io/example/app@sha256:abcd...
      port: 8080
      scale: { min: 0, max: 10 }
      bindings:
        DATABASE_URL: ${ref:db.connectionString}

  - shape: custom-domain@v1
    name: domain
    provider: cloudflare-dns
    spec:
      name: app.example.com
      target: ${ref:app.url}
```

:::

新 model の良い点:

- **portable** — `provider:` を `aws-fargate` / `k3s-deployment` 等に差し替えるだけで cloud 切替。
- **explicit** — `${ref:db.connectionString}` で配線が manifest に書かれており、ブラックボックスがない。
- **DAG** — 依存解析が contract 側で portable に行われる。

## 関連ページ

- [Shape Catalog](./shape-catalog.md) — 各 Shape の spec / outputs / capabilities
- [Provider Plugins](./provider-plugins.md) — provider id と実装
- [Templates](./templates.md) — `template:` で展開する bundled template
- [Operator Bootstrap](./operator-bootstrap.md) — operator 側 wire 手順
- [Extending](./extending.md) — provider / shape / template 拡張
- [Manifest Spec (legacy)](/reference/manifest-spec) — `target+services` 形式の legacy reference
