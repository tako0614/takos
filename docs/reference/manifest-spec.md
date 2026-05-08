# マニフェストリファレンス

このページは `.takosumi/manifest.yml` の正本仕様です。Installable App Model
では、app metadata と compute manifest を分離します。

| ファイル                 | 用途                                                                          | 渡し先                                 |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------------------- |
| `.takosumi/app.yml`      | InstallableApp v1。install UI / binding / permission preview / upgrade policy | `takosumi-git` と Takosumi Accounts    |
| `.takosumi/manifest.yml` | kernel-bound compute manifest。Shape resource / template / service import     | takosumi kernel `POST /v1/deployments` |

`.takosumi/app.yml` は kernel に渡しません。`.takosumi/manifest.yml` は
`takosumi-git` / `takosumi-cloud` が compile し、`workflowRef` や
`${artifacts.*}` / `${bindings.*}` などの installer-only placeholder
群を取り除いた上で kernel に渡します。

旧 `components` / `routes` / `bindings` / `publications` / `environments` /
`policy` AppSpec surface は current kernel-bound manifest ではありません。新規
docs / app は `apiVersion: "1.0"` + `kind: Manifest` + `resources[]` の Shape
model で書きます。旧語彙へのリンクは本ページ末尾の migration anchor に残して
います。

## Envelope

Takosumi v1 manifest は closed envelope です。top-level field は次の集合だけを
受理します。

```text
@context | apiVersion | kind | namespace | metadata | template | services | imports | serviceResolvers | resources
```

`apiVersion` と `kind` は必須で、値は固定です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
  labels:
    tier: demo
resources: []
```

| field              | required | type                    | 説明                                                  |
| ------------------ | -------- | ----------------------- | ----------------------------------------------------- |
| `@context`         | no       | string / object / array | JSON-LD tooling 用 hint。deploy decision には使わない |
| `apiVersion`       | yes      | `"1.0"`                 | v1 manifest schema version                            |
| `kind`             | yes      | `"Manifest"`            | v1 manifest kind                                      |
| `namespace`        | no       | string                  | provider 側 service export の namespace               |
| `metadata`         | no       | object                  | `name` / `labels` / kernel audit metadata             |
| `template`         | no       | object                  | bundled template invocation                           |
| `services`         | no       | array                   | provider 側 cross-instance service export             |
| `imports`          | no       | array                   | consumer 側 service import                            |
| `serviceResolvers` | no       | array                   | `imports[]` を anchor で resolve する pin             |
| `resources`        | no       | array                   | portable Shape resources                              |

`template` と `resources[]` は併用できます。template expansion の結果に explicit
`resources[]` が append されます。`template` も `resources[]` も無い
manifest、または expansion 後に resource が 0 件になる manifest は reject
されます。

## Canonical minimal manifest {#canonical-minimal-manifest}

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: hello-worker
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
      routes:
        - hello.example.com/*
```

Container service の例:

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/aws-rds"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
```

## Resources

`resources[]` の各 entry は `ManifestResource` です。

```ts
interface ManifestResource {
  readonly shape: string;
  readonly name: string;
  readonly provider: string;
  readonly spec: JsonValue;
  readonly requires?: readonly string[];
  readonly metadata?: JsonObject;
}
```

| field      | required | 説明                                                          |
| ---------- | -------- | ------------------------------------------------------------- |
| `shape`    | yes      | portable resource contract。例 `web-service@v1` / `worker@v1` |
| `name`     | yes      | manifest 内で一意の resource 名                               |
| `provider` | yes      | provider id。例 `@takos/cloudflare-workers`                   |
| `spec`     | yes      | shape 固有 spec。shape validator が検証する                   |
| `requires` | no       | provider capability requirement                               |
| `metadata` | no       | resource-level metadata / audit pin                           |

`shape` と `provider` の組み合わせは catalog / provider registry
で検証されます。 provider が shape を実装していない場合、または `requires[]`
を満たせない場合は reject されます。

`workflowRef` は takosumi-git の authoring extension
です。`.takosumi/manifest.yml` 内では resource
に併記できますが、`takosumi-git push` / `install apply` が workflow
を実行し、artifact URI を `workflowRef.target` (省略時 `spec.image`)
に書き込んでから `workflowRef` を strip します。kernel が受け取る manifest
resource entry に `workflowRef` は存在してはいけません。

worker bundle の authoring 例:

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: docs
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
    workflowRef:
      file: build.yml
      job: build-worker
      artifact: bundle
      target: spec.artifact.hash
```

## Resource references

kernel が解決する resource 間参照は `${ref:...}` と `${secret-ref:...}`
だけです。

| syntax                             | 意味                               |
| ---------------------------------- | ---------------------------------- |
| `${ref:<resource>.<field>}`        | non-secret output field を埋め込む |
| `${secret-ref:<resource>.<field>}` | secret reference URI を埋め込む    |

```yaml
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/aws-rds"
    spec: { version: "16", size: small }

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        DB_PASSWORD: ${secret-ref:db.passwordSecretRef}
```

参照は dependency edge を作ります。kernel は cycle を reject し、topological
order で provider apply を実行します。

## Templates

`template` は bundled template を呼び出すための authoring macro です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: web
template:
  template: web-app-on-cloudflare@v1
  inputs:
    serviceName: web
    image: ghcr.io/example/web@sha256:0123456789abcdef
    port: 8080
    domain: web.example.com
resources:
  - shape: object-store@v1
    name: backups
    provider: "@takos/aws-s3"
    requires: [versioning]
    spec:
      name: web-backups
```

remote kernel manifest では `template.template` に `id@version` を書きます。
`template.ref` は early v1 client 用の deprecated compatibility alias です。
新規 docs / app では使いません。

## Compile-time placeholders {#compile-time-placeholders}

Installable App Model の `.takosumi/manifest.yml` は、kernel 到達前に
takosumi-git / takosumi-cloud が materialize する placeholder を含められます。
compile 後の kernel-bound manifest には残してはいけません。

| placeholder family             | 解決元                                | 例                             |
| ------------------------------ | ------------------------------------- | ------------------------------ |
| `${params.<key>}`              | Install API request params            | `${params.domain}`             |
| `${installation.<key>}`        | AppInstallation record                | `${installation.id}`           |
| `${artifacts.<name>.<key>}`    | takosumi-git workflow artifact        | `${artifacts.api.image}`       |
| `${bindings.<name>.<key>}`     | AppBinding resolved config            | `${bindings.auth.clientId}`    |
| `${secrets.<name>.<key>}`      | AppBinding secret refs                | `${secrets.auth.clientSecret}` |
| `${env.<key>}`                 | runtime env passthrough               | `${env.LOG_LEVEL}`             |
| `${refs.<name>.outputs.<key>}` | legacy Takos app compiler placeholder | `${refs.db.outputs.url}`       |

service import placeholders are materialized by the kernel public deploy route
after anchor resolution:

| placeholder                                | 意味                        |
| ------------------------------------------ | --------------------------- |
| `${imports.<alias>.endpoints.<role>.url}`  | resolved endpoint URL       |
| `${imports.<alias>.endpoints.<role>.path}` | resolved endpoint path      |
| `${imports.<alias>.metadata.<key>}`        | descriptor metadata value   |
| `${imports.<alias>.serviceId}`             | resolved service identifier |

`bindings.` prefix is accepted for service import placeholders as a
compatibility alias, but current manifests should use `imports.`.

## Cross-instance imports {#cross-instance-imports}

external service dependency は service identifier と anchor resolver
で表現します。 consumer manifest に endpoint hostname を直接書きません。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
serviceResolvers:
  - kind: anchor
    url: https://anchor.example.com/v1/services/
    publicKey: ${secrets.anchorPublicKey}
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
```

`imports[]` を持つ manifest は `serviceResolvers[]` が必須です。kernel は anchor
から provider-signed `ServiceDescriptor` を取得し、signature / contract version
/ expiry を検証し、descriptor digest と provider instance を audit pin として
resource metadata / WAL に残します。kernel は global service registry を持ちま
せん。

provider 側 service export は `namespace` + `services[]` で宣言します。

```yaml
apiVersion: "1.0"
kind: Manifest
namespace: takosumi
services:
  - id: takosumi.account.auth
    version: v1
    contract: takosumi.account.auth@v1
    endpoints:
      - role: oidc-issuer
        url: ${ref:account-auth.url}
        path: /
    publish:
      anchors:
        - https://anchor.example.com/v1/services/
      signing:
        privateKeyRef: ${secrets.providerSigningKey}
resources:
  - shape: web-service@v1
    name: account-auth
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/accounts@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
```

## Validation

主な reject 条件:

- `apiVersion` が `"1.0"` ではない、または `kind` が `Manifest` ではない
- unknown top-level field がある
- `resources[]` が array ではない
- resource entry に `shape` / `name` / `provider` / `spec` 以外の必須 field
  欠落がある
- resource entry に `workflowRef` など kernel-bound manifest では未知の field
  が残っている
- `imports[]` があるのに `serviceResolvers[]` が無い
- service identifier が forward 3-level dotted form ではない
- `${ref:...}` / `${secret-ref:...}` が存在しない resource output を参照する
- service import placeholder が standalone placeholder ではない

validation order は takosumi kernel の
[Core Contract v1.0](/takosumi/core/01-core-contract-v1.0) に従います。

## Legacy routes anchor {#_3-routes}

旧 AppSpec の `routes[]` section は current `.takosumi/manifest.yml` から削除
されました。HTTP ingress / domain / worker route は shape の `spec` または
`custom-domain@v1` resource で表現します。old docs からこの anchor に来た場合
は、[Resources](#resources) と
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
を参照してください。

## Legacy bindings anchor {#_5-bindings}

旧 AppSpec の `bindings[]` section は current kernel-bound manifest ではありま
せん。install-time binding は `.takosumi/app.yml` の `identity.oidc@v1` /
`database.postgres@v1` / `object-store.s3-compatible@v1` / `service.import@v1`
などで宣言し、takosumi-git / Takosumi Accounts が runtime env や secret refs に
materialize します。kernel 内の resource 間配線は `${ref:...}` /
`${secret-ref:...}`、cross-instance service は `imports[]` を使います。

## Legacy environment merge anchor {#_7-1-merge-rules}

旧 AppSpec の `environments.<env>` deep merge rule は current
`.takosumi/manifest.yml` の正本仕様ではありません。環境差分は distribution
profile、Install API params、または operator-owned manifest generation で扱い
ます。kernel-bound manifest は apply 時点で具体化された closed envelope です。

## Migration note

rejected legacy form:

```yaml
name: my-app
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
routes:
  - id: ui
    expose: { component: web, contract: http }
```

current form:

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
```

## Related

- [App YAML Spec](/reference/app-yml-spec) — install metadata / AppBinding /
  permissions
- [Binding Catalog](/reference/binding-catalog) — `identity.oidc@v1` /
  `service.import@v1`
- [Service Identifier Spec](/reference/service-identifier-spec) — forward
  3-level service identifier
- [Core Contract v1.0](/takosumi/core/01-core-contract-v1.0) — kernel-side
  Deployment model
- [API Reference](/reference/api) — `POST /v1/deployments`
