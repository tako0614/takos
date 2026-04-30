# Routes

トップレベルの compute (Worker または Service) を外部入口に接続する。
HTTP/HTTPS は path で公開し、TCP/UDP は listener port で公開する。queue /
schedule / event は外部 listener ではなく subscription として宣言する。
ドメインはシステムが自動付与するので通常は書かない。

`target` は **compute 名のみ**を受け取る。attached container は単独の route
target には ならない。attached container を外部から呼びたい場合は、親 worker
をターゲットに routes を書き、その worker から container を呼び出す。
route publication は `outputs.*.routeRef` で route の `id` を参照する。
attached container 自体を public route publication の publisher にはしない。

## 基本

```yaml
routes:
  - id: web
    path: /
    target: web
```

## 複数ルート

```yaml
routes:
  - id: api
    path: /api
    target: api
  - id: mcp
    path: /mcp
    target: mcp
  - id: dispatch
    path: /dispatch
    target: executor-host
```

## Protocol routes

```yaml
routes:
  - id: web
    protocol: https
    path: /
    target: web
  - id: ssh
    protocol: tcp
    port: 2222
    target: shell
  - id: dns
    protocol: udp
    port: 5353
    target: resolver
  - id: jobs
    protocol: queue
    source: jobs.incoming
    target: worker
```

## フィールド

| field       | required       | 説明                                                                   |
| ----------- | -------------- | ---------------------------------------------------------------------- |
| `id`        | no             | routeRef 用の stable route ID                                          |
| `target`    | yes            | 対象の compute 名 (Worker または Service)。attached container 名は不可 |
| `protocol`  | no             | `https` default。`http` / `https` / `tcp` / `udp` / `queue` / `schedule` / `event` |
| `path`      | HTTP/HTTPS     | `/` で始まる公開パス。TCP/UDP/event 系では不可                         |
| `port`      | TCP/UDP        | listener port。省略時は `compute.<target>.port` を使う                 |
| `source`    | event 系       | queue / schedule / event source。省略時は route `id`                   |
| `methods`   | HTTP/HTTPS のみ | 許可する HTTP メソッド                                                 |
| `timeoutMs` | no             | ルートのタイムアウト (ms)                                              |

### Method default と競合解決

- `methods` 省略時: 全 HTTP method を受け付ける
- 同じ `path` で method が重なる route: duplicate として invalid
- 同じ `target + path` を複数 route に分ける: invalid。endpoint は 1 つの route
  にまとめ、必要な method を `methods` に列挙する
- 複数 routes が match した場合: URL path segment として安全な longest prefix
  が勝つ
- prefix が同じ場合: manifest 内で先に宣言された route が勝つ

route publication は `outputs.*.routeRef` で `routes[].id` を参照します。
`routeRef` から `publisher` は route の `target` として推論されるため、推奨形
では publication 側に `publisher` を書きません。legacy `publisher + route` も
受け付けますが、同じ target/path に複数 route が一致する manifest は invalid
です。attached container を外に出したい場合も、親 worker / service が route と
publication を持ちます。

## 次のステップ

- [環境変数](/apps/environment) --- 環境変数の詳細
- [Workers](/apps/workers) --- Worker の定義方法
