# Examples

Current examples should use `.takosumi/app.yml` plus `.takosumi/manifest.yml`
and the `resources[]` Shape model. Legacy component / route / publication
examples are being retired as each page is updated.

## List

### [Simple Worker](/examples/simple-worker)

- `worker@v1` resource
- `workflowRef.target: spec.artifact.hash`
- `spec.routes` string patterns

### [Worker + DB](/examples/worker-with-db)

- worker resource plus database / object-store resources
- runtime env is materialized from refs and install bindings

### [Worker + Container](/examples/worker-with-container)

- worker resource plus `web-service@v1`
- use `custom-domain@v1` or provider domains for public entrypoints

### [MCP Server](/examples/mcp-server)

- MCP HTTP endpoint on a route-bearing resource
- install-time bindings and permissions live in `.takosumi/app.yml`

### [Multi-service](/examples/multi-service)

- multiple Shape resources
- explicit `${ref:...}` wiring between resources

## Default Group 構成

- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
- [takos-computer](/platform/takos-computer)
- [yurucommu](/platform/yurucommu)
