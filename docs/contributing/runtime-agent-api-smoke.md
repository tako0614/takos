# Runtime agent API smoke script

> このページでわかること: Runtime agent API の smoke テスト。

`scripts/runtime-agent-api-smoke.ts` は runtime agent API の配線を、外部サーバー無しに確認する smoke エントリポイントです。

## 実行

```sh
deno run --config deno.json scripts/runtime-agent-api-smoke.ts
```

`createApiApp` で Hono API を in-process に組み立て、default の internal / public route を無効化し、`InMemoryRuntimeAgentRegistry` を裏に置いた `registerRuntimeAgentRoutes` を mount します。

## カバレッジ

ソケットを開かずに runtime agent lifecycle を検証します。

- API でローカル runtime agent を enroll
- API で heartbeat を送信
- in-memory registry に直接 work item を 1 件 enqueue
- API でその work を lease
- API で lease を completed として報告
- API で drain を要求
- draining 中の agent に追加 lease が割り当てられないことを確認

## 期待される出力

成功時の出力。

- `Runtime agent API smoke passed.`
- agent id
- work id
- lease id
- lifecycle 流れのサマリ
