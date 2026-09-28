# サンプル集

Takosumi に install できる OpenTofu Capsule module の最小構成例です。
どれも普通の OpenTofu module で、module が返すのは deploy の事実（通常の Output）
だけです。service として公開する形は Takosumi 側の Interface / InterfaceBinding が持ちます。

- [シンプルな Worker](/examples/simple-worker) — 1 つの Worker と公開 URL だけの最小 module
- [Worker + DB](/examples/worker-with-db) — D1 を binding として持つ Worker
- [Worker + Container](/examples/worker-with-container) — container 対応の Durable Object を持つ Worker
- [MCP Server](/examples/mcp-server) — MCP endpoint を Interface として公開する module
- [マルチサービス構成](/examples/multi-service) — 複数の service を 1 つの Capsule にまとめる構成
