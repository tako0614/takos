# AGENTS.md — takos (Takos product shell)

`takos` は **Takos product shell** で、 nested submodule (`app/` / `git/` / `agent/`) と shell-owned distribution
artifacts (Helm / Terraform / distribution manifests / validator) を集約する。Takos / Takosumi の identity と vocabulary
は root docs [`../docs/reference/design-principles.md`](../docs/reference/design-principles.md) と
[`../docs/reference/glossary.md`](../docs/reference/glossary.md) を正本にする。

> **Takos** is a self-hostable AI-first chat & agent platform with `chat / agent / memory / space` as core functions.
> Bundled apps (`takos-docs / takos-slide / takos-excel / takos-computer / yurucommu`) auto-install when a new space is
> created. Takos runs on **Takosumi**, a generic PaaS for JSON-LD Shape manifests, resource graphs, output wiring, and
> provider materialization across arbitrary infrastructure. Takos is the unique top consumer of Takosumi, not part of
> Takosumi and not a normal InstallableApp. `takosumi-cloud` is a replaceable operator distribution / deployment, not a
> privileged Takosumi layer.

旧来の言い換えを増やさず、root docs の vocabulary に統一する。

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

- **Upstream platform**: `../takosumi/` (kernel)、 `../takosumi-cloud/` (Accounts)
- **Sibling helper**: `../takosumi-git/` (optional installer)
- **Downstream**: `../takos-private/` (deployment artifact 消費)、 bundled apps (`../takos-apps/*`、 `../yurucommu/`、
  `../road-to-me/`)
- **Internal**: `app/` (user-facing)、 `git/` (Git hosting)、 `agent/` (agent execution)

## Substitutability

- **Takos product 自体**: AI-first chat & agent platform。層ではなく unique top consumer。
- **Takosumi への依存**: kernel / operator account plane / takosumi-git は各々 substitutable (詳細は
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
- The official provider bundle is **Takosumi** (`@takosumi/plugins`, in-tree at `../takosumi/`).
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
Helm resource / env var / CI task / docs は `takosumi` / `TAKOSUMI_*` を使う。 historical migration notes でのみ
言及可能 (compatibility / migration history を explicit に説明する場合)。

## 関連 docs

- [`README.md`](README.md) — Takos product shell の overview
- [`docs/`](docs/) — Takos product 専用 VitePress site (docs.takos.jp)
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — ecosystem layering 原則
- [`../AGENTS.md`](../AGENTS.md) — ecosystem AI 作業ルール
- [`../ROADMAP.md`](../ROADMAP.md) — Phase 1.x active plan
