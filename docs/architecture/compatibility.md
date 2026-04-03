# 互換性と制限

Takos の public spec は Cloudflare-native で、Takos runtime がその spec を複数
backend 上で実現します。Cloudflare backend は基準 backend、local / self-host /
AWS / GCP / k8s は互換 backend です。\
ただし backend
は同一ではないため、完全一致ではなく「何を揃え、何を差分として扱うか」を明示しておく必要があります。

このページでは互換 backend の代表例として local を多めに扱います。local
の説明はそのまま「Cloudflare backend 以外で spec
をどう実現するか」の例として読めます。

## 何を揃えるか

Takos が parity の対象にしているのは次です。

- tenant artifact は `worker-bundle`
- tenant routing target は `service-ref` と `http-url`
- manifest で宣言される `queue`, `analyticsEngine`, `workflow`, `scheduled`
  trigger の contract
- app deployment は immutable snapshot を持つ
- group は current source projection と desired state を持つ
- routing target は `routeRef` だけでなく current deployment identity
  も保持できる
- deployment ごとの snapshot
  - runtime config
  - bindings
  - env vars
- dispatch を経由して tenant runtime に到達する request contract

つまり、Takos は local でも Cloudflare でも「同じ worker-bundle contract
を実行する」ことを目指します。

### container-image deploy の制約

deploy API では `container-image` artifact kind
を受け付けますが、次の制約があります。

- `cloudflare` provider は container-image deploy を拒否します
- current public surface は phase-based deploy strategy を公開しません
- 同一 service で artifact kind の混在はできません (初回 deploy で確定)
- worker bindings は container runtime には注入されません
- `.takos/app.yml` は現時点では worker-bundle のみを扱います
- service bindings / resource mounts / MCP / file handlers は container-image
  では利用できません (v1 制約)

### manifest-level feature support

Takos の manifest contract は次の非 AI tenant features を受け付けます。

| feature           | manifest | bundle docs | runtime parity                                                |
| ----------------- | -------- | ----------- | ------------------------------------------------------------- |
| `queue`           | yes      | yes         | backend 依存                                                  |
| `scheduled`       | yes      | yes         | backend 依存                                                  |
| `workflow`        | yes      | yes         | binding は可。invocation/orchestration parity は backend 依存 |
| `analyticsEngine` | yes      | yes         | write path は contract-first                                  |
| `vectorize`       | yes      | yes         | local では PostgreSQL + pgvector が必要                       |
| `durableObject`   | yes      | yes         | local tenant runtime でも materialize                         |

ここでの `runtime parity` は「Cloudflare backend と互換 backend
の両方で同じように使えるか」を意味します。\
manifest で受け付けることと、provider-native 実装まで完全に揃うことは別です。

## local と Cloudflare の役割

### Cloudflare

Cloudflare は主要な production backend です。

- actual provider
- actual Workers backend
- actual deploy / rollback / routing backend

### local

local は検証用 backend です。

- Cloudflare account なしで control plane を起動できる
- tenant worker contract を local で materialize できる
- smoke / proxyless smoke で canonical path を検証できる

## 意図的に残している差分

### local control plane は Node-backed

local の control plane は Node-backed です。\
これは control plane の起動性と local DX を優先した設計です。

### local tenant runtime は Workers-compatible adapter

local の tenant runtime は Workers-compatible ですが、Cloudflare backend と
byte-for-byte 同一ではありません。\
local は `worker-bundle` を local adapter 上で materialize して実行します。

### non-AI features の扱い

Takos は `queue`, `scheduled`, `workflow`, `analyticsEngine` を manifest
contract として公開します。\
ただし現時点では feature ごとに成熟度が違います。

- `queue`
  - manifest と bundle docs は対応済み
  - delivery/orchestration の provider parity は backend 依存
- `scheduled`
  - manifest と bundle docs は対応済み
  - cron delivery の provider parity は backend 依存
- `workflow`
  - manifest と bundle docs は対応済み
  - binding metadata は current surface で扱える
  - invocation/orchestration parity は backend 依存
- `analyticsEngine`
  - manifest と bundle docs は対応済み
  - write path は contract-first で、backend query semantics は揃え切っていない

`vectorize` は manifest で受け付けます。local tenant runtime では PostgreSQL +
pgvector が利用可能であれば materialize されます（`POSTGRES_URL` +
`PGVECTOR_ENABLED=true` が必要）。`durableObject` は local tenant runtime でも
namespace binding として materialize します。

### infra host は URL forward を使う

local の URL forward は tenant worker の canonical path ではなく、主に infra
host 用です。

- `runtime-host`
- `executor-host`
- `browser-host`
- `takos-egress`

`worker-bundle` の tenant service は local でも worker runtime で解決します。

同じ `service-ref` に対して deployment history や snapshot が複数あっても、local
は group の current projection と routing target に含まれる deployment identity
を使って worker runtime を選びます。

### local tenant runtime の Vectorize 対応

tenant worker の public binding contract では `vectorize` と `durableObject`
を扱えます。local tenant runtime では `vectorize` binding を PostgreSQL +
pgvector 経由で materialize します。

現在の挙動は次です。

- Cloudflare tenant worker: `vectorize` / `durableObject` binding を利用できる
- local tenant worker: `durableObject` binding は利用できる
- local tenant worker: `vectorize` binding は `POSTGRES_URL` +
  `PGVECTOR_ENABLED=true` を設定すれば利用できる。未設定の場合は worker
  起動時にエラーになる

### queue / scheduled / workflow / analytics の current parity

Takos は tenant contract として次を公開します。

- `queue` resource と queue binding
- `analyticsEngine` resource と analytics binding
- `workflow` resource
- `scheduled` trigger
- `queue consumer` trigger

ただし current parity は feature ごとに違います。

- `queue binding`: local tenant runtime でも materialize
  するが、delivery/orchestration parity は backend 依存
- `analytics binding`: contract と provider/binding path を優先して整備する
- `scheduled trigger`: manifest contract は公開するが、delivery/orchestration
  の差分は backend に依存する
- `workflow resource`: manifest contract と resource provisioning
  は公開し、binding metadata も current surface で扱う。durable orchestration
  parity は backend に依存する

つまり v1 では「manifest/binding contract」と「runtime orchestration
parity」の完成度は同じではありません。

## local でできないこと、差分が出うること

- Cloudflare platform 固有の内部最適化や実装差
- backend ごとの performance 特性
- Cloudflare 上の実 resource behavior を完全に再現すること
- PostgreSQL + pgvector なしで local tenant worker の `vectorize` binding
  を実行すること
- provider-native queue consumer / scheduler / workflow semantics を
  byte-for-byte 再現すること
- production traffic 上での最終的な実証

local は production backend の代替ではなく、product contract
を大きく崩さずに検証するための backend です。

## operator への意味

実運用では次の使い分けになります。

- local: 早い検証、smoke、proxyless 確認
- staging: actual provider 上での deploy / routing / rollback 検証
- production: 実 traffic と実 resource を扱う本番運用

local が green でも、provider 固有の最終確認は staging / production backend
で行う必要があります。

## 設計上の決定

Takos は次を正本方針にしています。

- public surface は `/workers`
- internal model は `service / route / deployment`
- local control plane は Node-backed
- tenant runtime は Workers-compatible
- Cloudflare-specific behavior は provider / adapter に閉じ込める

この方針により、「Cloudflare でしか動かない構造」は避けつつ、「tenant は Workers
技術を使う」という軸は維持します。
