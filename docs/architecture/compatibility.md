# 互換性と制限

Takos manifest は provider-neutral。abstract type (sql, object-store, key-value,
etc.) で書く。実装は Cloudflare がリファレンス backend、他は互換 backend
として提供される。

backend は同一ではないため、「何を揃え、何を差分として扱うか」を明示する。

## 何を揃えるか

Takos が parity の対象にしているもの:

- tenant artifact と deploy/runtime contract
- manifest で宣言される `queue`, `analytics-engine`, `workflow`, `scheduled`
  trigger の contract
- app deployment の immutable snapshot
- routing target が保持する service identity / deployment identity
- deployment ごとの runtime config / bindings / env vars
- dispatch を経由して tenant runtime に到達する request contract
- publication index（control plane の責務であり backend に依存しない）

### workload translation

| manifest workload                                | Cloudflare                                                      | local / self-host                                                     | AWS / GCP / k8s                                                  |
| ------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `compute.<name>` (Worker = `build` あり)         | `workers-dispatch`                                              | `runtime-host` compatibility layer                                    | `runtime-host` compatibility layer                               |
| `compute.<name>` (Service = `image` あり)        | OCI deployment adapter                                          | local OCI deployment adapter                                          | provider-backed adapter (`ecs`, `cloud-run`, `k8s`)              |
| `compute.<name>.containers` (Attached Container) | OCI deployment adapter + worker-side attached container binding | local OCI deployment adapter + worker-side attached container binding | provider-backed adapter + worker-side attached container binding |

### container-image deploy の制約

- `workers-dispatch` と `runtime-host` は direct `container-image` deploy
  を受け付けない
- 同一 service で artifact kind の混在はできない（初回 deploy で確定）
- worker bindings は container runtime には注入されない
- `container-image` deploy では canary strategy は使えない
- online `takos deploy` で image-backed compute (Service / Attached Container)
  を反映するときは `image` field（digest pin 必須）が必要

Cloudflare backend 上でも、image-backed な compute (Service / Attached
Container) は現在の実装では OCI deployment adapter を通る。Cloudflare-native
spec を書けることと、 Cloudflare product surface に 1 対 1
で対応することは同義ではない。

### manifest-level feature support

| feature (`publish.kind` または compute trigger)        | manifest | bundle docs | runtime parity                                      |
| ------------------------------------------------------ | -------- | ----------- | --------------------------------------------------- |
| `queue`                                                | yes      | yes         | backend 依存                                        |
| `scheduled` (compute.triggers.schedules)               | yes      | yes         | backend 依存                                        |
| `workflow`                                             | yes      | yes         | binding 可。orchestration は backend 依存           |
| `analytics-engine`                                     | yes      | yes         | write path は compatible (contract のみ揃える)      |
| `vector-index`                                         | yes      | yes         | local / self-host では PostgreSQL + pgvector が必要 |
| `durable-object`                                       | yes      | yes         | local tenant runtime でも materialize               |

## Cloudflare

Cloudflare は主要 production backend。

- actual provider
- actual Workers backend
- actual deploy / rollback / routing backend
- worker workload は native
- image-backed workload は OCI deployment adapter 経由

## Local / Self-host

local / self-host は検証用 backend。

- Cloudflare account なしで control plane を起動できる
- tenant worker contract を local で materialize できる
- smoke / proxyless smoke で canonical path を検証できる
- image-backed workload は local OCI deployment adapter と
  `OCI_ORCHESTRATOR_URL` で materialize する

## AWS / GCP / k8s

provider-backed な互換 backend。

- public spec は Cloudflare-native のまま
- resource は provider-backed または Takos-managed runtime に解決される
- worker workload は runtime-host compatibility path を使う
- image-backed workload は `ecs` / `cloud-run` / `k8s` など provider-aware
  adapter に解決される

## 意図的に残している差分

### local control plane は Node-backed

local の control plane は Node-backed。control plane の起動性と local DX
を優先した設計。

### local tenant runtime は Workers-compatible adapter

local の tenant runtime は Workers-compatible だが、Cloudflare backend と
byte-for-byte 同一ではない。local は `worker-bundle` を local adapter 上で
materialize して実行する。

### non-AI features の parity

feature ごとに成熟度が異なる。

- `queue`: manifest / bundle docs 対応済み。delivery parity は backend 依存
- `scheduled`: manifest / bundle docs 対応済み。cron delivery は backend 依存
- `workflow`: manifest / bundle docs 対応済み。orchestration は backend 依存
- `analytics-engine`: write path は compatible (contract のみ揃える)。query
  semantics は揃え切っていない

`vector-index` は local で PostgreSQL + pgvector が利用可能であれば materialize
される（`POSTGRES_URL` + `PGVECTOR_ENABLED=true` が必要）。 `durable-object` は
local tenant runtime でも namespace binding として materialize する。

### infra host は URL forward を使う

local の URL forward は tenant worker の canonical path ではなく、主に infra
host 用。

- `runtime-host`
- `takos-egress`

`worker-bundle` の tenant service は local でも worker runtime で解決する。

## local でできないこと

- Cloudflare 固有の内部最適化や実装差の再現
- backend ごとの performance 特性の再現
- PostgreSQL + pgvector なしで `vector-index` binding を実行すること
- provider-native queue / scheduler / workflow semantics の完全再現
- production traffic 上での最終的な実証

local は production backend の代替ではなく、product contract
を大きく崩さずに検証するための backend。

## operator への意味

実運用での使い分け:

- local: 早い検証、smoke、proxyless 確認
- staging: actual provider 上での deploy / routing / rollback 検証
- production: 実 traffic と実 resource を扱う本番運用

local が green でも、provider 固有の最終確認は staging / production で行う。
