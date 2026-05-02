# Shape Catalog

Takos が公式に curate する **Shape** (portable resource shape) の一覧と
spec / outputs / capabilities を定義します。Shape は manifest が宣言する
**抽象 resource 型** であり、provider plugin (cf. [Provider Plugins](./provider-plugins.md))
によって実装されます。

> Shape は Takos ecosystem ownership。新規 Shape の追加には RFC が必要です
> ([Extending](./extending.md#新しい-shape-を-rfc-する))。

## 設計原則

- **Takos curates the shape catalog.** 新しいクラウド対応は **provider** を増やすことで行い、
  Shape そのものを増やすのは breaking change として扱います。
- **Capabilities are advisory.** provider plugin が `capabilities` で optional
  feature を宣言します。manifest 側 `requires:` を満たさない provider は selection
  対象から除外されます。
- **Outputs はポータブル.** Shape ごとに output field 名が固定されており、
  別 resource から `${ref:<resource>.<field>}` で参照できます (cf.
  [Manifest](./manifest.md#ref-syntax))。

## 4 つの curated Shape

| Shape id            | version | description                                                  |
| ------------------- | ------- | ------------------------------------------------------------ |
| `object-store`      | `v1`    | bucket-style object storage; S3-class API portable           |
| `web-service`       | `v1`    | long-running HTTP service backed by an OCI image equivalent  |
| `database-postgres` | `v1`    | managed PostgreSQL instance (wire-protocol portable)         |
| `custom-domain`     | `v1`    | DNS + TLS-terminated public domain                           |

## `object-store@v1`

S3 互換の bucket-style object storage。

### Spec (`ObjectStoreSpec`)

```ts
interface ObjectStoreSpec {
  readonly name: string;                  // bucket 物理名
  readonly public?: boolean;              // public-read を許すか
  readonly versioning?: boolean;          // object versioning を有効化
  readonly region?: string;               // region hint (provider 既定値あり)
  readonly lifecycle?: {
    readonly expireAfterDays?: number;
    readonly archiveAfterDays?: number;
  };
}
```

### Outputs (`ObjectStoreOutputs`)

| field            | semantics                                                  |
| ---------------- | ---------------------------------------------------------- |
| `bucket`         | provider 上の bucket 物理名                                |
| `endpoint`       | S3-compatible endpoint URL (`https://...`)                 |
| `region`         | resolved region                                            |
| `accessKeyRef`   | secret reference URI (`secret://...`)                      |
| `secretKeyRef`   | secret reference URI (`secret://...`)                      |

### Capabilities

| capability               | semantics                                                  |
| ------------------------ | ---------------------------------------------------------- |
| `versioning`             | object version 履歴の保持                                  |
| `presigned-urls`         | 時限付き署名 URL 発行                                      |
| `server-side-encryption` | bucket レベルでの SSE                                      |
| `public-access`          | public-read object を許す                                  |
| `event-notifications`    | object event の外部通知                                    |
| `lifecycle-rules`        | TTL / archive lifecycle rule                               |
| `multipart-upload`       | マルチパートアップロード API                               |

source: [`src/shapes/object-store.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shapes/object-store.ts)

## `web-service@v1`

OCI image (相当) を always-on / scale-to-zero で動かす HTTP service。

### Spec (`WebServiceSpec`)

```ts
interface WebServiceSpec {
  readonly image: string;                 // OCI image (digest pin 推奨)
  readonly port: number;                  // service が listen する port
  readonly scale: {
    readonly min: number;                 // 0 で scale-to-zero
    readonly max: number;
    readonly idleSeconds?: number;
  };
  readonly env?: Readonly<Record<string, string>>;
  readonly bindings?: Readonly<Record<string, string>>;
  readonly health?: { path: string; intervalSeconds?: number; timeoutSeconds?: number };
  readonly resources?: { cpu?: string; memory?: string };
  readonly command?: readonly string[];
  readonly domains?: readonly string[];
}
```

`bindings` は他 resource の output (`${ref:db.connectionString}` など) を
runtime env として注入する用途です。`env` は plain literal 用。

### Outputs (`WebServiceOutputs`)

| field           | semantics                                              |
| --------------- | ------------------------------------------------------ |
| `url`           | 外部公開 URL (`https://...`)                           |
| `internalHost`  | 内部 DNS name (provider scope)                         |
| `internalPort`  | 内部 listen port                                       |

### Capabilities

| capability            | semantics                                       |
| --------------------- | ----------------------------------------------- |
| `always-on`           | `min ≥ 1` を維持                                |
| `scale-to-zero`       | アイドル時 instance 0 を許す                    |
| `websocket`           | WebSocket pass-through                          |
| `long-request`        | 30 秒以上のリクエストを許容                     |
| `sticky-session`      | session affinity                                |
| `geo-routing`         | edge-aware ルーティング                         |
| `crons`               | scheduled invocation                            |
| `private-networking`  | private VPC / mesh 経由通信                     |

source: [`src/shapes/web-service.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shapes/web-service.ts)

## `database-postgres@v1`

managed PostgreSQL。wire protocol 互換のため provider portable。

### Spec (`DatabasePostgresSpec`)

```ts
interface DatabasePostgresSpec {
  readonly version: string;                       // "16" など
  readonly size: "small" | "medium" | "large" | "xlarge";
  readonly storage?: { sizeGiB: number; type?: "ssd" | "hdd" };
  readonly backups?: { enabled: boolean; retentionDays?: number };
  readonly highAvailability?: boolean;
  readonly extensions?: readonly string[];
}
```

### Outputs (`DatabasePostgresOutputs`)

| field                | semantics                                                        |
| -------------------- | ---------------------------------------------------------------- |
| `host`               | 接続先 host (private DNS / public hostname)                      |
| `port`               | listen port                                                      |
| `database`           | 既定 database 名                                                 |
| `username`           | application 用 role 名                                           |
| `passwordSecretRef`  | secret reference URI                                             |
| `connectionString`   | scheme 付き接続文字列 `postgresql://...`                         |

### Capabilities

| capability           | semantics                                       |
| -------------------- | ----------------------------------------------- |
| `pitr`               | point-in-time recovery                          |
| `read-replicas`      | read replica の追加                             |
| `high-availability`  | multi-AZ / HA failover                          |
| `backups`            | 自動バックアップ                                |
| `ssl-required`       | SSL 接続強制                                    |
| `ipv6`               | IPv6 host                                       |
| `extensions`         | PostgreSQL extension のロード                   |

source: [`src/shapes/database-postgres.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shapes/database-postgres.ts)

## `custom-domain@v1`

DNS record + TLS termination でつくる public domain。`web-service` の `url`
を `${ref:web.url}` 形式で `target:` に渡すのが定番パターンです。

### Spec (`CustomDomainSpec`)

```ts
interface CustomDomainSpec {
  readonly name: string;        // FQDN
  readonly target: string;      // 通常 ${ref:<webservice>.url}
  readonly certificate?: { kind: "auto" | "managed" | "provided"; secretRef?: string };
  readonly redirects?: readonly { from: string; to: string; code?: 301 | 302 | 307 | 308 }[];
}
```

### Outputs (`CustomDomainOutputs`)

| field            | semantics                                                  |
| ---------------- | ---------------------------------------------------------- |
| `fqdn`           | 解決後の FQDN                                              |
| `certificateArn` | TLS 証明書識別子 (provider scope, optional)                |
| `nameservers`    | NS が必要な場合の delegation 一覧 (optional)               |

### Capabilities

| capability    | semantics                                       |
| ------------- | ----------------------------------------------- |
| `wildcard`    | wildcard FQDN サポート                          |
| `auto-tls`    | 自動証明書発行 (ACME / ZeroSSL 等)              |
| `sni`         | Server Name Indication                          |
| `http3`       | HTTP/3                                          |
| `alpn-acme`   | ALPN-based ACME challenge                       |
| `redirects`   | declarative redirect rule                       |

source: [`src/shapes/custom-domain.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shapes/custom-domain.ts)

## 関連ページ

- [Provider Plugins](./provider-plugins.md) — 各 Shape を実装する 18 provider
- [Manifest](./manifest.md) — `resources[]` と `${ref:...}` の書き方
- [Templates](./templates.md) — bundled 2 template
- [Extending](./extending.md) — provider 追加 / Shape RFC のフロー
