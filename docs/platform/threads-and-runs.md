# Thread / Run / Artifact

Agent / Chat は Takos product core の機能です。Thread/Run は Takos app /
agent service が提供する product-level execution model であり、takosumi
kernel の manifest deploy engine には含めません。Thread で対話コンテキストを
管理し、Run で実行します。

> Agent / Chat は Takos product feature です。takosumi kernel は compiled
> Shape manifest の deploy / lifecycle evidence を扱い、chat / agent / memory /
> space の product semantics は持ちません。

実行ループ本体は `takos-agent` runtime container が担う。Takos app / agent
service は
Thread/Run の lifecycle、queue、DB、billing、auth、space state、remote tool
backend を管理し、`takos-agent` は agent-control RPC から run context
を受け取って prompt construction、managed/custom skill selection、local tool
bridge、model runner wiring を実行する。canonical agent-control RPC surface は
Takosumi-owned `/api/internal/v1/agent-control/*`。

`run-bootstrap` の必須 context は `spaceId` である。AppInstallation / shared-cell
経由で作られた run は、`runs.input` に入った `installationId` と
`runtimeNamespace` を bootstrap に含められる。`takos-agent` は Accounts ledger /
RuntimeBinding / billing を所有せず、この context を消費して local memory store
を AppInstallation 単位に隔離する。`installationId` が無い run は space 単位の
従来 namespace を使う。

managed skills は control plane から渡された catalog が優先される。control
payload に managed skill が無い場合だけ、`takos-agent` 内の localized fallback
catalog を使う。custom skills は control plane の永続化データを source とし、
同じ skill id / name がある場合は managed skill が先に解決される。

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

### Run state machine

```text
pending (生成直後) → queued (実行待ち) → running → completed
                       → failed
                       → cancelled
```

`pending` と `queued`
はどちらも実行前の待機状態だが、意味は同一ではない。`pending` は run
が作られた直後の生成待ち状態、`queued`
は実行キューに載った待機状態として扱う。実装では両方を別の status
として扱うため、一覧や `RunStatus` の読み取りでも `pending` を落とさないこと。

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

Run の結果物。`code` / `config` / `doc` / `patch` / `report` / `other` の type
を持ち、space storage 上のファイルにリンクできる。

## Memory / Reminder

- **Memory** -- agent の記憶単位。`episode` / `semantic` / `procedural` の型
- **Reminder** -- `time` / `condition` / `context` の trigger 型

```bash
takos context list /spaces/SPACE_ID/memories
```
