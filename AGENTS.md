# AGENTS.md — takos (Takos product shell)

`takos` は **Takos product shell** で、 nested submodule (`app/` / `git/` / `agent/`) と shell-owned distribution
artifacts (Helm / Terraform / distribution manifests / validator) を集約する。Takosumi / Takos の identity と vocabulary
は root docs [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) と
[`../docs/reference/glossary.md`](../docs/reference/glossary.md) を正本にする。

> **Takos is a self-hostable product running on Takosumi PaaS, with _democratization of software through AI agents_ as
> its core concept. It leverages AI agents, Git, chat, spaces, memory, and tools, and ships 1st-party apps (`takos-docs`
> / `takos-slide` / `takos-excel` / `takos-computer` / `yurucommu`) auto-installed on new space creation as a
> user-facing convenience.** **Takosumi** is a generic PaaS for `.takosumi.yml` AppSpec installation, Deployment
> records, resource graphs, output wiring, and provider materialization across arbitrary infrastructure; it is not
> Takos-specific. `takosumi-cloud` is a replaceable operator distribution / deployment, not a privileged Takosumi layer.

Takos の constituent (AI agents / Git / memory / spaces / tools) と「ソフトウェアの民主化」 core concept の formal
definition は [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) §0 を参照。

曖昧 / 旧 wording (「Takos は通常の App ではない」 だけの表現等) を増やさず、 root docs の vocabulary
に統一する (= Takosumi 公開概念は `AppSpec` / `Installation` / `Deployment` の 3 つだけ)。

## 責務

### 持つ

- nested submodule の集約 (`app/`、 `git/`、 `agent/`)
- shell-owned distribution artifacts (`deploy/distributions/`、 `deploy/helm/`、 `deploy/terraform/`)
- shell-owned planning docs (`docs/contributing/`、 旧 `plan/`)
- product validator scripts (release-gate / validate:helm / validate:distributions 等)

### 持たない

- product implementation code (各 nested submodule の責務)
- workspace 設定の集約 (各 nested submodule が独立)
- standalone deploy / runtime service (`../takosumi/` の lifecycle ownership)
- production / staging deploy 実行 (`../takos-private/` の責務)
- generic `common` package (service-local helper のみ許可)

## 隣接 product との contract

- **Upstream platform**: `../takosumi/` (kernel + installer)、 `../takosumi-cloud/` (Accounts)
- **Downstream**: `../takos-private/` (deployment artifact 消費)、 bundled apps (`../takos-apps/*`、 `../yurucommu/`、
  `../road-to-me/`)
- **Internal**: `app/` (user-facing)、 `git/` (Git hosting)、 `agent/` (agent execution)

## Substitutability

- **Takos product 自体**: Takosumi PaaS 上で動作する self-hostable product。 AI agents / Git / chat / spaces / memory /
  tools を駆使してソフトウェアの民主化を体現。 層 (layer) ではないが、 architectural 特権 framing も使わない (App
  consumer side)。
- **Takosumi への依存**: kernel + installer / operator account plane は substitutable (詳細は
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §「Layering Principle: Substitutability」)。

## Layer rules

- `app/` may depend on service contracts only, not on implementation packages.
- `git/` must not import `app/` implementation.
- `deploy/` must not import product implementation source paths; connect through published packages, images, APIs, and
  manifests.
- `agent/` may depend on `../takos-agent-engine` as an external path/package.
- Provider plugins must depend on Takosumi plugin contracts/SDK (`jsr:@takos/takosumi-plugins`), not on kernel
  implementation paths.
- The PaaS kernel implementation lives in the standalone Takosumi repository (`../takosumi/`,
  `jsr:@takos/takosumi-kernel`). `deploy/` here only carries Takos-specific deploy artifacts that wrap the upstream
  kernel.
- The official provider bundle is **Takosumi** (`@takos/takosumi-plugins`, in-tree at `../takosumi/`).
- Hosting target ids are an open enum backed by `registerHostingTarget(...)` from `takosumi-contract/hosting`.

## Workflow

```bash
cd takos
deno task doctor
deno task local:up        # local stack
deno task local:e2e
deno task validate:helm
deno task validate:distributions
deno task lint:agent-docs
deno task validate:architecture
deno task release-gate
deno task lint:docs       # VitePress build gate
deno task docs:deploy     # Cloudflare Pages
```

## Naming history

`takos-paas`、 `TAKOS_PAAS_*`、 `deployment-paas-*`、 `dev:paas` は pre-split 名。 current source path / service id /
Helm resource / env var / CI task / docs は `takosumi` / `TAKOSUMI_*` を使う。これらの旧名は naming history として この
section でのみ言及し、current docs に old-name carry-over instructions として再導入しない。

## 関連 docs

- [`README.md`](README.md) — Takos product shell の overview
- [`docs/`](docs/) — Takos product 専用 VitePress site (docs.takos.jp)
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — ecosystem layering 原則
- [`../AGENTS.md`](../AGENTS.md) — ecosystem AI 作業ルール
- [`../ROADMAP.md`](../ROADMAP.md) — Phase 1.x active plan
