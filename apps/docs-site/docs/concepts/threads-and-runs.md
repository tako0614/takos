# Thread / Run / Artifact

Takos の AI 実行面では、`Thread` と `Run` が中心です。

## Thread

Thread は継続する対話や作業コンテキストです。メッセージ列、summary、関連 artifact などが thread に紐づきます。

### Thread の主要フィールド

| field | description |
| --- | --- |
| `id` | thread ID |
| `space_id` | 所属する space |
| `title` | thread タイトル |
| `status` | `active` / `archived` / `deleted` |
| `locale` | `ja` / `en` など |
| `key_points` | thread の要点 |
| `retrieval_index` | 検索・再取得順序のための numeric index |
| `context_window` | コンテキストウィンドウ設定 |

### Message

Thread 内の個々のメッセージは次を持ちます。

| field | description |
| --- | --- |
| `role` | `user` / `assistant` / `system` / `tool` |
| `content` | メッセージ本文 |
| `tool_calls` | assistant が呼び出した tool call payload |
| `tool_call_id` | tool role のメッセージが応答する tool call ID |
| `sequence` | thread 内の順序 |
| `metadata` | 追加メタデータの payload |

## Run

Run は thread 上で発生する 1 回の実行です。

### Run status

Run は次の状態遷移を持ちます。

```text
pending -> queued -> running -> completed
                            \-> failed
                            \-> cancelled
```

| status | 説明 |
| --- | --- |
| `pending` | 作成直後。queue 投入待ち |
| `queued` | RUN_QUEUE に投入済み。実行待ち |
| `running` | 実行中。heartbeat で監視される |
| `completed` | 正常完了 |
| `failed` | エラーで終了 |
| `cancelled` | ユーザーまたはシステムによるキャンセル |

### Run の主要フィールド

| field | description |
| --- | --- |
| `id` | run ID |
| `thread_id` | 所属する thread |
| `space_id` | 所属する space |
| `status` | 上記の status 値 |
| `agent_type` | 使用する agent type |
| `parent_run_id` | 親 run (入れ子実行の場合) |
| `root_run_id` | root run ID |
| `root_thread_id` | root thread ID |
| `child_thread_id` | 子 thread (sub-thread を作成した場合) |
| `session_id` | 実行セッション ID |
| `error` | 失敗時のエラー情報 |
| `usage` | トークン使用量など |
| `started_at` / `completed_at` | 実行時刻 |

### Run の階層構造

Run は親子関係を持てます。

- `parent_run_id` — 親 run を指す。入れ子の agent 実行を表現する
- `root_run_id` — 最上位の run を指す。深い入れ子でも root を追跡できる
- `child_thread_id` — sub-thread を作成した場合、その thread を指す

### イベントストリーミング

Run の進行はリアルタイムで購読できます。

- **SSE**: `GET /api/runs/:id/sse` — Server-Sent Events で run イベントを購読
- **WebSocket**: `follow` verb で WebSocket 購読（CLI: `takos run follow RUN_ID --transport ws`）

通知全般は `GET /api/notifications/sse` で購読できます。

## Agent Task

Agent Task は agent が計画・実行するタスク単位です。Thread / Run と紐づきます。

| field | description |
| --- | --- |
| `status` | `planned` / `in_progress` / `blocked` / `completed` / `cancelled` |
| `priority` | タスクの優先度 |
| `plan` | タスクの実行計画 |
| `thread_id` | 紐づく thread (任意) |
| `last_run_id` | 最後に関連づいた run の base field |
| `latest_run` | list/detail API が付与する最新 run summary |
| `resume_target` | 再開時に使う thread/run の focus |

## Artifact

Artifact は run の結果物です。

| field | description |
| --- | --- |
| `id` | artifact ID |
| `run_id` | 生成元の run |
| `space_id` | 所属する space |
| `type` | `code` / `config` / `doc` / `patch` / `report` / `other` |
| `file_id` | space storage 上のファイルへのリンク (任意) |
| `metadata` | 追加メタデータ |

## Memory / Reminder

Thread / Run と並んで、Takos の AI 実行面には Memory と Reminder があります。

- **Memory** — agent の記憶単位。`episode` / `semantic` / `procedural` の型を持ち、importance scoring と semantic search の対象になる
- **Reminder** — `time` / `condition` / `context` の trigger 型を持つ。priority 付きで agent に通知される

CLI では `takos context list /spaces/SPACE_ID/memories` で一覧できます。

## 何が独自か

Takos は repo deploy と app runtime だけでなく、AI 実行の履歴も platform に含めます。
そのため、Thread / Run / Artifact のモデルは app deploy や worker model と並ぶ重要な surface です。
