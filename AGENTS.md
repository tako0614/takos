# AGENTS.md — takos (Takos product shell)

`takos` は **Takos distribution shell** で、単一の Takos distribution Worker (`src/worker`)、UI (`web`)、Cloudflare Container 実装
(`containers/git` / `containers/agent`) と shell-owned Cloudflare deploy artifacts (`deploy/cloudflare` /
`deploy/opentofu/modules/cloudflare` / `deploy/distributions/cloudflare.json` / validator) を集約する。Takos は
**OpenTofu-native, Takosumi-managed な first-party AI workspace distribution** で、app / deploy topology は Git-hosted
OpenTofu Capsule として扱い、Takosumi 専用 manifest や DSL を要求しない。product-grade lifecycle は embedded Takosumi
services (Accounts plane / deploy-control / dashboard / OpenTofu runner / Run ledger / policy / audit) が管理し、Takos
product surface (chat / agent / memory / Workspace / app launcher / Takos Service Graph profile) と同一 origin / 同一 Worker に
compose される。deploy の正本は
[`deploy/opentofu`](deploy/opentofu) module (`var.target = cloudflare`): `tofu apply` が Takos distribution worker の
durable backing infra を provision し、worker artifact (`deploy/cloudflare` の wrangler step) はその module output を読む。
self-host された worker は **自分の origin** で動き、embedded Takosumi Accounts plane により自分が OIDC issuer になる
(`app.takosumi.com` は operator の hosted Takosumi platform worker の origin であって self-host Takos distribution worker の origin
ではない)。統合 Takos worker は Takos product に加えて Takosumi Accounts plane と Takosumi deploy-control plane を
**in-process** で同居させる (詳細は後述 [`§ 単一 Worker のトポロジ`](#単一-worker-のトポロジ))。Takosumi / Takos の
identity と vocabulary は root docs [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) と
[`../docs/reference/glossary.md`](../docs/reference/glossary.md) を正本にする。

> **Takos is the OpenTofu-native AI workspace distribution managed by embedded Takosumi services.** It uses plain
> Git-hosted OpenTofu Capsules as the app / deploy input and adds the Takos product experience: AI agents, chat,
> Workspaces, memory, app launcher, Takos-facing service surfaces for Git / storage / agent runtime /
> MCP, and first-party Capsule apps (`takos-office` / `takos-computer` / `yurucommu`) seeded on new Workspace creation.
> A self-host Takos deployment is a
> same-origin distribution worker: Takos product routes, Takosumi Accounts, Takosumi deploy-control, the dashboard, and
> the OpenTofu runner are composed in-process. External hosted Takosumi is not required for self-hosting; embedded
> Takosumi services are still the product-grade deploy authority.

Takos の constituent (AI agents / Git / memory / Workspaces / tools) と「ソフトウェアの民主化」 core concept の formal
definition は [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) §0 を参照。

曖昧 / 旧 wording (「Takos は通常の App ではない」 だけの表現等) を増やさず、 root docs の vocabulary に統一する。
Takosumi の public model は `Workspace` / `Project` / `Capsule` / `Source` / `ProviderConnection` /
`CredentialRecipe` / `ProviderBinding` / `Secret` / `Run` / `Plan` / `Apply` / `Destroy` / `StateVersion` /
`Output` / `Runner` / `AuditEvent` / `Operator`。旧 `Space` / `Installation` / `Deployment` / `OutputSnapshot` /
Provider Catalog / Service Graph 語彙は migration debt として扱い、新規の正本 public vocabulary として増やさない。

## 責務

### 持つ

- Takos distribution Worker の source owner (`src/worker` / `src/routes` / `src/contracts`)
- UI source owner (`web`)
- Git / agent container implementation owner (`containers/git`、 `containers/agent`)
- in-process Takosumi Accounts plane / deploy-control mount glue (`src/worker/server/routes/accounts/mount.ts` /
  `src/worker/server/routes/deploy/mount.ts`) と folded Takosumi dashboard UI (`@takosumi/dashboard` を `web` build に
  alias して `/account` / `/new` / `/installations` / `/runs` / `/graph` / `/activity` に登録する)
- shell-owned Cloudflare deploy artifacts (`deploy/cloudflare`、 `deploy/opentofu` (cloudflare module)、
  `deploy/distributions/cloudflare.json`)
- shell-owned planning docs (`docs/contributing/`、 旧 `plan/`)
- product validator scripts (release-gate / validate:opentofu-secrets / validate:patch-management 等)

### 持たない

- Takosumi service / Accounts plane / deploy-control の **実装 source** (`../takosumi/` が source owner)。`takos` は
  tsconfig alias 経由でその handler を in-process import するだけで、実装を fork しない
- standalone runtime service split repositories for Takos app / Git / agent (single worker に統合済み)
- operator config / secrets の保管 (repo の外、例: `~/.takos-secrets/<env>/` に置く)。production / staging deploy は
  self-hoster / operator が自分の infra に対して wrangler + tofu で実行する
- generic `common` package (service-local helper のみ許可)

## 単一 Worker のトポロジ

current reality は **Takos は OpenTofu-native, Takosumi-managed な same-origin distribution** です。`tofu apply` + wrangler step
は Takos distribution worker の durable backing infra と worker artifact を materialize する reference deployment path であり、
embedded Takosumi services を含む単一 distribution を deploy します。multi-operator / multi-cloud / 分離 sub-service の機構は retired (下記
[`§ Naming history`](#naming-history))。以下は self-host された Takos distribution worker の in-process トポロジ (operator の
platform worker も同じ accounts plane / deploy-control source を別 build target で compose する)。

- **Takos product + Takosumi Accounts plane + Takosumi deploy-control が 1 worker に in-process 同居**する。self-host された worker は **自分の origin**
  がそのまま OIDC issuer (bare origin) であり (`app.takosumi.com` ではなく self-hoster 自身の hostname)、Accounts plane は
  origin root prefix (`/.well-known/*`、 `/oauth/*`、 `/v1/*`、 `/api/v1/*`、 `/__takosumi/*`) を
  `src/worker/server/routes/accounts/mount.ts` で所有する。Takos product はこれら root prefix を持たないので衝突しない。
- **deploy-control 実装自体は public route を持たない**。`src/worker/server/routes/deploy/mount.ts` が
  `@takosjp/takosumi-deploy-worker` (= `../takosumi/worker/src/handler.ts` の tsconfig alias) を in-process で
  立ち上げ、Accounts facade が typed `deployControlOperations` seam 経由で叩く。browser / dashboard 向けには
  Accounts plane が session-gated `/api/v1/*` surface を所有し、そこから in-process seam に委譲する。`/v1/installation-projections/...`
  の namespace 衝突はこの private backend 化で回避している。bearer-gated handshake は単一 worker 内の内部 secret
  (`TAKOSUMI_DEPLOY_CONTROL_TOKEN`)。
- **dashboard は product SPA に fold 済み**。account / installation / run / graph / activity 画面は `@takosumi/dashboard` を
  `web` build に alias して import し、`/v1/*` / `/api/v1/*` を fetch する。
- **Takos self-host worker の `/internal/*` HTTP route は opentofu-runner / executor container callback 用に reserved**。
  account-plane internals は in-process call であり `/internal` を使わない。hosted Takosumi platform worker では別途
  signed Gateway provider endpoint bridge と operator hardening gate が `/internal/*` に存在するが、Takos self-host product
  route ではない。
- **bearer は session cookie + in-process JWKS (`auth/in-process-bearer.ts`) の 2 経路のみ**。remote introspection は使わ
  ない。

## 隣接 product との contract

- **Upstream source owner**: `../takosumi/` — deploy-control + Accounts plane の **実装 source owner**。`takos` worker は
  その handler を tsconfig alias で in-process import する (別 service として network 越しに呼ばない)。
- **Downstream**: self-host / operator deploy (この repo を自分の infra に build & deploy し、secret は repo の外で管理)、
  bundled apps (`../takos-apps/*`、 `../yurucommu/`、
  `../road-to-me/`)
- **Internal**: `src/worker` (single worker: product + Accounts plane + deploy-control を in-process 同居)、 `web` (UI、
  folded dashboard 含む)、 `containers/git` (Git hosting container)、 `containers/agent` (agent execution container)

## Terminology

| term                        | 意味                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Takos distribution**      | OpenTofu-native, Takosumi-managed AI-first workspace distribution。 = `takos/` repository が供給する user-facing product surface (Worker + UI + Git/agent containers + first-party Capsule apps)。 |
| **Takos product**           | Takos distribution 内の chat / agent / memory / Workspace / app launcher / Takos Service Graph profile。Takosumi substrate とは source owner を分ける。                                            |
| **takos-worker**            | Takos product の唯一の public/control Worker。Hono route、OIDC consumer、chat / agent / memory / space と generic workspace service API surface を所有する。                                       |
| **takos-git / takos-agent** | repo や source directory ではなく、Git hosting / agent execution の container artifact/service id。source owner は `containers/git` / `containers/agent`。                                         |
| **Takos app (= 抽象)**      | Takosumi 上で install/deploy される 1 application unit。 bundled apps (takos-docs / takos-slide / takos-excel / takos-computer / yurucommu) や third-party app が該当する。                        |

`Takos product` vs `Takos app` の混同を避けるため、 docs では次の wording を使う:

- Takos distribution 全体 / shell を指すとき: "**Takos distribution**"、 "Takos"
- Takos product の runtime component を指すとき: "**takos-worker**" / "**takos-git container**" / "**takos-agent container**"
- Takosumi 上の 1 app unit を指すとき: "**Takos app**" / "**bundled app**" / "**third-party app**"
- Workspace 内で発行・消費される service を指すとき: "**Takos Service Graph profile**" または Takosumi 標準の
  "**ServiceExport / ServiceBinding / ServiceGrant**"。

## Layering doctrine

route → service → db の purity layer は **要求しない**。speculative な抽象化層を作らないことを優先する。

- **route は infra / db に直接アクセスしてよい**。1 route の中で完結するロジックは、わざわざ service にくり出さない。
- **service を切り出すのは次のいずれかのときだけ**: (a) 同じロジックを **2 つ以上の route** が共有する、 (b) **transaction
  境界をまたぐ** (複数 route / job から呼ばれる atomic な書き込み)。
- 「いつか分離 service になるかも」 / 「層を揃えるため」 だけの speculative な service / adapter / interface 層は作らない。
  単一 worker / 単一 operator が現実なので、複数実装を想定した抽象は使われない死コードになる。
- 既存コードの churn を doctrine 適合のためだけに発生させない。新規・改修コードでこの基準を満たす。

この doctrine は `../ARCHITECTURE.md` と整合する。physical な source-owner 境界 (下記 `§ Layer rules`) は引き続き有効で、
これは「層の純度」 ではなく「どの root が何の source owner か」 の境界。

## Layer rules

- `src/worker` is the only public/control Worker source owner; it hosts the Takos product, the in-process Accounts plane,
  and the in-process deploy-control plane in one worker. Hono route shards live in `src/routes`; Worker-local product
  logic stays under `src/worker`; shared wire shapes live in `src/contracts`.
- `web/` (folded dashboard を含む) may call public / `/v1/*` APIs and consume generated/client contracts, but must not
  import Worker implementation internals.
- `containers/git/` and `containers/agent/` are container implementation roots. They may consume `src/contracts/*` but must
  not import Worker route/domain implementation.
- Git CLI / bare repo filesystem / SQLite / Smart HTTP backend code belongs in `containers/git`, not in the Worker.
- Rust agent execution wrapper belongs in `containers/agent`; reusable engine code stays in `../takos-agent-engine`.
- Accounts plane / deploy-control の **実装** は `../takosumi/` が source owner。`takos` worker は handler を tsconfig
  alias で in-process import するだけ — そのソースを `takos/` に fork / copy しない。
- `deploy/` (Cloudflare のみ) は product implementation source path を import しない。`deploy/cloudflare` の wrangler /
  worker bootstrap、`deploy/opentofu/modules/cloudflare`、`deploy/distributions/cloudflare.json` を所有する。

## Workflow

```bash
cd takos
bun run doctor
bun run local:up        # local stack
bun run local:e2e
bun run lint:agent-docs
bun run validate:architecture
bun run release-gate
bun run lint:docs       # VitePress build gate
bun run docs:deploy     # Cloudflare Pages
```

## Naming history

`takos-paas`、 `TAKOS_PAAS_*`、 `deployment-paas-*`、 `dev:paas` は pre-split 名。 current source path / service id /
env var / CI task / docs は `takosumi` / `TAKOSUMI_*` を使う。

root 統合で retired した topology 名 (current source / config / docs に再導入しない):

- 分離 sub-domain `accounts.takosumi.com` / `deploy-control.takosumi.com` — 両 plane は同居 worker (operator の Takosumi
  platform worker は `app.takosumi.com`、self-host された Takos distribution worker は自分の origin) に in-process 統合済み。
- multi-cloud deploy artifacts (`deploy/helm`、 `deploy/opentofu/modules/{aws,gcp}`、
  `deploy/distributions/{aws,gcp,kubernetes,selfhosted}.json`)、operator-distribution / substitutability framing、
  multi-operator 機構 — operator が運用するのは 1 つの Takosumi platform worker が現実。

これらの旧名は naming history として この section でのみ言及し、current docs に old-name carry-over instructions として
再導入しない。

## 関連 docs

- [`README.md`](README.md) — Takos product shell の overview
- [`docs/`](docs/) — Takos product 専用 VitePress site (docs.takos.jp)
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — ecosystem layering 原則
- [`../AGENTS.md`](../AGENTS.md) — ecosystem AI 作業ルール
- [`../docs/quality/takosumi-completion-audit.md`](../docs/quality/takosumi-completion-audit.md) — Takosumi completion evidence gate
