# Publication / Binding Contract

Takos の deploy model は publication と resource API / runtime binding を
分けて扱います。 `publications[]` と `bindings[]` は component / Takos
built-in provider が参加する情報・capability の交換 protocol です。

current manifest schema の `publications[]` は typed outputs を公開する
catalog であり、 deploy target や SQL / object-store / queue などの
resource 作成そのものではありません。 Takos API key / OAuth client は
`publications[]` に書く特別な裏口ではなく、 Takos built-in provider が
公開する `takos.api-key` / `takos.oauth-client` publication を
`bindings[].from.publication` する形で扱います。 generic plugin resolver
でもありません。 publication の `ref` は publication descriptor (canonical
URI / authoring alias) として保存され、 解釈は descriptor 側 schema と
platform / app が行います。

## 実体モデル

publication は space-level catalog entry ですが、 manifest 由来の
`publications[].name` は group-local です。 実装では `publications` record
として保存され、 同一 group 内で一意に扱われます。 他 group から参照する
場合は `<group>/<name>` を使います。 Takos built-in provider は `takos.*`
namespace です。 manifest から作られた publication は `group_id` と
`source_type=manifest` を持ち、 route-backed publication では owner
component も記録します。 Takos built-in provider publication は DB 上の
publication record ではなく、 `bindings[].from.publication` の request から
grant state を生成します。

binding は component に属する **明示** edge です。 実装では
`service_consumes` record (legacy 名) として保存され、 component が source
(resource / publication / secret / provider-output) を参照します。 manifest
で管理する component では `bindings[]` が deploy 時に `service_consumes` へ
同期されます。 個別 component では `/api/services/:id/consumes` で直接管理
できます。

## 原則

- publication は space catalog entry
- route-backed publication は route primitive から作られる projection
- Takos API / OAuth client は built-in provider publication として binding する
- publication output は named values
- env 注入は explicit binding のみ (Core invariant 4)
- binding は component-level dependency edge
- deploy core は backend-specific な resource semantics を持たない
- backend / adapter 名は `provider-selection` policy gate と operator-only
  configuration に閉じ、 manifest には書かない

## publication

### route-backed publication

route-backed publication は primitive が公開する interface の metadata です。
manifest managed entry で、 control plane API から直接作る対象では
ありません。

```yaml
publications:
  - name: search
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
```

route-backed publication の main output は慣例的に `url` です。 値は
assigned hostname と output `from: { route: <id> }` が参照する route の
`path` から生成されます。 route が template の場合は template URL のまま
consumer に渡ります。 必須 field は `name` / `ref` / `outputs` です。
公開 publication descriptor 一覧は
[Official Descriptor Set v1 § Minimum publication descriptors](/takos-paas/descriptors/official-descriptor-set-v1#minimum-publication-descriptors)
を参照。 `spec` は consumer-facing metadata、 `metadata` は authoring metadata
で、 各 publication descriptor が schema を定義します。

publication output は `from: { route: <id> }` で `routes[].id` を参照します。
同じ route target/path を複数 publication が公開する manifest は invalid
です。 endpoint は 1 つの route にまとめます。

## Takos built-in provider publication

Takos API key / OAuth client は Takos built-in provider が公開する
publication です。 manifest では `bindings[].from.publication` に
`takos.api-key` / `takos.oauth-client` を指定します。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: api
      env:
        TAKOS_API_URL: endpoint
        TAKOS_TOKEN: apiKey
```

`takos.api-key` の outputs は `endpoint` と `apiKey` です。 `request` は
provider ごとの required / optional field を持ち、 未知の request field は
invalid です。

Takos built-in provider publications:

- `takos.api-key`
- `takos.oauth-client`

SQL / object-store / queue などは resource API / runtime binding の対象で
あり、 publication ref ではありません。

## binding

component は必要な publication / resource だけを `bindings[]` で **明示**
binding します。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: api
      env:
        INTERNAL_TAKOS_API_URL: endpoint
        INTERNAL_TAKOS_API_KEY: apiKey
```

明示した output だけが inject 対象です。 default 注入は無く、 全 output を
渡したい場合も明示します。 SQL / object-store / queue などの resource
access は `from: { resource: <name> }` で書きます。

binding の env / runtime binding 詳細は
[Glossary § Binding env injection](/reference/glossary#consume-env-injection)
を参照。

manifest の `bindings[]` は component の desired edge です。 deploy 時に
component-level の `service_consumes` record へ同期されます。 manifest 外で
`/api/services/:id/consumes` を更新した場合、 次の manifest apply では
manifest の内容に置き換わります。

## kernel の責務

kernel / control-plane が publication / binding で行うのは次だけです。

1. publication catalog を保存する
2. Takos built-in provider publication の request を解決する
3. binding ごとに output contract を env / runtime binding handle に変換する

kernel は consumer が要求していない publication を inject しません
(Core invariant 4)。
