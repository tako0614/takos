# Takosumi Kernel In-Process Smoke Script

> このページでわかること: サーバー不要の Takosumi manifest deploy lifecycle smoke テストの実行方法。

`./scripts/paas-smoke.ts` は Takosumi manifest deploy lifecycle を、サーバーや Docker を起動せずに検証する smoke チェックです。

in-process で次を実行します。

- public route handler を小さな local route harness に登録する。
- public handler 経由で space と app group を作成する。
- deploy service を使ってシンプルな manifest を plan / apply する。
- 結果として得られる activation から noop runtime vertical slice を実行する。
- CLI / HTTP smoke の確認に使える JSON サマリを出力する。

実行コマンド。

```sh
deno run --no-config --allow-read --allow-env scripts/paas-smoke.ts
```

default ではサーバー・Docker・外部サービスを起動しません。
