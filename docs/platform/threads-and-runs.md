# Thread / Run / Artifact

> このページでわかること: AI エージェントとの対話を管理する Thread / Run /
> Artifact モデル。

## 概要

Thread は対話のコンテキスト、Run は 1 回のエージェント実行、Artifact
は実行結果です。これらは Takos
のコア機能であり、チャットとエージェント実行の基本モデルを構成します。

## 実行の仕組み

- **Takos product API と agent runtime profile** が Thread / Run
  のライフサイクル、キュー、DB、認証、Workspace の状態を管理します
- **`takos-agent`** (ランタイムコンテナ)
  がcanonical historyを受け取り、bounded model/tool loopを実行します
- agent-control RPC (`/api/internal/v1/agent-control/*`) で両者が連携します

Thread message、summary、memory、skill/tool catalogのdurable authorityはTakos Workerです。engine checkpointもRunに
lease-fenced保存し、restart / 別pool slotではidempotent nodeからresumeできます。ただしcheckpointはconversationやmemoryの第二の
正本ではありません。model request中断点はprovider-neutralなexactly-onceを保証できないため、自動再発行せずfail closedします。
`tool_calls` / `tool_call_id`はstructured transcriptとしてprovider、tool execution、eventまで同じIDを保ちます。

Run の起動には current API では Workspace を指す legacy field `spaceId` が必須です。Capsule/app 経由の Run では
移行互換の Capsule/app context と `runtimeNamespace` が wire metadata として追加される場合があります。これらは container
disk や別の memory authority を選ぶためには使いません。

managed/custom skillとinstalled Capsule / external MCP tool catalogはTakos Workerが正本です。container image内の
snapshotはmodel-visible catalogや実行authorityではありません。

## Thread

継続する対話や作業コンテキスト。メッセージ列、summary、artifact が紐づく。

| field              | 説明                                               |
| ------------------ | -------------------------------------------------- |
| `id` / `space_id`  | 識別子                                             |
| `title` / `status` | タイトルと状態 (`active` / `archived` / `deleted`) |
| `key_points`       | thread の要点                                      |
| `context_window`   | コンテキストウィンドウ設定                         |

### Message

| field                         | 説明                                     |
| ----------------------------- | ---------------------------------------- |
| `role`                        | `user` / `assistant` / `system` / `tool` |
| `content`                     | メッセージ本文                           |
| `tool_calls` / `tool_call_id` | tool call の payload と応答 ID           |
| `sequence`                    | thread 内の順序                          |

## Run

Thread 上で発生する 1 回の実行。

### Run のステートマシン

```text
pending (生成直後) → queued (実行待ち) → running → completed
                       → failed
                       → cancelled
```

`pending` と `queued`
はどちらも実行前の待機状態ですが、意味は同じではありません。 `pending` は run
が作られた直後の生成待ち、`queued` は実行キューに載った待機状態として扱います。
両者は実装上も別ステータスなので、一覧や `RunStatus` を読むときに `pending`
を落とさないでください。

### 主要フィールド

| field                           | 説明                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `id` / `thread_id` / `space_id` | 識別子                                                                |
| `status`                        | 上記の status                                                         |
| `agent_type`                    | 使用する agent type                                                   |
| `model`                         | Run作成時に解決・固定したprovider model。stale recoveryでも変更しない |
| `parent_run_id` / `root_run_id` | 親子関係の追跡                                                        |
| `session_id`                    | 実行セッション ID                                                     |
| `usage`                         | トークン使用量                                                        |

### イベントストリーミング

```bash
# SSE
GET /api/runs/:id/events

# WebSocket
GET /api/runs/:id/ws
```

## Artifact

Run の結果物です。`code` / `config` / `doc` / `patch` / `report` / `other`
のタイプを持ち、 space ストレージ上のファイルにリンクできます。

## Memory / Reminder

- **Memory** — agent の記憶単位。`episode` / `semantic` / `procedural`
  の型を持ちます
- **Reminder** — `time` / `condition` / `context` のトリガー型を持ちます
- **Info unit / Thread context index** — 完了した Run と古い Thread message から作る検索用の派生データ。Run の terminal
  transaction が durable outbox を作り、index queue が後処理します。再生成可能な index であり、Thread message や明示的な
  Memory の正本ではありません

Memory / Reminder の取得と更新は Web UI と public API から行います。
