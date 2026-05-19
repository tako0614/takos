# サンプル集

> このページでわかること: `.takosumi.yml` AppSpec を使ったアプリのサンプル一覧。コピーして使えます。

## List

### [Simple Worker](/examples/simple-worker)

- `worker` component
- `components.web.build.output`
- `components.web.spec.routes` (= worker materializer convention; AppSpec
  contract は kind-agnostic、 Wave J で top-level `interfaces:` を削除済)

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
