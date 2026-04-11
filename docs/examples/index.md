# サンプル集

Takos の `publish + consume` contract を前提にした最小構成をまとめています。

## サンプル一覧

### [Worker だけのシンプルなアプリ](/examples/simple-worker)

- Worker 1 つ
- route 1 つ
- provider publication なし

### [Worker + DB](/examples/worker-with-db)

- Worker 1 つ
- `takos/sql` と `takos/object-store` を consume
- endpoint / credential を env で受け取る

### [Worker + Container](/examples/worker-with-container)

- Worker 1 つ + attached container 1 つ
- publish/consume contract と attached container を併用

### [MCP Server](/examples/mcp-server)

- Worker 1 つ
- `McpServer` publication を公開
- 他 compute / client は explicit consume で使う

### [マルチサービス構成](/examples/multi-service)

- compute 2 つ
- 同じ publication を複数 consumer が共有
- background job は schedule trigger で起動

## Default Group 構成

- [takos-computer](/platform/takos-computer)
- [takos-docs](/platform/takos-docs)
- [takos-excel](/platform/takos-excel)
- [takos-slide](/platform/takos-slide)
