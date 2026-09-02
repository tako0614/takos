# スキーマ自動適用と縮退モード

Cloudflare provider は D1 migration の実行、Vectorize index、Container application
を表現できません。Takos が所有する bridge はこの gap を埋めますが、既定では動かず、
使い捨て環境向けの mode でしか有効になりません
([セルフホスト](/deploy/) の「Cloudflare provider gap bridge」を参照)。

そのため Takos Worker は次の二つを自分で引き受けます。

1. **D1 schema は Worker が実行時に適用する** — install path が wrangler でも
   OpenTofu / Takosumi BYOC でも self-host でも、同じ schema に収束します。
2. **Vectorize index と agent container が無い配置は、明示された縮退モードとして
   動く** — 壊れた配置ではなく、機能が減った配置として扱います。

## D1 schema の実行時適用

Worker は `db/migrations-control/migrations` の SQL を bundle に埋め込んで持ちます
(`src/worker/platform/migrations/migration-set.generated.json`、
`bun run generate:migration-set` が生成し、`bun run check` が drift を検査します)。

- 最初の request と cron 実行が、未適用の migration を順番に適用します。
- 適用済みの記録は `_takos_opentofu_migrations` に入ります。これは
  OpenTofu bridge が使う table と同じ名前・同じ列・同じ `sha256:<hex>` checksum です。
  bridge が適用済みの database は、そのまま「適用済み」と認識されます。
- 過去の install path の記録も取り込みます。`d1_migrations`
  (`wrangler d1 migrations apply`) と `_takos_self_host_migrations` (self-host node
  platform) に記録がある database は、その分を再適用しません。
- 一つの migration file は 1 回の `batch()` で適用し、記録行を同じ batch の
  最後の statement に置きます。D1 の batch は transaction なので、SQL と記録は
  同時に commit されるか、両方 rollback されます。記録の無い部分適用は起きません。
- 同時に起動した isolate が二重適用しないよう、`_takos_runtime_migration_lock` の
  claim 行を lease 付きで取ります。lease が切れた claim は次の isolate が引き取ります。
- migration の途中で失敗した場合、その migration は記録されず、失敗した file 名と
  理由が claim 行に残ります。ordinary な request traffic は cool-down の間は再試行しません。

### 収束していない間の応答

schema が未適用または失敗している間、request は HTTP 503 を受け取ります。

| 状態 | `error.code` | `Retry-After` |
| --- | --- | --- |
| 適用中 / 未適用 | `SCHEMA_MIGRATION_PENDING` | あり |
| 失敗 | `SCHEMA_MIGRATION_FAILED` | なし |

`error.details` に `state`、`applied`、`total`、失敗時は `failedMigration` と
`reason` が入ります。

次の path だけは 503 の対象外で、収束していなくても応答します。

- `GET /health`
- `GET /internal/runtime/status`
- `POST /internal/runtime/migrate`

### 運用者向けの操作

`/internal/*` は `TAKOS_INTERNAL_API_SECRET` を設定している場合、
`X-Takos-Internal-Secret` header が必須です。

```sh
# 現在の capability と schema の状態を読む
curl -H "X-Takos-Internal-Secret: $SECRET" https://<host>/internal/runtime/status

# 失敗した migration を cool-down を待たずに再試行する
curl -X POST -H "X-Takos-Internal-Secret: $SECRET" https://<host>/internal/runtime/migrate
```

`status` の応答は `{ status, capabilities, schema }` です。`schema.state` は
`ready` / `pending` / `applying` / `failed` のいずれかです。

## 縮退モード

配置に存在する binding から capability を決めます。判定は環境ごとに 1 回だけ行います。

| capability | 値 | 判定 |
| --- | --- | --- |
| `vectorSearch` | `vectorize` | `VECTORIZE` と埋め込み model (`AI` または `OPENAI_API_KEY`) がある |
| | `pgvector` | node platform の pgvector store が binding になっている |
| | `disabled` | index か埋め込み model のどちらかが無い |
| `agentContainers` | `cloudflare-containers` | `EXECUTOR_CONTAINER` がある |
| | `external-host` | `EXECUTOR_HOST` だけがある |
| | `disabled` | どちらも無い |

capability は次で読めます。

- `GET /api/runtime/capabilities` — sign-in 済みの client 向け。`capabilities` のみ。
- `GET /internal/runtime/status` — 運用者向け。capability と schema の両方。

### `vectorSearch: disabled` で失われるもの

- **意味検索そのものが目的の endpoint は拒否します。**
  `POST /api/spaces/:spaceId/index/vectorize` は HTTP 501 と
  `error.code = "CAPABILITY_UNAVAILABLE"` を返します。`error.details` に
  `capability`、不足している binding を示す `reason`、`mode` が入ります。
- **文字列検索に落とせる path は落として応答します。** workspace 検索、thread 検索、
  agent の `info_unit_search` tool は durable な text index を使い続けます。結果は
  減りますが、応答は返ります。
- **agent の会話 memory recall は空になります。** run は動きますが、過去の thread
  から意味的に近い message を引いてくる部分は結果を返しません。
- Web UI は検索の「セマンティック」選択肢を出しません。

### `agentContainers: disabled` で失われるもの

- **agent run を開始できません。** `POST /api/threads/:threadId/runs` は
  HTTP 501 と `CAPABILITY_UNAVAILABLE` を返します。実行できない run を受け付けて
  queue の dead-letter で失敗させる代わりに、入口で断ります。
- Web UI は chat の送信 button を無効にし、理由を表示します。
- 既に queue に入っていた run は、queue の retry 上限に達した時点で
  dead-letter queue 経由で `failed` になります。

### 縮退モードから復帰する

Vectorize index と Container application を配置してから Worker の binding を
更新してください。binding が現れた時点で capability は変わります。schema の再適用は
不要です。bridge を使う場合の制約は [セルフホスト](/deploy/) を参照してください。
