# App Publications

Takos の deploy substrate は top-level `publish` と `compute.<name>.consume`
だけを public contract として扱います。

## 原則

- publication は catalog entry
- publication output は named values
- env 注入は explicit consume のみ
- deploy core は provider-specific な resource semantics を持たない

旧「space 内の全 publication を全 group に自動注入する」モデルは廃止されました。

## 2 種類の publication

### route publication

route publication は app 自身が公開する interface の metadata です。

```yaml
publish:
  - name: browser
    type: McpServer
    path: /mcp
```

route publication の canonical output は `url` です。

### provider publication

provider publication は provider-backed credential/env bundle です。

```yaml
publish:
  - name: shared-db
    provider: takos
    kind: sql
    spec:
      resource: app-db
      permission: write
```

`takos/sql` の canonical outputs は `endpoint` と `apiKey` です。

## consume

compute は必要な publication だけを consume します。

```yaml
compute:
  api:
    build: ...
    consume:
      - publication: shared-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
```

alias を省略した場合は provider の default env 名が使われます。

## kernel の責務

kernel / control-plane が行うのは次だけです。

1. publication catalog を保存する
2. provider publication を解決する
3. consumer ごとに output contract を env へ変換する

kernel は consumer が要求していない publication を inject しません。
