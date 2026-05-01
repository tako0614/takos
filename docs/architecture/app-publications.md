# Publication / Consume Contract

Takos の deploy model は publication と resource API / runtime binding
を分けて扱います。`publications` / `consume` は worker / service / attached
container / Takos built-in provider が参加する情報・capability の交換 protocol
です。

current manifest schema の `publications` は typed outputs を公開する catalog
であり、 deploy target や SQL / object-store / queue などの resource
作成そのものでは ありません。Takos API key / OAuth client は `publications[]`
に書く特別な裏口ではなく、 Takos built-in provider が公開する `takos.api-key` /
`takos.oauth-client` publication を `consume[]` する形で扱います。generic plugin
resolver でも ありません。route publication の `type` は custom string
として保存され、解釈は platform / app 側が行います。

## 実体モデル

publication は space-level catalog entry ですが、manifest 由来の
`publications[].name` は group-local です。実装では `publications` record
として保存され、同一 group 内で 一意に扱われます。他 group から参照する場合は
`<group>/<name>` を使います。 Takos built-in provider は `takos.*` namespace
です。manifest から作られた publication は `group_id` と `source_type=manifest`
を持ち、route publication では owner service も記録します。Takos built-in
provider publication は DB 上の route publication ではなく、consume request から
grant state を生成します。

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
publications:
  - name: search
    type: publication.mcp-server@v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
```

route publication の main output は慣例的に `url` です。値は assigned hostname
と `outputs.url.routeRef` が参照する route の `path` から生成されます。route が
template の場合は template URL のまま consumer に渡ります。必須 field は `name`
/ `type` / `outputs` です。Takos 標準 type は
[Glossary - Publication types](/reference/glossary#publication-types) を参照。
`spec` は consumer-facing metadata、`auth` は platform-managed behavior です。

route publication は `routeRef` で `routes[].id` を参照します。同じ route
target/path を複数 publication が 公開する manifest は invalid です。endpoint は
1 つの route にまとめます。

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
        inject:
          env:
            endpoint: INTERNAL_TAKOS_API_URL
            apiKey: INTERNAL_TAKOS_API_KEY
```

明示した output だけが inject 対象です。default env 名を使って全 output
を注入したい 場合は `inject.defaults: true` を書きます。SQL / object-store /
queue などの resource access は publication consume ではなく、resource API /
runtime binding 側で扱います。

`inject.env` の詳細は
[Glossary - Consume env injection](/reference/glossary#consume-env-injection)
を参照。

manifest の consume は service の desired edge です。deploy 時に service-level
の `service_consumes` record へ同期されます。manifest 外で
`/api/services/:id/consumes` を更新した場合、次の manifest apply では manifest
の内容に置き換わります。

## kernel の責務

kernel / control-plane が publications/consume で行うのは次だけです。

1. publication catalog を保存する
2. Takos built-in provider publication の request を解決する
3. consumer ごとに output contract を env へ変換する

kernel は consumer が要求していない publication を inject しません。
