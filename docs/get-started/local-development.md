# ローカル開発ガイド

> このページでわかること: Takos
> のローカル開発環境をセットアップして起動する方法。

Docker Compose を使って、Takos の全サービスをローカルで動かします。

## 必要なもの

- Linux（必須native回帰試験は `/proc` で実workerdの実行ファイルを確認するため、現在Linux hostで検証）
- Bun 1.3.14（repo gate / Worker build）
- Node.js 26.1.0（native D1 回帰試験の Miniflare host、CI と同じ固定版）
- Docker (current stable)
- Docker Compose V2

## セットアップ

```bash
cd takos
bun run check
cp .env.local.example .env.local
```

## 起動・停止

```bash
# 起動
docker compose --env-file .env.local -f compose.local.yml up --build

# ログを見る
docker compose --env-file .env.local -f compose.local.yml logs -f

# 停止
docker compose --env-file .env.local -f compose.local.yml down
```

バックグラウンドで起動したい場合は `-d` を付けます:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## 動作確認

```bash
bun run check          # format / lint / types / tests / Rust / build の全gate
bun run local:config   # compose 設定のレンダリング確認
bun run local:e2e      # public API -> queue -> agent container の実 Run E2E
bun run validate:agent-local-proof # component + 上記の実 Run 証跡
```

`local:e2e` は通常の `compose.local.yml` に検証専用 override を重ね、ローカル OIDC issuer、決定的な
OpenAI-compatible stub、executor bridge を一時的に起動します。外部 API key は不要です。公開 API から
Workspace / Thread / user message / Run を作成し、Run が `completed` になるまで status、output、event、assistant message を
poll します。health check だけでは成功になりません。

Docker daemon を使えない場合、`validate:agent-local-proof` は live proof を成功扱いにせず、JSON の
`local-compose-public-api-run` を `unavailable` として理由を表示します。Docker を使わない component 確認だけを明示的に
行う場合は `bun run validate:agent-local-proof:components` を使えますが、出力の `complete` は `false` であり実 Run 証跡には
なりません。

### Native D1 の回帰試験

`bun run check` の portable tests は、installed Miniflare/workerd を別の Node process
で実行する必須試験を含みます。単独で実行する場合:

```bash
bun test scripts/prove-run-usage-native.test.ts
```

Worker の bundle は実行中の Bun で作成し、compatibility date / flags は
`deploy/cloudflare/wrangler.toml` を読みます。空の native D1 に production の全embedded
migrationを既定budgetで適用し、ledger / checksum、終端Runとusage witnessの同時rollback、
同一completionの重複防止、usage batchのrollbackとnative DO置換後のcold retryを検証します。
configured owner / OIDC / private Workspaceのauthorityが不変であることも確認します。
schemaは最大2回の明示したadmission requestで確認します。初回がpendingなら、ledgerが
正しいprefixでclaimを解放したことを確認し、返された5秒のretry hintを待って1回だけ継続します。
初回の状態と継続前後のledgerを記録し、全migrationがreadyになってからcached再入場を確認します。
native runtimeが無い場合、failed / applying、進捗なし、2回目もpendingなら失敗し、
skipやstorage置換はしません。各migration budgetと内外の試験期限は変えません。

各試験の状態は `tmp/native-run-usage-proof/` の新規directoryに隔離します。内側70秒、
process / stdout / stderr全体75秒の期限を設け、所有するprocess groupを終了確認します。
成功時は実runtime identityとsource / bundle / input hashesをlogへ出し、fixtureを削除します。
失敗時は同directoryに診断を保持し、pathを表示します。

CIでは全文を `nativeUsageProofReportChunk` の4096文字ごとのJSON recordsで出力し、
1行64KiBの切り詰めを避けます。読み戻す側は同じSHA256のrecordsを集め、重複・欠落がなく
indexが0からchunks-1まで揃うことを確認してdataを順番に結合し、全文SHA256を照合します。
完全なJSONへ復元できてから、runtime / source / bundle / input hashesを証拠として扱います。

これはlocal native D1 / DO / R2の証拠です。hosted backendのalarm / quota / concurrency、
native backendとcompiled process / Containerの結合、実owner導入や全instance
backup / restoreは別に検証します。

## ローカルで起動するサービス

| サービス       | 役割                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `takos-worker` | Web UI / API / queue / scheduled Worker / Git ホスティング (worker-native Smart HTTP) |
| `takos-agent`  | エージェント実行                                                                      |
| `takosumi`     | デプロイエンジン                                                                      |
| `postgres`     | データベース                                                                          |
| `redis`        | キュー / キャッシュ                                                                   |

Takos product の public/control Worker は `takos-worker` 1 つです。local / self-host
stack で container callback helper endpoint が見える場合も、これは container
接続用の実装 detail であり、追加の Takos product Worker 境界ではありません。
`local:e2e` の `agent-proof-runtime` も検証時だけ使う harness で、通常の local stack や product service には含めません。

## 個別のプロセスを起動する

Docker Compose を使わず個別に起動したい場合は、Takos repo 内の source owner から起動します。

- `src/worker/` / `src/worker/server/routes/` — Takos Worker、worker-native Git Smart HTTP を含む (`bun run dev`)
- `web/` — browser UI (`bun run dev:web`)
- `containers/agent/` —エージェント (`cd containers/agent && cargo run`)
- `../takosumi/` —デプロイエンジン

## 注意

ローカル環境は本番環境と完全に同一ではありません。プロバイダー固有の挙動については
[デプロイ / セルフホスト](/deploy/) を確認してください。
