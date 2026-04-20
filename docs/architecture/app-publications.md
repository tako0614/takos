# Publication / Grants

Takos の deploy model は publication と resource API / runtime binding
を分けて扱います。current manifest schema の `publish` は route/interface
metadata と Takos capability output を共有する information catalog
であり、deploy target や SQL / object-store / queue などの resource
作成そのものではありません。generic plugin resolver でもありません。route
publication の `type` は custom string として保存され、解釈は platform / app
側が行います。

## 実体モデル

publication は group 内だけの state ではなく、space-level の catalog entry
です。実装では `publications` record として保存され、`name` は space 内で一意に
扱われます。manifest から作られた publication は `group_id` と
`source_type=manifest` を持ち、route publication では owner service
も記録します。API から作られる Takos capability grant は `source_type=api`
で存在できます。

consume は group ではなく service に属します。実装では `service_consumes` record
として保存され、service が publication 名を参照します。manifest で管理する
service では `compute.<name>.consume` が deploy 時に `service_consumes`
へ同期されます。個別 service では `/api/services/:id/consumes`
で直接管理できます。

## 原則

- publication は space catalog entry
- route publication は route primitive から作られる projection
- capability grant は Takos API / OAuth client など resource 以外の capability
- publication output は named values
- env 注入は explicit consume のみ
- consume は service-level dependency edge
- deploy core は backend-specific な resource semantics を持たない
- backend / adapter 名は operator-only configuration に閉じ、manifest
  には書かない

## publication

### route publication

route publication は primitive が公開する interface の metadata です。manifest
managed entry で、control plane API から直接作る対象ではありません。

```yaml
publish:
  - name: search
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
```

route publication の canonical output は `url` です。値は assigned hostname
と宣言した `path` から生成されます。path が template の場合は template URL の
まま consumer に渡ります。必須 field は `name` / `publisher` / `type` / `path`
です。`type` は custom string で、core は type の意味を解釈しません。
`McpServer` / `FileHandler` / `UiSurface` は platform / app が解釈する custom
type です。`spec` は platform / app が解釈する opaque object です。

route publication は `publisher + path` で route を参照します。同じ
`publisher + path` に複数 route がある manifest は invalid です。endpoint は 1
つの route にまとめます。

## Takos capability grant

Takos capability grant は Takos API key / OAuth client の access output
declaration です。manifest では `publish[].publisher/type` として保存されます。
API では `/api/publications/:name` から grant として作成できます。

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
```

`api-key` の outputs は `endpoint` と `apiKey` です。必須 field は `name`、
`publisher`、`type`、`spec` です。`publisher` は `takos`、`type` は Takos
publisher type だけを受け付け、未知の type は invalid です。`spec` は type
ごとの required / optional field を持ちます。

Takos publisher types:

- `api-key`
- `oauth-client`

SQL / object-store / queue などは resource API / runtime binding の対象であり、
publication type ではありません。

## consume

compute は必要な publication だけを consume します。

```yaml
compute:
  api:
    build: ...
    consume:
      - publication: takos-api
        env:
          endpoint: INTERNAL_TAKOS_API_URL
          apiKey: INTERNAL_TAKOS_API_KEY
```

alias を省略した場合は default env 名が使われます。SQL / object-store / queue
などの resource access は publication consume ではなく、resource API / runtime
binding 側で扱います。

manifest の consume は service の desired edge です。deploy 時に service-level
の `service_consumes` record へ同期されます。manifest 外で
`/api/services/:id/consumes` を更新した場合、次の manifest apply では manifest
の内容に置き換わります。

## kernel の責務

kernel / control-plane が publish/consume で行うのは次だけです。

1. publication catalog を保存する
2. Takos capability grant を解決する
3. consumer ごとに output contract を env へ変換する

kernel は consumer が要求していない publication を inject しません。
