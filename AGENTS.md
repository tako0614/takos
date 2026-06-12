# AGENTS.md — takos (Takos product shell)

`takos` は **Takos product shell** で、単一の Takos Worker (`src/worker`)、UI (`web`)、Cloudflare Container 実装
(`containers/git` / `containers/agent`) と shell-owned Cloudflare deploy artifacts (`deploy/cloudflare` /
`deploy/opentofu/modules/cloudflare` / `deploy/distributions/cloudflare.json` / validator) を集約する。Takos は
**plain OpenTofu module として完結する** self-hostable application で、deploy の正本は
[`deploy/opentofu`](deploy/opentofu) module (`var.target = cloudflare`): `tofu apply` が全 durable infra を provision し、
worker artifact (`deploy/cloudflare` の wrangler step) はその module output を読む 1 ステップで上がる。**Takosumi は不要**。
self-host された worker は **自分の origin** で動き、embedded accounts plane により自分が OIDC issuer になる
(`app.takosumi.com` は operator の Takosumi platform worker の origin であって Takos product worker の origin ではない)。
統合 Takos worker は Takos product に加えて Takosumi Accounts plane と Takosumi deploy-control plane を **in-process** で
同居させる (詳細は後述 [`§ 単一 Worker のトポロジ`](#単一-worker-のトポロジ))。Takosumi / Takos の identity と vocabulary は
root docs [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) と
[`../docs/reference/glossary.md`](../docs/reference/glossary.md) を正本にする。

> **Takos is a self-hostable product that is complete as a plain OpenTofu module — `tofu apply` provisions all durable
> infra and one wrangler step uploads the worker artifact that reads the module outputs, with no Takosumi required — with
> _democratization of software through AI agents_ as its core concept. It leverages AI agents, Git, chat, spaces, memory,
> and tools, and ships 1st-party apps (`takos-docs` / `takos-slide` / `takos-excel` / `takos-computer` / `yurucommu`)
> auto-installed on new space creation as a user-facing convenience.** **Takosumi** is an optional convenience: running
> that same plain OpenTofu module through Takosumi installs it and records the run ledger (`Installation` / `Run` /
> `Deployment` / `OutputSnapshot`), with `Connection` / `ProviderBinding` / policy resolving provider credentials,
> provider allowlists, state handling, and runner boundaries. Takos holds no special coupling to Takosumi; it is just one plain
> OpenTofu module app among others. In a self-host deployment, deploy-control and the Accounts plane run **in-process
> inside this Takos product worker at the self-hoster's own origin** (the embedded accounts plane is that instance's OIDC
> issuer); they are implementation source owned by `../takosumi/`, imported via tsconfig alias — not a separate service
> and not a privileged layer above the product. `app.takosumi.com` is the operator's Takosumi platform worker, a separate
> build target, not this product worker.

Takos の constituent (AI agents / Git / memory / spaces / tools) と「ソフトウェアの民主化」 core concept の formal
definition は [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) §0 を参照。

曖昧 / 旧 wording (「Takos は通常の App ではない」 だけの表現等) を増やさず、 root docs の vocabulary に統一する (=
Takosumi の public concept は `Space` / `Source` / `Connection` / `Installation` / `Dependency` / `Run` /
`RunGroup` / `Deployment` / `OutputSnapshot` / `Activity` に閉じる)。

## 責務

### 持つ

- Takos Worker の source owner (`src/worker` / `src/routes` / `src/contracts`)
- UI source owner (`web`)
- Git / agent container implementation owner (`containers/git`、 `containers/agent`)
- in-process Accounts plane / deploy-control mount glue (`src/worker/server/routes/accounts/mount.ts` /
  `src/worker/server/routes/deploy/mount.ts`) と folded dashboard UI (`web/src/views/account`、
  `web/src/views/installations`)
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

current reality は **Takos は plain OpenTofu module として完結する self-host application** で、`tofu apply` + wrangler step 1 つ
で Takosumi 抜きに self-host できる (`takosumi.com` landing / `takos.jp` 紹介サイト)。Takosumi を運用するかどうかは operator の
任意で、運用する場合に動かすのは Takosumi platform worker (`app.takosumi.com`) だけ。multi-operator / multi-cloud /
分離 sub-service の機構は retired (下記 [`§ Naming history`](#naming-history))。以下は self-host された Takos product worker の
in-process トポロジ (operator の platform worker も同じ accounts plane / deploy-control source を別 build target で compose する)。

- **product + Accounts plane + deploy-control が 1 worker に in-process 同居**する。self-host された worker は **自分の origin**
  がそのまま OIDC issuer (bare origin) であり (`app.takosumi.com` ではなく self-hoster 自身の hostname)、Accounts plane は
  origin root prefix (`/.well-known/*`、 `/oauth/*`、 `/v1/*`、 `/start`、 `/__takosumi/*`) を
  `src/worker/server/routes/accounts/mount.ts` で所有する。Takos product はこれら root prefix を持たないので衝突しない。
- **deploy-control は public route を一切持たない**。`src/worker/server/routes/deploy/mount.ts` が
  `@takosjp/takosumi-deploy-worker` (= `../takosumi/worker/src/handler.ts` の tsconfig alias) を in-process で
  立ち上げ、Accounts facade が in-process fetch seam (`deployControl.fetch`) 経由で叩く。`/v1/app-installations/...` の
  namespace 衝突はこの private backend 化で回避している。bearer-gated handshake は単一 worker 内の内部 secret
  (`TAKOSUMI_DEPLOY_CONTROL_TOKEN`)。
- **dashboard は product SPA に fold 済み**。account / installation 画面は `web/src/views/account` /
  `web/src/views/installations` の SPA view で、`/v1/*` を fetch する (旧 `dashboard-ui` package は削除済み)。
- **`/internal/*` HTTP route は opentofu-runner / executor container callback 専用に reserved**。account-plane internals は
  in-process call であり `/internal` を使わない。
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

| term                                    | 意味                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Takos product**                       | self-hostable AI-first chat & agent product。 = takos.jp で deploy される shell。 = `takos/` repository の product 単位 (Worker + UI + Git/agent containers + bundled apps の集合体)。       |
| **takos-worker**                        | Takos product の唯一の public/control Worker。Hono route、OIDC consumer、chat / agent / memory / space / Git public API surface を所有する。                                              |
| **takos-git / takos-agent**             | repo や source directory ではなく、Git hosting / agent execution の container artifact/service id。source owner は `containers/git` / `containers/agent`。                                  |
| **Takos app (= 抽象)**                  | Takosumi 上で install/deploy される 1 application unit。 bundled apps (takos-docs / takos-slide / takos-excel / takos-computer / yurucommu) や third-party app が該当する。 |

`Takos product` vs `Takos app` の混同を避けるため、 docs では次の wording を使う:

- Takos product 全体 / shell を指すとき: "**Takos product**"、 "Takos"
- Takos product の runtime component を指すとき: "**takos-worker**" / "**takos-git container**" / "**takos-agent container**"
- Takosumi 上の 1 app unit を指すとき: "**Takos app**" / "**bundled app**" / "**third-party app**"
- Takos product の core feature (= Worker/domain/container 内部 feature) を指すとき: "**Takos product core feature**" (Agent / Chat / Git
  / Storage / Store)

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
  platform worker は `app.takosumi.com`、self-host された Takos product worker は自分の origin) に in-process 統合済み。
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
- [`../ROADMAP.md`](../ROADMAP.md) — Takos / Takosumi / Takosumi completion roadmap
