# Templates

**Template** は複数 [Shape](./shape-catalog.md) resource をまとめて
expand する authoring 短縮です。manifest の `template:` field に template id と
inputs を書くと、kernel が `expand(inputs)` を呼んで `resources[]` を生成します。
expansion 後の resource は通常の DAG / capability selection を通ります。

## Template の構造

```ts
interface Template<Inputs> {
  readonly id: string;                         // e.g. "web-app-on-cloudflare"
  readonly version: string;                    // semver
  readonly description?: string;
  validateInputs(value: unknown, issues: TemplateValidationIssue[]): void;
  expand(inputs: Inputs): readonly ManifestResource[];
}
```

template 自体に provider は含まれません。expansion 結果の `ManifestResource[]`
が provider id を持ち、それを kernel が `requires` / `capabilities` 規則で
selection します ([Provider Plugins § Provider selection](./provider-plugins.md#provider-selection-と-requires))。

## Bundled templates

`takosumi` は 2 つの template を bundle しています。

| template id              | version | summary                                                        |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `selfhosted-single-vm`   | `v1`    | 1 ホスト selfhost — web + Postgres + filesystem + (任意で DNS) |
| `web-app-on-cloudflare`  | `v1`    | Cloudflare edge — CF Container + R2 + DNS + pluggable Postgres |

source: [`src/templates/`](https://github.com/takos-jp/takosumi/tree/main/src/templates)

## `selfhosted-single-vm@v1` {#selfhosted-single-vm-v1}

### 用途

開発機や 1 台 VPS で **「とりあえず Takosumi 全部入り」** を立ち上げる用途。
shape selection は全て selfhosted な provider で固定されます。

### Inputs

```ts
interface SelfhostedSingleVmInputs {
  readonly serviceName: string;          // web service の論理名
  readonly image: string;                // OCI image
  readonly port: number;                 // 内部 listen port
  readonly databaseVersion?: string;     // 既定 "16"
  readonly assetsBucketName?: string;    // 既定 "<serviceName>-assets"
  readonly domain?: string;              // optional, custom-domain を作る
}
```

### Manifest 例

```yaml
name: my-selfhost-app
template:
  ref: selfhosted-single-vm@v1
  inputs:
    serviceName: api
    image: ghcr.io/example/api@sha256:0123...
    port: 8080
    domain: api.lan
```

### Expansion 結果

| resource name | shape                  | provider          | spec の要点                                            |
| ------------- | ---------------------- | ----------------- | ------------------------------------------------------ |
| `db`          | `database-postgres@v1` | `local-docker`    | `version: "16"`, `size: "small"`                       |
| `assets`      | `object-store@v1`      | `filesystem`      | `name: api-assets`                                     |
| `api`         | `web-service@v1`       | `docker-compose`  | `image`, `port`, `scale.min/max=1`, bindings 自動注入  |
| `domain`      | `custom-domain@v1`     | `coredns-local`   | `name: api.lan`, `target: ${ref:api.url}` (任意)       |

`bindings` には `DATABASE_URL=${ref:db.connectionString}`, `ASSETS_BUCKET=${ref:assets.bucket}`
が自動注入されます。

source: [`templates/selfhosted-single-vm.ts`](https://github.com/takos-jp/takosumi/blob/main/src/templates/selfhosted-single-vm.ts)

## `web-app-on-cloudflare@v1`

### 用途

Cloudflare edge を front に置いた典型的な web app 構成。Postgres は
`databaseProvider` で AWS RDS / GCP Cloud SQL / local-docker のいずれかを選べます。

### Inputs

```ts
interface WebAppOnCloudflareInputs {
  readonly serviceName: string;
  readonly image: string;
  readonly port: number;
  readonly domain: string;                                              // 必須
  readonly assetsBucketName?: string;
  readonly databaseProvider?: "aws-rds" | "cloud-sql" | "local-docker"; // 既定 "aws-rds"
  readonly databaseVersion?: string;
}
```

### Manifest 例

```yaml
name: my-edge-app
template:
  ref: web-app-on-cloudflare@v1
  inputs:
    serviceName: app
    image: ghcr.io/example/app@sha256:0123...
    port: 8080
    domain: app.example.com
    databaseProvider: aws-rds
```

### Expansion 結果

| resource name | shape                  | provider               | spec の要点                                                        |
| ------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------ |
| `db`          | `database-postgres@v1` | (`databaseProvider`)   | `version: "16"`, `size: "small"`                                   |
| `assets`      | `object-store@v1`      | `cloudflare-r2`        | `name: app-assets`, `public: false`                                |
| `app`         | `web-service@v1`       | `cloudflare-container` | `scale.min=0, max=10`, bindings に DB / R2 endpoint 注入            |
| `domain`      | `custom-domain@v1`     | `cloudflare-dns`       | `name: app.example.com`, `target: ${ref:app.url}`                  |

`bindings` には `DATABASE_URL`, `ASSETS_BUCKET`, `ASSETS_ENDPOINT` が
`${ref:...}` 形式で自動注入されます。CF Container は `scale.min: 0` で
scale-to-zero (cf. [`cloudflare-container` capabilities](./provider-plugins.md#webservice-6-providers))。

source: [`templates/web-app-on-cloudflare.ts`](https://github.com/takos-jp/takosumi/blob/main/src/templates/web-app-on-cloudflare.ts)

## Template と `resources[]` の関係

template と `resources[]` は **排他ではありません**。template が expand した
`ManifestResource[]` の上に、`resources[]` で追加 resource を足す合成も可能です
(detail は [Manifest § template + resources](./manifest.md#template-と-resources-の併用) を参照)。

## 新 template を追加する

template は **既存 Shape / Provider の合成** だけで作れます。新 Shape を
増やす必要はありません。手順は [Extending § 新 template の追加](./extending.md#新-template-の追加)
を参照してください。

## 関連ページ

- [Shape Catalog](./shape-catalog.md) — 各 Shape の field 定義
- [Provider Plugins](./provider-plugins.md) — template が expand 先で使う 18 provider
- [Manifest](./manifest.md) — `template:` field と `resources[]` の syntax
- [Extending](./extending.md) — template / provider / shape 拡張ガイド
