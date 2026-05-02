# Routes

`routes[]` は AppSpec の exposure ↔ listener / match / transport binding
declaration です。 各 route は component の `interface.*` 系 contract
instance を route descriptor が定義する入口に bind します
([Core § 10](/takos-paas/core/01-core-contract-v1.0#_10-interface-exposure-route-router-and-publication))。

normative な field 定義は
[マニフェストリファレンス § 3](/reference/manifest-spec#_3-routes)、
公開 route descriptor 一覧は
[Official Descriptor Set v1 § Minimum route descriptors](/takos-paas/descriptors/official-descriptor-set-v1#minimum-route-descriptors)
を参照。

## 基本

```yaml
routes:
  - id: ui
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config: { path: / }
```

`id` は manifest 内で一意。 publication output から
`from: { route: <id> }` で参照されます。

## 複数 route

```yaml
routes:
  - id: api
    expose: { component: api, contract: api }
    via: { ref: route.https@v1, config: { path: /api } }
  - id: mcp
    expose: { component: mcp, contract: mcp }
    via: { ref: route.https@v1, config: { path: /mcp } }
  - id: dispatch
    expose: { component: executor-host, contract: gateway }
    via: { ref: route.https@v1, config: { path: /dispatch } }
```

## Protocol 別

route descriptor を切り替えることで protocol を選びます。

```yaml
routes:
  - id: web
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: / } }
  - id: ssh
    expose: { component: shell, contract: ssh }
    via: { ref: route.tcp@v1, config: { port: 2222 } }
  - id: dns
    expose: { component: resolver, contract: dns }
    via: { ref: route.udp@v1, config: { port: 5353 } }
  - id: jobs
    expose: { component: worker, contract: jobs-handler }
    via:
      ref: route.queue@v1
      config:
        source: jobs-queue          # resources.<>.name を参照
        deadLetter: jobs-dlq
```

`route.queue@v1` の `source` / `deadLetter` は manifest の `resources.<>.name`
を参照します (env / binding 名ではない)。 producer 側 access は `bindings[]`
で別途 declaration します。

## Validation invariant

- `route.https@v1`: `path` は `/` で始まる必要がある; `methods` 省略時は全
  HTTP method; 同じ `path` で method が重なる route は invalid; 1 contract
  instance を複数 path に分ける route は invalid (1 つの route に method を
  列挙する); CLI と PaaS compiler は HTTP/HTTPS の `target + host + path +
  methods` 重複を検出する
- `route.tcp@v1` / `route.udp@v1`: `port` 必須
- `route.queue@v1` / `route.schedule@v1` / `route.event@v1`: `source` 必須
  (省略時は `route.id`)

route descriptor が定義する `exposureEligible` を満たす interface contract
instance のみ `expose` target になります。runtime / artifact contract は
expose target になりません。

## 子 component を外に出したい場合

子 component (旧 attached container) を外に公開する場合は **子 component
側に interface contract instance を持たせて route で expose** します。
親 component を経由させる必要はありません。

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config: { source: { ... } }
      api:
        ref: interface.http@v1
  worker:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config: { source: { ... }, port: 8080 }
      gateway:
        ref: interface.http@v1
    depends: [api]

routes:
  - id: api
    expose: { component: api, contract: api }
    via: { ref: route.https@v1, config: { path: /api } }
  - id: worker
    expose: { component: worker, contract: gateway }
    via: { ref: route.https@v1, config: { path: /worker } }
```

## 次のステップ

- [環境変数](/deploy/environment) --- env / binding の詳細
- [マニフェストリファレンス](/reference/manifest-spec) --- normative field 定義
