# 互換性と制限

Takos manifest の deploy / runtime surface は backend-neutral な Takos deploy
manifest (`.takos/app.yml`) を基準にし、resource layer も backend-neutral な
abstract type (sql, object-store, key-value, etc.) で書く。Cloudflare / AWS /
GCP / k8s / local は同じ public contract を共有し、差分は operator 内部の
adapter に閉じる。

backend は同一ではないため、「何を揃え、何を差分として扱うか」を明示する。

## 何を揃えるか

Takos が parity の対象にしているもの:

- tenant artifact と deploy/runtime contract
- manifest で宣言される workload / route / route publication / Takos capability
  grant / consume edge と compute trigger (`scheduled`) の contract
- resource API / runtime binding で扱う abstract resource type
- group snapshot
- routing target が保持する service identity / deployment identity
- deployment ごとの runtime config / bindings / env vars
- dispatch を経由して tenant runtime に到達する request contract
- publication index（control plane の責務であり backend に依存しない）

### workload translation

runtime translation report は compiled desired declaration の workload / route
translation と backend requirement を `compatible` / `unsupported`
で表現する。resource existence や full runtime compatibility を判定する report
ではない。以下の backend 固有名は出さず、実際の materialization は operator
adapter が選ぶ。backend / adapter 名は operator-only configuration であり、
public deploy manifest の field ではない。

| manifest workload                                | Public surface | Internal materialization                                 |
| ------------------------------------------------ | -------------- | -------------------------------------------------------- |
| `compute.<name>` (Worker = `build` あり)         | compatible     | selected worker runtime adapter                          |
| `compute.<name>` (Service = `image` あり)        | compatible     | selected container runtime adapter / OCI orchestrator    |
| `compute.<name>.containers` (Attached Container) | compatible     | selected container runtime adapter + worker-side binding |

### container-image deploy の制約

- `workers-dispatch` と `runtime-host` は direct `container-image` deploy
  を受け付けない
- 同一 service で artifact kind の混在はできない（初回 deploy で確定）
- worker bindings は container runtime には注入されない
- `container-image` deploy では canary strategy は使えない
- online `takos deploy` で image-backed compute (Service / Attached Container)
  を反映するときは `image` field（digest pin 必須）が必要

image-backed な compute (Service / Attached Container) は backend に関係なく
Takos の public contract では同じ扱いで、内部では選択された container adapter /
orchestrator を通る。

### manifest-level feature support

| feature                                                  | manifest | bundle docs | runtime parity                                           |
| -------------------------------------------------------- | -------- | ----------- | -------------------------------------------------------- |
| worker / service compute                                 | yes      | yes         | selected worker / container runtime adapter              |
| attached container                                       | yes      | yes         | selected container runtime adapter + worker-side binding |
| route                                                    | yes      | yes         | selected routing runtime                                 |
| route publication (`publish[].publisher/type/path`)      | yes      | yes         | publication catalog + route URL output                   |
| Takos capability grant (`publish[].publisher/type/spec`) | yes      | yes         | publication catalog + grant output                       |
| explicit consume edge (`compute.*.consume`)              | yes      | yes         | env injection only for declared consumer                 |
| `scheduled` (`compute.triggers.schedules`)               | yes      | yes         | backend 依存                                             |
| `queue trigger` (`compute.triggers.queues`)              | no       | no          | 現行 manifest contract では未サポート（schedules-only）  |

SQL / object-store / queue / analytics-engine / workflow / vector-index /
durable-object などの resource access は manifest の `publish` / `consume`
surface ではなく、resource API / runtime binding 側で扱う。`publish` は route
publication と Takos capability grant の catalog であり、resource creation や
resource binding の入口ではない。

### resource runtime binding support

| resource type      | public surface                 | runtime parity                                      |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| `queue`            | resource API / runtime binding | delivery semantics は backend 依存                  |
| `workflow`         | resource API / runtime binding | orchestration semantics は backend 依存             |
| `analytics-engine` | resource API / runtime binding | write path は contract を揃える                     |
| `vector-index`     | resource API / runtime binding | local / self-host では PostgreSQL + pgvector が必要 |
| `durable-object`   | resource API / runtime binding | local tenant runtime でも namespace を materialize  |

## Cloudflare

Cloudflare は主要 production backend。

- actual Cloudflare backend
- actual Workers backend
- actual deploy / rollback / routing backend
- worker workload は Cloudflare adapter で materialize される
- image-backed workload は selected container adapter / orchestrator 経由

## Local / Self-host

local / self-host は検証用 backend。

- Cloudflare account なしで control plane を起動できる
- tenant worker contract を local で materialize できる
- smoke / proxyless smoke で canonical path を検証できる
- image-backed workload は local OCI deployment adapter と
  `OCI_ORCHESTRATOR_URL` で materialize する

## AWS / GCP / k8s

backend-specific runtime。

- public spec は backend-neutral な Takos deploy manifest のまま
- resource は backend-specific または Takos-managed runtime に解決される
- worker workload は operator-selected worker runtime path を使う
- image-backed workload は `ecs` / `cloud-run` / `k8s` など backend-specific
  adapter に解決される

## 意図的に残している差分

### local control plane は Node-backed

local の control plane は Node-backed。control plane の起動性と local DX
を優先した設計。

### local tenant runtime は worker runtime path

local の tenant runtime は runtime-host worker runtime path で、内部では
Workers-compatible local adapter を使う。Cloudflare backend と byte-for-byte
同一ではない。local は `worker-bundle` を local adapter 上で materialize
して実行する。

### non-AI features の parity

feature ごとに成熟度が異なる。

- `queue`: resource API / runtime binding 対応。delivery parity は backend 依存
- `queue trigger`: 現行 manifest contract では未対応（worker trigger は
  `schedules` のみ）
- `scheduled`: manifest / bundle docs 対応済み。cron delivery は backend 依存
- `workflow`: resource API / runtime binding 対応。orchestration は backend 依存
- `analytics-engine`: resource API / runtime binding 対応。write path は
  contract を揃える。query semantics は揃え切っていない

`vector-index` は local で PostgreSQL + pgvector が利用可能であれば materialize
される（`POSTGRES_URL` + `PGVECTOR_ENABLED=true` が必要）。`durable-object` は
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
- backend-specific queue / scheduler / workflow semantics の完全再現
- production traffic 上での最終的な実証

local は production backend の代替ではなく、product contract
を大きく崩さずに検証するための backend。

## operator への意味

実運用での使い分け:

- local: 早い検証、smoke、proxyless 確認
- staging: actual runtime/backend 上での deploy / routing / execution context
  rollback 検証
- production: 実 traffic と実 resource を扱う本番運用

local が green でも、backend 固有の最終確認は staging / production で行う。
