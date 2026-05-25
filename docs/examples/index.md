# サンプル集

> このページでわかること: `.takosumi.yml` AppSpec
> を使ったアプリのサンプル一覧。コピーして使えます。

Examples use short kind names such as `worker`, `postgres`, and `gateway` as
operator-profile aliases. URI kind values are also valid. The route list in
gateway `spec` belongs to the adopted gateway descriptor's open `spec`; AppSpec
core fields are `kind`, `spec`, `publish`, and `listen`.

## List

### [Simple Worker](/examples/simple-worker)

- `worker` component with `spec.entrypoint`
- `web.publish.http` as upstream material
- `gateway` component with listener / gateway descriptor intent

public app endpoint は adopted gateway/ingress component の gateway descriptor intent、launcher / MCP /
health metadata と capability request は Takos product 内部 metadata layer (=
app launcher / MCP registry, AppSpec contract とは別) で表現します。

### [Worker + DB](/examples/worker-with-db)

- worker component plus postgres / object-store components
- runtime env is materialized from `publish.<name>.as` / `listen.<binding>.from`
  declarations

### [Worker + Container](/examples/worker-with-container)

- portable worker entrypoint plus object-store
- operator-specific container is a provider extension

### [MCP Server](/examples/mcp-server)

- MCP HTTP endpoint on a gateway-backed workload
- MCP interface metadata lives in Takos app metadata / registry

### [Multi-service](/examples/multi-service)

- multiple AppSpec components
- explicit AppSpec publish/listen wiring between components (`publish` /
  `listen`)

## Default Group 構成

- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
- [takos-computer](/platform/takos-computer)
- [yurucommu](/platform/yurucommu)
