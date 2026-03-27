# ローカル開発ガイド

Takos をローカル環境で起動し、開発・テストを行うための手順をまとめます。

## 前提条件

以下のツールが必要です。

| ツール | バージョン |
| --- | --- |
| Node.js | 20 以上 |
| pnpm | 9 以上 |
| Docker | 最新安定版 |
| Docker Compose | V2 (docker compose) |

## セットアップ手順

リポジトリをクローンし、依存関係をインストールします。

```bash
git clone <repo>
cd takos
pnpm install
cp .env.local.example .env.local  # 環境変数設定
```

`.env.local` にはデータベース接続情報や外部 API キーなどを記述します。`.env.local.example` のコメントを参照してください。

## ローカル起動

Docker Compose を使い、必要な全サービスをまとめて起動できます。

```bash
pnpm local:up     # Docker Compose で全サービス起動
pnpm local:down   # 停止
pnpm local:logs   # ログ確認
pnpm local:smoke  # スモークテスト
```

`pnpm local:up` の初回実行時はイメージのビルドとダウンロードに数分かかります。
`pnpm local:smoke` は起動後の疎通確認に使います。全サービスが healthy になってから実行してください。

## サービス一覧

`compose.local.yml` で定義されるサービスの一覧です。

### インフラサービス

| サービス | 説明 |
| --- | --- |
| postgres | D1 互換のローカルデータベース |
| redis | キャッシュ・キュー用 |
| minio | R2 互換のオブジェクトストレージ |

### Control Plane サービス

| サービス | 説明 |
| --- | --- |
| control-web | メイン Web ワーカー。API リクエストを受け付ける |
| control-dispatch | テナントへのリクエストディスパッチャー |
| control-worker | バックグラウンドジョブを処理するワーカー |

### Tenant Runtime サービス

| サービス | 説明 |
| --- | --- |
| browser-host | ブラウザコンテナのホストプロセス |
| executor-host | 実行コンテナのホストプロセス |
| runtime | テナントワーカーのランタイム |
| executor | コード実行サービス |
| browser | ブラウザ自動操作サービス |

## ローカルで動かないもの

local backend は Cloudflare と完全には一致しません。以下の機能はローカル環境では利用できないか、制限があります。

| 機能 | ステータス | 備考 |
| --- | --- | --- |
| vectorize binding | ❌ tenant binding 未対応 | tenant worker の Vectorize binding は local runtime で materialize しない |
| durableObject binding | ✅ tenant binding 対応 | tenant worker が export する Durable Object class を local runtime でも namespace binding として materialize する |
| analyticsEngine binding | ❌ tenant binding 未対応 | tenant worker の Analytics Engine binding は local runtime で materialize しない |
| workflow binding / invocation | ❌ tenant invocation 未対応 | workflow resource 自体は manifest で管理できるが、binding の materialization と export invocation は Takos-managed runner 前提 |
| queue bindings | ⚠️ binding は対応 | tenant worker への queue producer binding は local runtime で materialize するが、delivery/orchestration の再現は backend 依存 |
| R2 multipart | ✅ 対応 | in-memory / dataDir-backed local adapter の両方で Takos の multipart contract を再現する |

詳細は [互換性と制限](../architecture/compatibility-and-limitations.md) を参照してください。

## テスト実行

ユニットテストと型チェックは以下で実行します。

```bash
pnpm test:all       # 全テスト実行
pnpm typecheck:all  # 全パッケージの型チェック
```

ローカルサービスが起動している状態で `pnpm local:smoke` を実行すると、E2E レベルのスモークテストが走ります。CI でも同様のチェックが行われるため、PR 前にローカルで確認しておくと安心です。
