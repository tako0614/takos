# yurucommu

yurucommu は self-hosted ActivityPub / community social app。Takos では default
app distribution の一部として扱い、新規 space に preinstall できる通常の group
として deploy する。

## 役割

- `publication.http-endpoint@v1` で social / community UI を提供
- Takos OAuth client consume で sign-in を行う
- ActivityPub federation、posts、media、DM、community 機能を app 側で管理
- sql / object-store / key-value / queue / secret resource を app manifest
  で宣言

## Manifest contract

yurucommu の deploy manifest は `.takos/app.yml` に置く。

```yaml
routes:
  - id: ui
    target: web
    path: /

publications:
  - name: yurucommu-ui
    type: publication.http-endpoint@v1
    display:
      title: Yurucommu
      description: Self-hosted ActivityPub community social
      icon: /icons/yurucommu.svg
      category: social
      sortOrder: 40
    outputs:
      url:
        kind: url
        routeRef: ui
```

`compute.web` は workflow build artifact `dist/takos-worker.js` を使う。Takos
側では通常の group と同じ deploy pipeline で manifest を解決し、必要な resource
bindings と OAuth client env を workload に inject する。

## Consumes

yurucommu は `takos.oauth-client` built-in provider publication を consume
する。 manifest では `clientName: Yurucommu`、callback は
`/api/auth/callback/takos`、scopes は `openid` / `profile` / `email` /
`spaces:read` / `repos:read` を要求する。

同じ worker は自身の `yurucommu-ui` publication も consume し、`outputs.url` を
`APP_URL` に inject する。ActivityPub actor URL、callback URL、self reference
など app が自分の public origin を必要とする処理はこの `APP_URL` を使う。

```yaml
compute:
  web:
    consume:
      - publication: yurucommu-ui
        env:
          url: APP_URL
      - publication: takos.oauth-client
        as: yurucommu-oauth
        request:
          clientName: Yurucommu
          redirectUris:
            - /api/auth/callback/takos
```

## Resources

default app set に含まれても特権 app にはならない。yurucommu は以下を自前の app
resources として持つ。

- `sql`: app database と migrations
- `object-store`: media storage
- `key-value`: app KV
- `queue`: ActivityPub delivery queue と DLQ
- `secret`: generated encryption key

このため、Docs / Excel / Slide より preinstall 時の resource footprint
は大きい。
