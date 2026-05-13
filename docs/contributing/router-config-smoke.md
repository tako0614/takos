# Router config smoke script

> このページでわかること: Router 設定の smoke テスト。

`scripts/router-config-smoke.ts` は router config レンダリングと adapter 永続化のための、外部サービス不要な smoke エントリポイントです。

## 実行

```sh
deno run --config deno.json --allow-read --allow-write scripts/router-config-smoke.ts
```

サンプルの `RouteProjection` を組み立て、`InMemoryRouterConfigAdapter` と `FileRouterConfigAdapter` の両方で apply し、file adapter の出力を一時 JSON ファイルへ書き込みます。adapter 間とファイルの内容一致を検証し、サマリを出力し、終了時に一時ディレクトリを削除します。

## 期待される出力

成功時の出力。

- `Router config smoke passed.`
- projection id
- route count
- memory / file adapter の apply timestamp
- smoke で使用した一時 config パス
