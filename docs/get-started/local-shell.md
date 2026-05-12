# Local Shell Runbook

> このページでわかること: クローンしたばかりの状態から Takos のローカルシェルを起動するまでの手順。

## 1. サブモジュールを初期化

```sh
git submodule update --init --recursive
```

または:

```sh
deno task submodules:update
```

## 2. 環境を診断

```sh
deno task doctor
```

必要なツール、サブモジュールの状態、compose のサービスセット、ポート、
内部 URL 環境変数などを確認します。

CI やスクリプトから使う場合は strict モードで:

```sh
deno task check
```

## 3. compose 設定を確認

```sh
deno task local:config
```

デフォルトでは `.env.local.example` を読みます。別の env ファイルを使う場合:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:config
```

## 4. 起動と停止

```sh
deno task local:up     # 起動
deno task local:logs   # ログ表示
deno task local:down   # 停止
```

`takos-app`、`takosumi`、`takos-git`、`takos-agent`、Postgres、Redis が起動します。

## 各プロダクトのコマンド

プロダクト固有のチェックは各リポジトリから実行します:

```sh
cd app && deno task ...           # Takos アプリ
cd ../takosumi && deno task ...   # Takosumi カーネル
cd git && deno task ...           # Git ホスティング
cd agent && cargo ...             # エージェント (Rust)
```
