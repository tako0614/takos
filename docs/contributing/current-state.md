# Takos Product Current State

> このページでわかること: Takos product (`app/`, `git/`, `agent/`) の現在の実装状態のスナップショット。
> Takosumi platform (`../takosumi/`) や operator account plane (`../takosumi-cloud/`)
> の状態は対象外で、 各 product repo 側の docs を参照する。

このスナップショットは Takos product shell に含まれる 3 つの nested submodule
(`takos/app/`, `takos/git/`, `takos/agent/`) と shell-owned distribution
artifacts の状態を要約する。 前向きの計画は ecosystem root の
[`ROADMAP.md`](https://github.com/tako0614/takos-ecosystem/blob/master/ROADMAP.md)
を参照。

::: info Current audit boundary
Takos 1.x local / CI-equivalent exit criteria は完了扱い。 残る release-candidate
hygiene は ecosystem root `ROADMAP.md §7.2-7.4` (per-product progress view)
で追跡する。 public managed offering の launch readiness は `ROADMAP.md §3.5`
の live operator evidence / staged rehearsal が揃うまで別 gate。
:::

## Takos product の構成

Takos product は次の 3 nested submodule + shell-owned artifacts で構成される
(詳細は `takos/AGENTS.md`):

| Component | 役割 | Stack |
| --- | --- | --- |
| `app/` | user-facing app / public API gateway / OIDC consumer | Deno + Hono + Solid (frontend) |
| `git/` | Git hosting service (Smart HTTP / source resolution) | Deno + git CLI |
| `agent/` | agent execution service (agent loop / memory / skills) | Rust (uses `takos-agent-engine` library) |

Shell-owned (`takos/` 直下):

- `deploy/distributions/` — Takos distribution manifests (Cloudflare / AWS / GCP / K8s / self-hosted)
- `deploy/helm/`, `deploy/terraform/` — k8s / IaC artifact
- `docs/` — VitePress docs site (`docs.takos.jp`)
- `website/` — landing site (SolidStart, `takos.jp`)
- `scripts/` — product validator (release-gate / validate:helm / validate:distributions 等)

## takos-app の実装状態

- **public HTTP API** (`apps/api/`) — chat / agent / memory / space / tools の
  primitive を公開する canonical destination
- **OIDC consumer** — `/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout`
  で operator account plane (Takosumi Accounts) を issuer として消費する。
  自前 OAuth provider / `/oauth/*` route は廃止済 (Phase 1.4)
- **app-local profile / user settings** — Account / Space membership metadata
  と独立に local profile を持つ
- **typed client contracts** (`packages/api-contract/`) — DTO 公開
- **Solid frontend** (`apps/web/`) — browser UI
- **internal RPC verification** — `x-takos-internal-secret` + session / PAT
  を verify

## takos-git の実装状態

- **Git Smart HTTP hosting** — clone / push / fetch
- **repository metadata / refs / object storage**
- **source snapshot resolution** — Takosumi kernel への source provenance を
  immutable snapshot として提供
- **repository API contracts** — signed internal RPC のみ受け入れる
- **Takos Git authorization** — signed internal actor context を verify

ecosystem sibling の `takosumi/` (`.takosumi.yml` AppSpec installer implementation)
とは別物。 名前が紛らわしいが domain が異なる。

## takos-agent の実装状態

- **agent loop orchestration** — Rust 実装
- **memory substrate** + local memory tools
- **managed skill** 定義 / catalog 合成 / selection
- **prompt construction** — skill prompt / system prompt
- **model runner wiring**
- **Takosumi control plane RPC client** — agent-control RPC で接続
- **remote tool execution bridge**

実装は `takos-agent-engine` Rust library を service process 内で利用する形。
library 自体は別 repo (`../takos-agent-engine/`) で管理。

## 実装済みの本番相当機能

- **production safety**: in-memory や default ローカル配線での production boot
  を reject。 storage / provider / source / secret / operator-config / 認証
  選択を明示しなければ起動しない
- **signed internal RPC**: `x-takos-internal-secret` validation +
  `WorkerAuthzService` で service grant チェック + private-egress policy
- **deploy artifact**: `deploy/distributions/*.json` が Cloudflare / AWS / GCP /
  K8s / self-hosted profile を持ち、 distribution profile によって target を
  差し替えられる
- **Helm chart**: `deploy/helm/` が takos product の k8s deploy 用 chart 一式

## 検証済みテスト

`/home/tako/Desktop/takos/takos` から実行:

```sh
deno task check                # doctor + 各 nested submodule の check
deno task lint:agent-docs      # AGENTS.md ↔ 実装の整合
deno task lint:docs            # docs site build
deno task release-gate         # ecosystem release gate (Takos product 側)
deno lint
deno fmt --check
```

カバー範囲:

- **takos-app**: OIDC consumer flow / session 検証 / PAT verification /
  internal RPC 署名 / chat / agent / memory / space / tools API surface
- **takos-git**: Git Smart HTTP / source snapshot resolution / signed internal
  actor context verify
- **takos-agent**: agent loop / memory substrate / managed skill / tool bridge
  (Rust unit tests + integration tests against mock LLM)
- **shell validators**:
  - `validate:distributions` — distribution manifest 各 cloud profile の
    consistency
  - `validate:helm` — Helm chart 構造
  - `validate:agent-docs` — AGENTS.md の implementation 整合
  - `validate:current-docs` — current-state.md の forward statement 検出
  - `validate:retired-route-removal` — 廃止済 route が再導入されていない
    こと (e.g. takos-app の `/oauth/*`)
  - `validate:migration-safety` — DB migration の online-safety guard
  - `validate:terraform-secrets` — Terraform secret policy
  - `validate:legal-docs` — legal docs の consistency
  - `validate:observability-artifacts` — observability surface
  - `validate:patch-management` — patch management gate
  - `validate:architecture` — architecture alignment

最新の local evidence は `cd takos && deno task release-gate` を正本コマンド
とする。 固定の test 件数はこの current-state page では pin しない (release-gate
が numerical assertion の正本)。

## Smoke 状況

Takos product 側の smoke スクリプト (`scripts/`):

| Boundary | Default | Real / opt-in | 備考 |
| --- | --- | --- | --- |
| Docker Compose ローカル | Safe dry-run | `TAKOS_RUN_REAL_COMPOSE_SMOKE=1` + Docker Compose + `.env.local` + 空きポート + ローカルイメージビルド | real 実行で Postgres / Redis / MinIO / `takos-app` / `takos-git` / `takos-agent` を起動し、 health endpoint 確認 + cleanup |
| Helm 検証 | Pass | — | `deno task validate:helm` で chart 構造 dry-run |
| Distribution profile | Pass | live cloud evidence は `ROADMAP.md H-19` (operator-owned) | `deno task validate:distributions` で manifest consistency |

Takosumi platform 側の smoke (kernel storage / migration / queue / object-storage
等) は sibling `../takosumi/` repo + `../takosumi/deploy/local-substrate/`
test bed の責務であり、 ここでは扱わない。

## 実行可能コマンド

ルート `deno.json` のローカル検証コマンド:

```sh
deno task check                # doctor + nested check
deno task lint:agent-docs      # AGENTS.md ↔ impl alignment
deno task lint:docs            # VitePress build
deno task release-gate         # product 側 release-gate
deno task docs:build           # docs site build
deno task docs:deploy          # Cloudflare Pages `takos-docs` → docs.takos.jp
deno fmt --check
```

各 nested submodule:

```sh
cd app && deno task check && deno task test
cd git && deno task check && deno task test
cd agent && cargo check && cargo test
```

local Compose (Takos product full stack):

```sh
deno task local:up             # compose.local.yml 起動 (postgres + redis + takos-app + takos-git + takos-agent)
deno task local:logs
deno task local:down
```

## Takos が依存する Takosumi platform

Takos product は **Takosumi PaaS** の上で動く consumer。 platform 側 lifecycle
は Takos の責務ではなく、 各 platform repo の test に委ねる:

- **Takosumi kernel + installer** (`../takosumi/`) — `.takosumi.yml` AppSpec
  を読み、5 endpoint installer API で Installation / Deployment を記録する
  platform substrate。
  kernel の internal domains (`packages/kernel/src/domains/` 配下: deploy /
  runtime / resources / routing / network / registry / audit / events /
  app-output / supply-chain) は kernel package が所有し、 Takos product
  からは public HTTP contract 経由でのみ触る
- **Takosumi Accounts** (`../takosumi-cloud/packages/accounts-service/`) —
  operator account plane。 OIDC issuer / billing / Installation ledger
- **`takosumi`** (`../takosumi/`) — `.takosumi.yml` AppSpec と installer
  pipeline の canonical implementation
- **integration test bed** (`../takosumi/deploy/local-substrate/`) — Takosumi
  platform の full integration を public network 依存ゼロで踏む

Takos product は上記のいずれも内製しない。 OIDC issuer / billing / Installation
ownership / `.takosumi.yml` AppSpec parsing は operator account plane および
`takosumi` 側の責務。

### kernel / plugin boundary

Takosumi kernel の domain modules (kernel が所有する core logic) と plugin
(operator が差し替える provider / source / secret / queue / object-storage
backend 等) の境界は **`../takosumi/`** 側 docs の正本である
[kernel architecture page](https://github.com/tako0614/takosumi/blob/main/docs/reference/architecture/kernel.md)
を参照。 Takos product は Takosumi installer API / account-plane contract
経由でのみ platform に接続し、 plugin / internal domain には直接依存しない。
Takos product が kernel plugin 経由で持つ依存 (Postgres storage / Redis queue
/ S3-compatible object-storage / Docker compose runner 等) は distribution
profile 経由で operator が選択する。

## Live / provider hardening backlog

以下は Takos product 1.x local exit の未完条件ではなく、 release-candidate
hygiene / live operator evidence 側で扱う backlog:

- **release-candidate hygiene**: per-product semver の Takos 0.x → 1.0 切り
  出し。 release-gate を numerical assertion で fix し、 distribution manifest
  の cross-cloud parity を verified にする
- **live distribution proof**: Cloudflare / AWS / GCP / K8s 各 distribution
  profile の live deploy evidence (`ROADMAP.md H-19`、 operator-owned)
- **managed offering evidence**: `takosumi-cloud` 側 operator が live operator
  evidence / staged rehearsal を揃える (`ROADMAP.md §3.5`)。 Takos product
  自体は managed-offering-aware だが、 evidence は operator が出す
- **chain of custody**: deploy intent log で agent が deploy intent を Git
  commit として表現する経路 (Phase 1.7 GitOps deploy binding) は local exit
  済、 production rotation evidence は operator-owned
- **acceptance test coverage**:
  [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md)
  の route / worker レベル regression test を Takos product 側 surface でも
  維持
