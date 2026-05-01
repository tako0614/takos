# サンプル集

Takos の group / publication / consume contract を前提にした最小構成を
まとめています。

## サンプル一覧

### [Worker だけのシンプルな group](/examples/simple-worker)

- Worker 1 つ
- route 1 つ
- publication / built-in provider consume なし

### [Worker + DB](/examples/worker-with-db)

- Worker 1 つ
- DB / object-store 接続先を env で受け取る

### [Worker + Container](/examples/worker-with-container)

- Worker 1 つ + attached container 1 つ
- publication contract と attached container を併用

### [MCP Server](/examples/mcp-server)

- Worker 1 つ
- `publication.mcp-server@v1` publication を公開
- 他 compute / client は explicit consume で使う

### [マルチサービス構成](/examples/multi-service)

- compute 2 つ
- 同じ publication を複数 consumer が共有
- background job は schedule trigger で起動

## Default Group 構成

- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
- [takos-computer](/platform/takos-computer)
- [yurucommu](/platform/yurucommu)
