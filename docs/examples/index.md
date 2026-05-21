# サンプル集

> このページでわかること: `.takosumi.yml` AppSpec
> を使ったアプリのサンプル一覧。コピーして使えます。

> **Wave N planned (2026-05-21 RFC stage)**: サンプルが使う `build:` field と
> curated 4 kind (= worker / postgres / object-store / custom-domain) は
> takosumi Wave N で削除予定 (= kernel pure contract executor 化、 build は別
> `kind: build` component に移管)。 詳細 design は takosumi
> [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic) を参照。
> 現状のサンプルは引き続き動作します。

## List

### [Simple Worker](/examples/simple-worker)

- `worker` component
- `components.web.build.output`
- `components.web.spec.routes` (= worker materializer convention)

> **Wave J で AppSpec contract から `interfaces:` / `permissions:` / `routes:`
> top-level field を物理削除済** (= takosumi parser は top-level
> `interfaces:` / `permissions:` / `routes:` を reject する)。 launcher / MCP /
> health endpoint / capability request は worker materializer convention
> (= `spec.routes` の HTTP path)、 別 kind の namespace pub/sub、 または Takos
> product 内部 metadata layer (= app launcher / MCP registry, AppSpec contract
> とは別) で表現します。 すなわち AppSpec contract は kind-agnostic、 「底は
> 自由」 原則に従います。

### [Worker + DB](/examples/worker-with-db)

- worker component plus postgres / object-store components
- runtime env is materialized from namespace `publish` / `listen` declarations

### [Worker + Container](/examples/worker-with-container)

- portable worker entrypoint plus object-store
- operator-specific container is a provider extension

### [MCP Server](/examples/mcp-server)

- MCP HTTP endpoint on a route-bearing component
- MCP interface lives in `.takosumi.yml`

### [Multi-service](/examples/multi-service)

- multiple AppSpec components
- explicit namespace pub/sub wiring between components (`publish` / `listen`)

## Default Group 構成

- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
- [takos-computer](/platform/takos-computer)
- [yurucommu](/platform/yurucommu)
