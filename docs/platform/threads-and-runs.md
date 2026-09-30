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
- **`takos-agent`** (ランタイムコンテナ) は正本 (正とする情報) の会話履歴を受け取り、
  回数に上限のある model / tool の loop を実行します
- 両者は agent-control RPC (`/api/internal/v1/agent-control/*`) で連携します

Thread message、summary、memory、skill / tool catalog の正本は Takos Worker です。
engine checkpoint (中断した Run を再開するための途中状態) も Run に紐づけて保存します。checkpoint の書き込みは
lease (実行の担当権) の版で制限するので、restart や別の pool slot へ移っても、何度実行しても結果が同じ node から
再開できます。ただし checkpoint は会話や memory の第二の正本ではありません。

model への request の中断点は、provider に依存しない「ちょうど一度」の保証ができないため、自動で再発行せず
安全側に停止します。副作用の結果が不明な場合は、tool operation ledger (副作用の実行記録) を正本として
Run を再開不可の状態に戻し、新しい lease は model / tool を再実行しません。
`tool_calls` / `tool_call_id` は構造化した実行記録の中で、provider、tool 実行、event まで同じ ID を保ちます。

Run の起動には current API では Workspace を指す legacy field `spaceId` が必須です。Capsule/app 経由の Run では
移行互換の Capsule/app context と `runtimeNamespace` が通信上の metadata として追加される場合があります。これらは
container の disk や別の memory の管理元を選ぶためには使いません。

managed / custom skill と installed Capsule / external MCP の tool catalog も Takos Worker が正本です。
container image 内の snapshot は、model から見える catalog や実行の権限ではありません。

## Thread

継続する対話や作業コンテキストです。メッセージ列、summary、artifact が紐づきます。

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

Thread 上で発生する 1 回の実行です。

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
- **Info unit / Thread context index** — 完了した Run と古い Thread message から作る検索用の派生データです。
  Run の終了 transaction が永続化する outbox (配送待ちの記録) を作り、index queue が後処理します。
  再生成できる index であり、Thread message や明示的な Memory の正本ではありません

Memory / Reminder の取得と更新は Web UI と public API から行います。
