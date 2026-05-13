# Self-host compose plugin smoke plan

> このページでわかること: セルフホスト構成の E2E smoke テスト計画。

`compose.local.yml` の single-node self-host smoke を扱います。operator / plugin proof であり、kernel release 基準ではありません。fast チェックは依存ゼロで Docker を起動せず、下記の manual smoke が host distribution 向けの実 Docker / Compose パスです。

## 静的チェックリスト

`takos` で実行します。

```sh
deno run --no-config --allow-read scripts/self-host-e2e-check.ts
```

`compose.local.yml` が、必要なサービス・local env-file 配線・外部 port マッピング・service URL 環境変数・smoke で安全な依存順序・single-node self-host smoke に必要な named volume を含むかを検証します。

## 手動 Docker plugin smoke

明示的に要求された場合以外は自動実行しないでください。Docker Compose が使えるホストの `takos` ディレクトリで手動実行します。

1. env ファイルを準備し、placeholder の秘密情報や key を必要に応じて差し替えます。

   ```sh
   cp .env.self-host .env.local
   $EDITOR .env.local
   ```

2. compose ファイルに対して静的チェックを再実行します。

   ```sh
   deno run --no-config --allow-read scripts/self-host-e2e-check.ts
   ```

3. コンテナ起動前に Compose で設定をレンダリングします。

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml config
   ```

4. single-node スタックをビルドして起動します。

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml up --build -d
   ```

5. ヘルスとログを監視し、スタックが正常になるまで待ちます。

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml ps

   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml logs -f \
       takos-app takosumi takos-git takos-agent
   ```

6. host にマッピングされた port に対して HTTP ヘルスチェックを実行します。

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     deno run --allow-read --allow-env --allow-net scripts/local-smoke.mjs
   ```

7. 必要に応じてエンドポイントに直接 curl します。

   ```sh
   curl -fsS http://127.0.0.1:8787/health
   curl -fsS http://127.0.0.1:8788/health
   curl -fsS http://127.0.0.1:8789/health
   curl -fsS http://127.0.0.1:8790/health
   curl -fsS http://127.0.0.1:8081/health
   curl -fsS http://127.0.0.1:8082/health
   ```

8. 終わったら停止します。smoke データを削除したい場合のみ `-v` を付けます。

   ```sh
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml down

   # destructive cleanup:
   TAKOS_LOCAL_ENV_FILE=.env.local \
     docker compose --env-file .env.local -f compose.local.yml down -v
   ```

## 想定サービス

- `takos-app`
- `takosumi`
- `takos-git`
- `takos-agent`

サービス境界は、明示的なサービス名と internal URL 環境変数で表現します。
