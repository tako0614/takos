# ローカル開発ガイド

> このページでわかること: Takos
> のローカル開発環境をセットアップして起動する方法。

Docker Compose を使って、Takos の全サービスをローカルで動かします。

## 必要なもの

- Bun 1.x
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
bun run check          # ツールと canonical layout の診断
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

compose を使わず個別に起動したい場合は、Takos repo 内の source owner から起動します。

- `src/worker/` / `src/worker/server/routes/` — Takos Worker、worker-native Git Smart HTTP を含む (`bun run dev`)
- `web/` — browser UI (`bun run --cwd web dev`)
- `containers/agent/` —エージェント (`cd containers/agent && cargo run`)
- `../takosumi/` —デプロイエンジン

## 注意

ローカル環境は本番環境と完全に同一ではありません。プロバイダー固有の挙動については
[デプロイ / セルフホスト](/deploy/) を確認してください。
