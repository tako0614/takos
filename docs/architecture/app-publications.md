# Publication / Consume Contract

Takos の deploy model は publication と resource API / runtime binding
を分けて扱います。`publish` / `consume` は worker / service / attached
container / Takos built-in provider が参加する情報・capability の交換 protocol
です。

current manifest schema の `publish` は typed outputs を公開する catalog であり、
deploy target や SQL / object-store / queue などの resource 作成そのものでは
ありません。Takos API key / OAuth client は `publish[]` に書く特別な裏口ではなく、
Takos built-in provider が公開する `takos.api-key` / `takos.oauth-client`
publication を `consume[]` する形で扱います。generic plugin resolver でも
ありません。route publication の `type` は custom string として保存され、解釈は
platform / app 側が行います。

## 実体モデル

publication は group 内だけの state ではなく、space-level の catalog entry
です。実装では `publications` record として保存され、`name` は space 内で一意に
扱われます。manifest から作られた publication は `group_id` と
`source_type=manifest` を持ち、route publication では owner service
も記録します。Takos built-in provider publication は DB 上の route publication
ではなく、consume request から grant state を生成します。

consume は group ではなく service に属します。実装では `service_consumes` record
として保存され、service が publication 名を参照します。manifest で管理する
service では `compute.<name>.consume` が deploy 時に `service_consumes`
へ同期されます。個別 service では `/api/services/:id/consumes`
で直接管理できます。

## 原則

- publication は space catalog entry
- route publication は route primitive から作られる projection
- Takos API / OAuth client は built-in provider publication として consume する
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
    outputs:
      url:
        route: /mcp
    spec:
      transport: streamable-http
```

route publication の main output は慣例的に `url` です。値は assigned hostname
と宣言した `outputs.url.route` から生成されます。route が template の場合は
template URL のまま consumer に渡ります。必須 field は `name` / `publisher` /
`type` / `outputs` です。`type` は custom string で、core は type の意味を解釈しません。
`McpServer` / `FileHandler` / `UiSurface` は platform / app が解釈する custom
type です。`spec` は platform / app が解釈する opaque object です。

route publication は `publisher + route` で route を参照します。同じ
`publisher + route` に複数 route がある manifest は invalid です。endpoint は 1
つの route にまとめます。

## Takos built-in provider publication

Takos API key / OAuth client は Takos built-in provider が公開する publication
です。manifest では `compute.<name>.consume[]` の `publication` に
`takos.api-key` / `takos.oauth-client` を指定します。

```yaml
consume:
  - publication: takos.api-key
    as: takos-api
    request:
      scopes:
        - files:read
```

`takos.api-key` の outputs は `endpoint` と `apiKey` です。`request` は provider
ごとの required / optional field を持ち、未知の request field は invalid です。

Takos built-in provider publications:

- `takos.api-key`
- `takos.oauth-client`

SQL / object-store / queue などは resource API / runtime binding の対象であり、
publication type ではありません。

## consume

compute は必要な publication だけを consume します。

```yaml
compute:
  api:
    build: ...
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        env:
          endpoint: INTERNAL_TAKOS_API_URL
          apiKey: INTERNAL_TAKOS_API_KEY
```

alias を省略した場合は default env 名が使われます。SQL / object-store / queue
などの resource access は publication consume ではなく、resource API / runtime
binding 側で扱います。

`consume.env` は output 名から env 名への alias map です。output filter では
ないため、publication の全 outputs が inject 対象になります。将来は互換を保った
まま `inject.env` のように inject 先を明示する shape へ寄せる可能性があります。

manifest の consume は service の desired edge です。deploy 時に service-level
の `service_consumes` record へ同期されます。manifest 外で
`/api/services/:id/consumes` を更新した場合、次の manifest apply では manifest
の内容に置き換わります。

## kernel の責務

kernel / control-plane が publish/consume で行うのは次だけです。

1. publication catalog を保存する
2. Takos built-in provider publication の request を解決する
3. consumer ごとに output contract を env へ変換する

kernel は consumer が要求していない publication を inject しません。
