# AGENTS.md — takos (Takos product shell)

`takos` は **Takos distribution shell** で、単一の Takos distribution Worker (`src/worker`)、UI (`web`)、Cloudflare Container 実装
(`containers/git` / `containers/agent`) と shell-owned Cloudflare deploy artifacts (`deploy/cloudflare` /
`deploy/opentofu/modules/cloudflare` / `deploy/distributions/cloudflare.json` / validator) を集約する。Takos は
**OpenTofu-native, Takosumi-managed な first-party AI workspace distribution** で、app / deploy topology は Git-hosted
OpenTofu Capsule として扱い、Takosumi 専用 manifest や DSL を要求しない。product-grade lifecycle は外部 Takosumi
control plane (Accounts / deploy-control / dashboard / OpenTofu runner / Run ledger / policy / audit) が管理し、Takos
product surface (chat / agent / memory / Workspace / app launcher / Takos Capsule output projection profile) はその上で動く
通常の Capsule / distribution Worker として deploy される。deploy の正本は
[`deploy/opentofu`](deploy/opentofu) module (`var.target = cloudflare`): `tofu apply` が Takos distribution worker の
durable backing infra を provision し、worker artifact (`deploy/cloudflare` の wrangler step) はその module output を読む。
Takos worker は **OIDC issuer ではなく client/resource server** であり、Takosumi Accounts / Capsule projection API は
`TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` で指す外部 Takosumi origin から消費する。Takosumi / Takos の
identity と vocabulary は root docs [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) と
[`../docs/reference/glossary.md`](../docs/reference/glossary.md) を正本にする。

> **Takos is an OpenTofu-native AI workspace distribution managed by the Takosumi ecosystem.** It uses plain
> Git-hosted OpenTofu Capsules as the app / deploy input and adds the Takos product experience: AI agents, chat,
> Workspaces, memory, app launcher, Takos-facing service surfaces for Git / storage / agent runtime /
> MCP, and first-party Capsule apps (`takos-office` / `takos-computer` / `yurucommu`) seeded on new Workspace creation.
> A self-host Takos deployment is a Takos product Worker installed and reconciled by a Takosumi control plane; Accounts,
> dashboard, the Run ledger, and OpenTofu runner remain Takosumi services outside the Takos Worker.

Takos の constituent (AI agents / Git / memory / Workspaces / tools) と「ソフトウェアの民主化」 core concept の formal
definition は [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) §0 を参照。

曖昧 / 旧 wording (「Takos は通常の App ではない」 だけの表現等) を増やさず、 root docs の vocabulary に統一する。
Takosumi の public model は `Workspace` / `Project` / `Capsule` / `Source` / `ProviderConnection` /
`CredentialRecipe` / `ProviderBinding` / `Secret` / `Run` / `Plan` / `Apply` / `Destroy` / `StateVersion` /
`Output` / `Runner` / `AuditEvent` / `Operator`。旧 `Space` / `Installation` / `Deployment` / `Output` /
Provider Catalog / Capsule output projection 語彙は migration debt として扱い、新規の正本 public vocabulary として増やさない。

## 責務

### 持つ

- Takos distribution Worker の source owner (`src/worker` / `src/routes` / `src/contracts`)
- UI source owner (`web`)
- Git / agent container implementation owner (`containers/git`、 `containers/agent`)
- Takosumi Accounts OIDC client / JWT bearer validation / Capsule projection API client
- shell-owned Cloudflare deploy artifacts (`deploy/cloudflare`、 `deploy/opentofu` (cloudflare module)、
  `deploy/distributions/cloudflare.json`)
- shell-owned planning docs (`docs/contributing/`、 旧 `plan/`)
- product validator scripts (release-gate / validate:opentofu-secrets / validate:patch-management 等)

### 持たない

- Takosumi service / Accounts plane / deploy-control / dashboard / OpenTofu runner の **実装 source** (`../takosumi/` が
  source owner)。`takos` は contract source を tsconfig alias 経由で参照してよいが、handler を in-process import しない
- standalone runtime service split repositories for Takos app / Git / agent (single worker に統合済み)
- operator config / secrets の保管 (repo の外、例: `~/.takos-secrets/<env>/` に置く)。production / staging deploy は
  self-hoster / operator が自分の infra に対して wrangler + tofu で実行する
- generic `common` package (service-local helper のみ許可)

## 単一 Worker のトポロジ

current reality は **Takos は OpenTofu-native, Takosumi-managed な AI workspace distribution Worker** です。`tofu apply` +
wrangler step は Takos worker の durable backing infra と worker artifact を materialize する reference deployment path であり、
Takosumi Accounts / dashboard / deploy-control / OpenTofu runner は外部 Takosumi control plane 側に残す。

- **Takos worker は product route owner**。`/.well-known/takosumi` / `/v1/capabilities` の discovery と、Takos product API /
  UI / Git / agent runtime / container callbacks を所有する。Takosumi Accounts の `/.well-known/openid-configuration`、`/oauth/*`、
  `/api/v1/*`、dashboard routes は持たない。
- **Takosumi control plane は external dependency**。OIDC issuer と Capsule projection API は `OIDC_ISSUER_URL` /
  `TAKOSUMI_ACCOUNTS_URL` / optional `TAKOSUMI_ACCOUNTS_INTERNAL_URL` で解決する。server-to-server Capsule calls は
  operator が発行した `TAKOSUMI_ACCOUNTS_TOKEN` を使う。
- **OpenTofu runner / Run ledger は Takosumi 側**。Takos deploy artifacts は product `DB`、KV/R2、queues、runtime/executor
  containers、Vectorize など Takos worker の backing resources だけを宣言する。`TAKOSUMI_CONTROL_DB`、`COORDINATION`、
  `RUNNER`、Takosumi runner container image は Takos deploy artifact に持ち込まない。
- **UI は Takos product UI**。account / billing / install run / graph / activity の operator UI は Takosumi dashboard に残す。
  Takos の Source/App 画面は必要に応じて外部 Takosumi Capsule projection API を呼び、dashboard component を直接 import しない。
- **bearer は session cookie + configured issuer JWKS verification**。JWT bearer validation は `OIDC_ISSUER_URL` の JWKS を
  fetch し、local `authIdentities` に紐付く user に解決する。Takos worker 自身が JWKS / OAuth token issuer にはならない。

## 隣接 product との contract

- **Upstream source owner**: `../takosumi/` — deploy-control + Accounts plane + dashboard + runner の **実装 source owner**。
  `takos` worker は contract source を tsconfig alias で参照し、runtime では外部 Takosumi API / OIDC issuer として消費する。
- **Downstream**: self-host / operator deploy (この repo を自分の infra に build & deploy し、secret は repo の外で管理)、
  bundled apps (`../takos-apps/*`、 `../yurucommu/`、
  `../road-to-me/`)
- **Internal**: `src/worker` (Takos product worker)、 `web` (Takos UI)、 `containers/git` (Git hosting container)、
  `containers/agent` (agent execution container)

## Terminology

| term                        | 意味                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Takos distribution**      | OpenTofu-native, Takosumi-managed AI-first workspace distribution。 = `takos/` repository が供給する user-facing product surface (Worker + UI + Git/agent containers + first-party Capsule apps)。 |
| **Takos product**           | Takos distribution 内の chat / agent / memory / Workspace / app launcher / Takos Capsule output projection profile。Takosumi substrate とは source owner を分ける。                                            |
| **takos-worker**            | Takos product の唯一の public/control Worker。Hono route、OIDC consumer、chat / agent / memory / space と generic workspace service API surface を所有する。                                       |
| **takos-git / takos-agent** | repo や source directory ではなく、Git hosting / agent execution の container artifact/service id。source owner は `containers/git` / `containers/agent`。                                         |
| **Takos app (= 抽象)**      | Takosumi 上で install/deploy される 1 application unit。 bundled apps (`takos-office` / `takos-computer` / `yurucommu`) や third-party app が該当する。                        |

`Takos product` vs `Takos app` の混同を避けるため、 docs では次の wording を使う:

- Takos distribution 全体 / shell を指すとき: "**Takos distribution**"、 "Takos"
- Takos product の runtime component を指すとき: "**takos-worker**" / "**takos-git container**" / "**takos-agent container**"
- Takosumi 上の 1 app unit を指すとき: "**Takos app**" / "**bundled app**" / "**third-party app**"
- Workspace 内で発行・消費される service を指すとき: "**Takos Capsule output projection profile**" または
  "**Capsule Output projection**"。`ServiceExport` / `ServiceBinding` / `ServiceGrant` は旧 Service Graph ledger を
  連想させるため、現行 public vocabulary として増やさない。

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

- `src/worker` is the only Takos public/control Worker source owner. It hosts Takos product routes and consumes external
  Takosumi OIDC / Capsule projection APIs; it does not mount Takosumi Accounts or deploy-control handlers in-process.
  Hono route shards live in `src/routes`; Worker-local product logic stays under `src/worker`; shared wire shapes live in
  `src/contracts`.
- `web/` is the Takos product UI. It may call Takos public APIs and consume generated/client contracts, but must not
  import Worker implementation internals or Takosumi dashboard components.
- `containers/git/` and `containers/agent/` are container implementation roots. They may consume `src/contracts/*` but must
  not import Worker route/domain implementation.
- Git CLI / bare repo filesystem / SQLite / Smart HTTP backend code belongs in `containers/git`, not in the Worker.
- Rust agent execution wrapper belongs in `containers/agent`; reusable engine code stays in `../takos-agent-engine`.
- Accounts plane / deploy-control / dashboard / OpenTofu runner の **実装** は `../takosumi/` が source owner。`takos` worker は
  contract source を tsconfig alias で参照してよいが、handler source を mount / fork / copy しない。
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

- Takos worker 内の embedded `accounts/mount` / `deploy/mount` / folded dashboard / OpenTofu runner DO — Takosumi
  control-plane responsibilities として外部 Takosumi platform 側に戻した。
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
