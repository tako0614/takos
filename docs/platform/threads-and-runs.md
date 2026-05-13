# Thread / Run / Artifact

> このページでわかること: AI エージェントとの対話を管理する Thread / Run / Artifact モデル。

## 概要

Thread は対話のコンテキスト、Run は 1 回のエージェント実行、Artifact は実行結果です。
これらは Takos のコア機能であり、チャットとエージェント実行の基本モデルを構成します。

## 実行の仕組み

- **Takos app / agent service** が Thread / Run のライフサイクル、キュー、DB、認証、Space の状態を管理します
- **`takos-agent`** (ランタイムコンテナ) が実際のプロンプト構築、スキル選択、ツール実行を担当します
- agent-control RPC (`/api/internal/v1/agent-control/*`) で両者が連携します

Run の起動には `spaceId` が必須です。AppInstallation 経由の Run では `installationId` と
`runtimeNamespace` が追加され、メモリストアがインストール単位で隔離されます。

managed skill は Takos app / API gateway から渡されたカタログが優先されます。
control payload に managed skill が無い場合だけ、`takos-agent` 内のローカル
フォールバックカタログを使います。custom skill は Takos app 層の永続化データを
ソースとし、同じ skill id / name がある場合は managed skill が先に解決されます。

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

`pending` と `queued` はどちらも実行前の待機状態ですが、意味は同じではありません。
`pending` は run が作られた直後の生成待ち、`queued` は実行キューに載った待機状態として扱います。
両者は実装上も別ステータスなので、一覧や `RunStatus` を読むときに `pending` を落とさないでください。

### 主要フィールド

| field                           | 説明                |
| ------------------------------- | ------------------- |
| `id` / `thread_id` / `space_id` | 識別子              |
| `status`                        | 上記の status       |
| `agent_type`                    | 使用する agent type |
| `parent_run_id` / `root_run_id` | 親子関係の追跡      |
| `session_id`                    | 実行セッション ID   |
| `usage`                         | トークン使用量      |

### イベントストリーミング

```bash
# SSE
GET /api/runs/:id/events

# WebSocket
takos run follow RUN_ID --transport ws
```

## Artifact

Run の結果物です。`code` / `config` / `doc` / `patch` / `report` / `other` のタイプを持ち、
space ストレージ上のファイルにリンクできます。

## Memory / Reminder

- **Memory** — agent の記憶単位。`episode` / `semantic` / `procedural` の型を持ちます
- **Reminder** — `time` / `condition` / `context` のトリガー型を持ちます

```bash
takos context list /spaces/SPACE_ID/memories
```
