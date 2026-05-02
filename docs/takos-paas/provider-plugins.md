# Provider Plugins

`takosumi` は curated [Shape](./shape-catalog.md) を実装する
**18 個の provider plugin** を bundle しています。各 provider は `ProviderPlugin<Spec, Outputs>`
を返す factory として `src/shape-providers/<shape>/<provider-id>.ts` に実装され、
`createTakosumiProductionProviders(opts)` 経由で operator が wire-in します
([Operator Bootstrap](./operator-bootstrap.md))。

## Provider plugin の構造

```ts
interface ProviderPlugin<Spec, Outputs> {
  readonly id: string;                                // e.g. "aws-s3"
  readonly version: string;                           // semver
  readonly implements: { id: string; version: string }; // shape ref
  readonly capabilities: readonly string[];           // declared capability set
  validate?(spec: Spec, issues: ProviderValidationIssue[]): void;
  apply(spec: Spec, ctx: PlatformContext): Promise<ApplyResult<Outputs>>;
  destroy(handle: ResourceHandle, ctx: PlatformContext): Promise<void>;
  status(handle: ResourceHandle, ctx: PlatformContext): Promise<ResourceStatus<Outputs>>;
}
```

各 provider は **lifecycle client** (`<Provider>LifecycleClient`) を inject
されます。テストでは `InMemory<Provider>Lifecycle`、production では
`factories.ts` 内の **gateway adapter** が wire されます (operator gateway を
HTTP で叩く)。lifecycle adapter が credential を直接保持することはありません。

source 一覧: [`src/shape-providers/`](https://github.com/takos-jp/takosumi/tree/main/src/shape-providers)

## ObjectStore (5 providers)

| provider id      | lifecycle adapter                                     | declared capabilities                                                                                            |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `aws-s3`         | AWS gateway (S3 API)                                  | `versioning`, `presigned-urls`, `server-side-encryption`, `public-access`, `event-notifications`, `lifecycle-rules`, `multipart-upload` |
| `cloudflare-r2`  | Cloudflare gateway (R2 API)                           | `presigned-urls`, `public-access`, `multipart-upload`                                                             |
| `gcp-gcs`        | GCP gateway (GCS API)                                 | `versioning`, `presigned-urls`, `server-side-encryption`, `public-access`, `event-notifications`, `lifecycle-rules`, `multipart-upload` |
| `minio`          | MinIO HTTP API (selfhosted)                           | `versioning`, `presigned-urls`, `server-side-encryption`, `public-access`, `lifecycle-rules`, `multipart-upload`  |
| `filesystem`     | local FS (dev / single-host)                          | `presigned-urls`                                                                                                  |

source 例: [`object-store/aws-s3.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/object-store/aws-s3.ts)

## WebService (6 providers)

| provider id            | lifecycle adapter                              | declared capabilities                                                       |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `aws-fargate`          | AWS gateway (ECS / Fargate task RPC)            | `always-on`, `websocket`, `long-request`, `sticky-session`, `private-networking` |
| `cloud-run`            | GCP gateway (Cloud Run admin API)               | `always-on`, `scale-to-zero`, `websocket`, `long-request`                   |
| `cloudflare-container` | Cloudflare gateway (Containers API)             | `scale-to-zero`, `geo-routing`                                              |
| `docker-compose`       | local `docker compose` CLI adapter              | `always-on`, `websocket`, `long-request`, `sticky-session`                  |
| `k3s-deployment`       | Kubernetes gateway (Deployment + Service apply) | `always-on`, `websocket`, `long-request`, `private-networking`              |
| `systemd-unit`         | local systemd `*.service` unit writer           | `always-on`, `long-request`                                                 |

source 例: [`web-service/cloudflare-container.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/web-service/cloudflare-container.ts)

## Database.Postgres (3 providers)

| provider id     | lifecycle adapter                              | declared capabilities                                                            |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `aws-rds`       | AWS gateway (RDS instance API)                 | `pitr`, `read-replicas`, `high-availability`, `backups`, `ssl-required`, `extensions` |
| `cloud-sql`     | GCP gateway (Cloud SQL admin API)              | `pitr`, `read-replicas`, `high-availability`, `backups`, `ssl-required`, `extensions` |
| `local-docker`  | local `docker run` CLI adapter (selfhosted)    | `ssl-required`, `extensions`                                                     |

source 例: [`database-postgres/aws-rds.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/database-postgres/aws-rds.ts)

## CustomDomain (4 providers)

| provider id        | lifecycle adapter                          | declared capabilities                  |
| ------------------ | ------------------------------------------ | -------------------------------------- |
| `cloudflare-dns`   | Cloudflare gateway (DNS records API)        | `wildcard`, `auto-tls`, `sni`, `http3` |
| `route53`          | AWS gateway (Route53 record sets API)       | `wildcard`, `auto-tls`, `sni`, `alpn-acme` |
| `cloud-dns`        | GCP gateway (Cloud DNS API)                 | `wildcard`, `auto-tls`, `sni`          |
| `coredns-local`    | local Corefile writer (selfhosted)          | `wildcard`                             |

source 例: [`custom-domain/cloudflare-dns.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/custom-domain/cloudflare-dns.ts)

## Provider selection と `requires:`

manifest の `resources[].requires` は **このリソースが必要とする capability**
を declarative に書きます。kernel は `requires` を満たさない provider を
選択しません。例:

```yaml
resources:
  - shape: object-store@v1
    name: assets
    provider: cloudflare-r2
    requires: [presigned-urls, multipart-upload]   # OK
    spec: { name: app-assets }
```

`cloudflare-r2` は `presigned-urls`/`multipart-upload` を declare しているため
selection を通過します。`versioning` を `requires` に書くと selection は失敗し、
manifest validation で reject されます (cf.
[Manifest § capability requires](./manifest.md#capability-requires))。

## Real client / lifecycle adapter {#real-client--lifecycle-adapter}

production 用の lifecycle adapter は
[`src/shape-providers/factories.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/factories.ts)
に集約されています。

- AWS / GCP / Cloudflare / Kubernetes: `JsonGateway` 経由で operator gateway に POST する
  thin HTTP adapter。credential は operator 側が保持し、kernel は JSON 形状の
  lifecycle 呼び出ししか見ません。
- selfhosted (`filesystem` / `local-docker` / `systemd-unit` / `minio` /
  `coredns-local`): `Deno.Command` / `fetch` / file IO を使う local adapter。

> Cloudflare Containers は **on-demand materialization** であり、always-on
> process host ではありません (Takosumi Core overview § Boundary を参照)。
> 長時間 process が必要な workload は `aws-fargate` / `k3s-deployment` /
> `cloud-run` / `docker-compose` / `systemd-unit` を選択してください。

## 関連ページ

- [Shape Catalog](./shape-catalog.md) — 各 Shape の spec / outputs / capabilities
- [Operator Bootstrap](./operator-bootstrap.md) — 18 provider を一括 wire する factory
- [Extending](./extending.md) — 新 provider の追加手順
- [Manifest](./manifest.md) — `resources[]` で provider を指定する書き方
