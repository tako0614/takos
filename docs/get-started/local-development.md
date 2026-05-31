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
bun run local:e2e      # E2E スモークテスト
```

## ローカルで起動するサービス

| サービス      | 役割                          |
| ------------- | ----------------------------- |
| `takos-worker` | Web UI / API / queue / scheduled Worker |
| `takos-git`   | Git ホスティング (Smart HTTP) |
| `takos-agent` | エージェント実行              |
| `takosumi`    | デプロイエンジン              |
| `postgres`    | データベース                  |
| `redis`       | キュー / キャッシュ           |

## 個別のプロセスを起動する

compose を使わず個別に起動したい場合は、Takos repo 内の source owner から起動します。

- `src/worker/` / `src/routes/` — Takos Worker (`bun run dev`)
- `web/` — browser UI (`bun run --cwd web dev`)
- `containers/git/` — Git ホスティング (`cd containers/git && bun run dev`)
- `containers/agent/` —エージェント (`cd containers/agent && cargo run`)
- `../takosumi/` —デプロイエンジン

## 注意

ローカル環境は本番環境と完全に同一ではありません。プロバイダー固有の挙動については
[ホスティングガイド](/hosting/) を確認してください。
