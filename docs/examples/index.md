# サンプル集

Takos の component / publication / binding contract を前提にした最小構成を
まとめています。

## サンプル一覧

### [JS bundle component だけのシンプルな group](/examples/simple-worker)

- component 1 つ (`runtime.js-worker@v1`)
- route 1 つ
- publication / built-in provider binding なし

### [Component + DB](/examples/worker-with-db)

- component 1 つ
- DB / object-store 接続先を `bindings[]` で env として受け取る

### [Component + 子 component (sidecar)](/examples/worker-with-container)

- 親 component + 子 component (`runtime.oci-container@v1`)
- publication と子 component を併用

### [MCP Server](/examples/mcp-server)

- component 1 つ
- `publication.mcp-server@v1` publication を公開
- 他 component / client は explicit `bindings[].from.publication` で使う

### [マルチ component 構成](/examples/multi-service)

- component 2 つ
- 同じ publication を複数 consumer が共有
- background job は `interface.schedule@v1` + `route.schedule@v1` で起動

## Default Group 構成

- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
- [takos-computer](/platform/takos-computer)
- [yurucommu](/platform/yurucommu)
