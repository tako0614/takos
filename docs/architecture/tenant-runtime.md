# Tenant Runtime

Tenant runtime は takosumi kernel が apply した `resources[]` を実行環境へ
materialize する execution plane です。Takosumi Account / AppInstallation ledger
は account plane にあり、tenant runtime は所有権や billing を直接扱いません。

AppInstallation lifecycle (installing → ready 等) は takosumi-git / Takosumi
Accounts の installer pipeline が管理します。tenant runtime 側には、compile 済み
manifest を kernel が apply した結果として workload / route / resource
projection が現れます。

## Runtime Inputs

tenant runtime が受け取る入力は Deployment に固定された Shape resource snapshot
です。

- `worker@v1`: JS bundle artifact (`spec.artifact.kind: js-bundle`)、
  `compatibilityDate`、optional `routes`
- `web-service@v1`: container image or artifact、listen `port`、`scale`、
  optional `env` / `domains`
- `database-postgres@v1`: provider が materialize する stateful resource
- `custom-domain@v1`: route / endpoint output への domain projection

resource 間の値渡しは `${ref:...}` / `${secret-ref:...}`、cross-instance service
dependency は `imports[]` / `serviceResolvers[]` の resolved output で表現しま
す。top-level `components` / `bindings[]` は current kernel-bound manifest
surface ではありません。

## Worker Runtime

`worker@v1` は request-driven JS workload です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: edge-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - web.example.com/*
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: build-web
      artifact: web
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の authoring extension で、kernel に届く前に
`spec.artifact.hash` へ concrete digest を書き込み、strip されます。

## Container / Web Service Runtime

`web-service@v1` は long-running HTTP process を表す resource です。provider は
Fargate / Cloud Run / Kubernetes / local Docker など任意ですが、manifest は同じ
Shape contract を使います。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      domains:
        - api.example.com
```

旧 attached container pattern は current manifest では別 resource として並べま
す。Worker から container に渡す internal endpoint は provider output を
`${ref:...}` で受け取ります。

```yaml
resources:
  - shape: web-service@v1
    name: processor
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/processor@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: worker@v1
    name: edge
    provider: "@takos/cloudflare-workers"
    spec:
      artifact: { kind: js-bundle, hash: PLACEHOLDER }
      compatibilityDate: "2026-05-09"
      env:
        PROCESSOR_INTERNAL_HOST: ${ref:processor.internalHost}
        PROCESSOR_INTERNAL_PORT: ${ref:processor.internalPort}
```

## Dispatch

tenant request は直接 workload に届かず、dispatch / routing layer を経由しま
す。routing layer は GroupHead が指す current Deployment の route projection を
読み、hostname / path から target resource へ振り分けます。

- `{KERNEL_DOMAIN}` → kernel API / settings
- auto hostname / custom slug / custom domain → tenant runtime target
- OIDC issuer route (`/oauth/*`) は kernel / tenant runtime の対象外で、
  Takosumi Accounts が提供する

dispatch は provider-specific route cache を持ってよいが、canonical source は
Deployment と GroupHead です。

## Runtime Snapshot

runtime deployment は次の snapshot を持ちます。

- selected provider target
- artifact digest / image digest
- materialized env / secret refs
- resource output refs
- route projection
- runtime network policy

rollback は retained Deployment snapshot と resource metadata を再利用する
pointer move です。durable resource contents の巻き戻しは rollback ではなく、
新しい Deployment / resource operation として扱います。

## Local Backend

local backend は provider account なしで Shape resource contract を検証するため
の backend です。

- `worker@v1`: Workers-compatible local adapter
- `web-service@v1`: local Docker / process adapter
- stateful resource: local Postgres / object store emulator または external
  provider
- routing: local dispatch / reverse proxy

## Compatibility

Takos は backend-neutral tenant contract を共有しますが、compatible は schema /
translation parity を指し、runtime behavior や provider capability が完全一致
することを意味しません。詳細は [互換性と制限](./compatibility.md) と
[環境ごとの差異](/hosting/differences) を参照。

## Workers Backend Reference Materialization

::: details tracked reference Workers backend の実装詳細

このセクションは Cloudflare Workers backend に固有の materialization detail
です。Core 用語との対応は
[Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
を参照。

- `worker@v1` は Cloudflare Workers runtime で materialize される
- `web-service@v1` は provider plugin が Containers / external container runtime
  へ変換できる
- tenant routing は dispatch worker と route projection cache に従う
- provider operation の進捗は `Deployment.conditions[]` と ProviderObservation
  stream に記録される

:::
