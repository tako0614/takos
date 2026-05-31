# AGENTS.md — takos (Takos product shell)

`takos` は **Takos product shell** で、単一の Takos Worker (`src/worker`)、UI (`web`)、Cloudflare Containers /
self-host container 実装 (`containers/git` / `containers/agent`) と shell-owned distribution artifacts (Helm / Terraform /
distribution manifests / validator) を集約する。Takosumi / Takos の identity と vocabulary
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

曖昧 / 旧 wording (「Takos は通常の App ではない」 だけの表現等) を増やさず、 root docs の vocabulary に統一する (=
Takosumi 公開概念は `AppSpec` / `Installation` / `Deployment` の 3 つだけ)。

## 責務

### 持つ

- Takos Worker の source owner (`src/worker` / `src/routes` / `src/contracts`)
- UI source owner (`web`)
- Git / agent container implementation owner (`containers/git`、 `containers/agent`)
- shell-owned distribution artifacts (`deploy/distributions/`、 `deploy/helm/`、 `deploy/terraform/`)
- shell-owned planning docs (`docs/contributing/`、 旧 `plan/`)
- product validator scripts (release-gate / validate:helm / validate:distributions 等)

### 持たない

- Takosumi substrate / account-plane implementation code
- standalone runtime service split repositories for Takos app / Git / agent
- standalone deploy / runtime service (`../takosumi/` の lifecycle ownership)
- production / staging deploy 実行 (`../takos-private/` の責務)
- generic `common` package (service-local helper のみ許可)

## 隣接 product との contract

- **Upstream platform**: `../takosumi/` (kernel + installer)、 `../takosumi-cloud/` (Accounts)
- **Downstream**: `../takos-private/` (deployment artifact 消費)、 bundled apps (`../takos-apps/*`、 `../yurucommu/`、
  `../road-to-me/`)
- **Internal**: `src/worker` (public/control Worker)、 `web` (UI)、 `containers/git` (Git hosting container)、
  `containers/agent` (agent execution container)

## Terminology

| term                                    | 意味                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Takos product**                       | self-hostable AI-first chat & agent product。 = takos.jp で deploy される shell。 = `takos/` repository の product 単位 (Worker + UI + Git/agent containers + bundled apps の集合体)。       |
| **takos-worker**                        | Takos product の唯一の public/control Worker。Hono route、OIDC consumer、chat / agent / memory / space / Git public API surface を所有する。                                              |
| **takos-git / takos-agent**             | repo や source directory ではなく、Git hosting / agent execution の container artifact/service id。source owner は `containers/git` / `containers/agent`。                                  |
| **Takos app (= 抽象)**                  | Takosumi 上で deploy される 1 application unit (= AppSpec で declare)。 bundled apps (takos-docs / takos-slide / takos-excel / takos-computer / yurucommu) や third-party app が該当する。 |

`Takos product` vs `Takos app` の混同を避けるため、 docs では次の wording を使う:

- Takos product 全体 / shell を指すとき: "**Takos product**"、 "Takos"
- Takos product の runtime component を指すとき: "**takos-worker**" / "**takos-git container**" / "**takos-agent container**"
- Takosumi 上の 1 app unit を指すとき: "**Takos app**" / "**bundled app**" / "**third-party app**"
- Takos product の core feature (= Worker/domain/container 内部 feature) を指すとき: "**Takos product core feature**" (Agent / Chat / Git
  / Storage / Store)

## Substitutability

- **Takos product 自体**: Takosumi PaaS 上で動作する self-hostable product。 AI agents / Git / chat / spaces / memory /
  tools を駆使してソフトウェアの民主化を体現。 層 (layer) ではないが、 architectural 特権 framing も使わない (App
  consumer side)。
- **Takosumi への依存**: kernel + installer / operator account plane は substitutable (詳細は
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §「Layering Principle: Substitutability」)。

## Layer rules

- `src/worker` is the only public/control Worker source owner. Hono route shards live in `src/routes`; Worker-local
  product logic stays under `src/worker`; shared wire shapes live in `src/contracts`.
- `web/` may call public APIs and consume generated/client contracts, but must not import Worker implementation internals.
- `containers/git/` and `containers/agent/` are container implementation roots. They may consume `src/contracts/*` but must
  not import Worker route/domain implementation.
- Git CLI / bare repo filesystem / SQLite / Smart HTTP backend code belongs in `containers/git`, not in the Worker.
- Rust agent execution wrapper belongs in `containers/agent`; reusable engine code stays in `../takos-agent-engine`.
- `deploy/` must not import product implementation source paths; connect through published packages, images, APIs, and
  manifests.
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
bun run doctor
bun run local:up        # local stack
bun run local:e2e
bun run validate:helm
bun run validate:distributions
bun run lint:agent-docs
bun run validate:architecture
bun run release-gate
bun run lint:docs       # VitePress build gate
bun run docs:deploy     # Cloudflare Pages
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
- [`../ROADMAP.md`](../ROADMAP.md) — Takos / Takosumi / Takosumi Cloud completion roadmap
