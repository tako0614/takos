# Local Shell Runbook

> このページでわかること: クローンしたばかりの状態から Takos
> のローカルシェルを起動するまでの手順。

## 1. リポジトリを確認

Takos repo 内の canonical layout は `src/worker`、`web`、`containers/agent` です。 clone 後に追加の
submodule 初期化は不要です。

## 2. 環境を診断

```sh
bun run doctor
```

必要なツール、canonical layout の状態、compose のサービスセット、ポート、内部 URL
環境変数などを確認します。

CI やスクリプトから使う場合は strict モードで:

```sh
bun run check
```

## 3. compose 設定を確認

```sh
bun run local:config
```

デフォルトでは `.env.local.example` を読みます。別の env ファイルを使う場合:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:config
```

## 4. 起動と停止

```sh
bun run local:up     # 起動
bun run local:logs   # ログ表示
bun run local:down   # 停止
```

`takos-worker`、`takosumi`、`takos-agent`、Postgres、Redis
が起動します。Git ホスティングは `takos-worker` が worker-native で配信するため、別 service にはなりません。

## 各プロダクトのコマンド

プロダクト固有のチェックは canonical owner から実行します:

```sh
cd . && bun run ...               # Takos Worker / validators
cd web && bun run ...             # Browser UI
cd containers/agent && cargo ...  # Agent execution container
cd ../takosumi && bun run ...     # Takosumi カーネル
```
