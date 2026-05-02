# Operator Bootstrap

operator が **18 個の bundled provider plugin** を一括で wire するための
factory `createTakosumiProductionProviders(opts)` の使い方をまとめます。

source: [`src/shape-providers/factories.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/factories.ts)

> 重要: factory 経由で wire された provider は **operator gateway** または
> local Deno API adapter を通って upstream cloud API を呼びます。kernel
> 側に credential が直接届くことはありません ([Provider Plugins § Real client](./provider-plugins.md#real-client--lifecycle-adapter))。

## API シグネチャ

```ts
import { createTakosumiProductionProviders } from "@takosumi/plugins/shape-providers";

const providers = createTakosumiProductionProviders({
  aws:        { region: "ap-northeast-1", gatewayUrl: "https://gateway.takos.example/aws", bearerToken: "..." },
  gcp:        { project: "my-project", region: "asia-northeast1", gatewayUrl: "https://gateway.takos.example/gcp" },
  cloudflare: { accountId: "abcd...", zoneId: "TAKOS_ZONE", gatewayUrl: "https://gateway.takos.example/cloudflare" },
  kubernetes: { namespace: "takos-prod", gatewayUrl: "https://gateway.takos.example/kubernetes" },
  selfhosted: { rootDir: "/var/lib/takos/object-store", systemdUnitDir: "/etc/systemd/system" },
});
```

`opts` の各 cloud 設定は **任意** で、指定された cloud の provider のみが
wire されます。空の `opts: {}` を渡すと 0 個の provider が返ります。

## `TakosumiProductionProviderOptions`

```ts
interface TakosumiProductionProviderOptions {
  readonly aws?:        TakosumiAwsCredentials;
  readonly gcp?:        TakosumiGcpCredentials;
  readonly cloudflare?: TakosumiCloudflareCredentials;
  readonly kubernetes?: TakosumiKubernetesCredentials;
  readonly selfhosted?: TakosumiSelfhostedCredentials;
}
```

各 cloud の field 構造:

### AWS (`TakosumiAwsCredentials`)

```ts
interface TakosumiAwsCredentials {
  readonly region: string;                // e.g. "ap-northeast-1"
  readonly accessKeyId?: string;          // 直接 AWS API を叩く構成のみ使う
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly gatewayUrl?: string | URL;     // 推奨: operator gateway URL
  readonly bearerToken?: string;          // gateway 認証
  readonly fetch?: typeof fetch;
}
```

wire される provider: `aws-s3` / `aws-fargate` / `aws-rds` / `route53`。

### GCP (`TakosumiGcpCredentials`)

```ts
interface TakosumiGcpCredentials {
  readonly project: string;
  readonly region: string;
  readonly credentialsJson?: string;
  readonly gatewayUrl?: string | URL;
  readonly bearerToken?: string;
  readonly fetch?: typeof fetch;
}
```

wire される provider: `gcp-gcs` / `cloud-run` / `cloud-sql` / `cloud-dns`。

### Cloudflare (`TakosumiCloudflareCredentials`)

```ts
interface TakosumiCloudflareCredentials {
  readonly accountId: string;
  readonly apiToken?: string;
  readonly zoneId?: string;        // 既定 "TAKOS_ZONE"
  readonly gatewayUrl?: string | URL;
  readonly fetch?: typeof fetch;
}
```

wire される provider: `cloudflare-r2` / `cloudflare-container` / `cloudflare-dns`。

### Kubernetes (`TakosumiKubernetesCredentials`)

```ts
interface TakosumiKubernetesCredentials {
  readonly namespace: string;
  readonly kubeconfigPath?: string;
  readonly gatewayUrl?: string | URL;
  readonly bearerToken?: string;
  readonly fetch?: typeof fetch;
}
```

wire される provider: `k3s-deployment`。

### Selfhosted (`TakosumiSelfhostedCredentials`)

```ts
interface TakosumiSelfhostedCredentials {
  readonly rootDir?: string;                // 既定 "/var/lib/takos/object-store"
  readonly postgresHostBinding?: string;    // 既定 "localhost"
  readonly objectStoreEndpoint?: string;    // 既定 "http://minio.local:9000"
  readonly systemdUnitDir?: string;         // 既定 "/etc/systemd/system"
  readonly coreDnsZoneFile?: string;        // 既定 "/etc/coredns/Corefile"
  readonly fetch?: typeof fetch;
}
```

wire される provider: `filesystem` / `docker-compose` / `systemd-unit` /
`local-docker` / `minio` / `coredns-local`。

## Gateway URL pattern

operator gateway は `JsonGateway` の base URL を root として、各 cloud で
固定の path 体系を持ちます (cf. `factories.ts` の Gateway*Lifecycle 群):

| cloud      | path 例                                                     |
| ---------- | ----------------------------------------------------------- |
| AWS        | `aws/s3/create-bucket`, `aws/fargate/create-service`, ...    |
| GCP        | `gcp/gcs/create-bucket`, `gcp/cloud-run/create-service`, ... |
| Cloudflare | `cloudflare/r2/create-bucket`, `cloudflare/containers/...`   |
| Kubernetes | `kubernetes/k3s/create-deployment`, ...                     |

`gatewayUrl` は **末尾に `/` を付けても付けなくても** どちらでも OK
(`JsonGateway` 側で正規化されます)。`bearerToken` を付けると
`Authorization: Bearer <token>` ヘッダで gateway 認証されます。

## kernel apply pipeline への wire

operator は kernel 起動時に provider registry へ inject します:

```ts
import { registerProvider } from "takosumi-contract";
import { createTakosumiProductionProviders } from "@takosumi/plugins/shape-providers";

const providers = createTakosumiProductionProviders({ aws, cloudflare });
for (const plugin of providers) {
  registerProvider(plugin);
}
```

manifest の `resources[].provider` field は registry から `getProvider(id)`
で lookup され、`.implements` が `resources[].shape` と一致し、`requires`
の subset に `capabilities` を持つ場合に selection されます (cf.
[Manifest § Capability requires](./manifest.md#capability-requires))。

## Selfhosted-only な最小構成

開発機 1 台で全部 selfhosted で動かす最小例:

```ts
const providers = createTakosumiProductionProviders({
  selfhosted: {
    rootDir: "/tmp/takos-objects",
    systemdUnitDir: "/etc/systemd/system",
    coreDnsZoneFile: "/etc/coredns/Corefile",
  },
});
// providers = filesystem / docker-compose / systemd-unit / local-docker / minio / coredns-local
```

この構成と相性が良い template が
[`selfhosted-single-vm@v1`](./templates.md#selfhosted-single-vm-v1) です。

## テスト時の差し替え

production wire を bypass し、`InMemory<Provider>Lifecycle` を直接渡したい
場合は factory を使わず、各 `create<Provider>(...)` を個別に呼んで
`registerProvider` してください (cf.
[`object-store/aws-s3.ts`](https://github.com/takos-jp/takosumi/blob/main/src/shape-providers/object-store/aws-s3.ts)
の `InMemoryAwsS3Lifecycle`)。

## 関連ページ

- [Provider Plugins](./provider-plugins.md) — 18 provider の実装と capabilities
- [Shape Catalog](./shape-catalog.md) — Shape ごとの outputs と capabilities
- [Manifest](./manifest.md) — operator が apply する manifest の syntax
- [Extending](./extending.md) — 新 provider 追加時の factory 配線
