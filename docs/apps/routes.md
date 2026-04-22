# Routes

トップレベルの compute (Worker または Service)
をどのパスで公開するかを宣言する。
ドメインはシステムが自動付与するので書かない。

`target` は **compute 名のみ**を受け取る。attached container は単独の route
target には ならない。attached container を外部から呼びたい場合は、親 worker
をターゲットに routes を書き、その worker から container を呼び出す。
route publication の `publisher` も route の `target` と同じ親 worker / service
を指定する。attached container 自体を public route publication の publisher には
しない。

## 基本

```yaml
routes:
  - path: /
    target: web
```

## 複数ルート

```yaml
routes:
  - path: /api
    target: api
  - path: /mcp
    target: mcp
  - path: /dispatch
    target: executor-host
```

## フィールド

| field       | required | 説明                                                                   |
| ----------- | -------- | ---------------------------------------------------------------------- |
| `target`    | yes      | 対象の compute 名 (Worker または Service)。attached container 名は不可 |
| `path`      | yes      | 公開パス                                                               |
| `methods`   | no       | 許可する HTTP メソッド                                                 |
| `timeoutMs` | no       | ルートのタイムアウト (ms)                                              |

### Method default と競合解決

- `methods` 省略時: 全 HTTP method を受け付ける
- 同じ `path` で method が重なる route: duplicate として invalid
- 同じ `target + path` を複数 route に分ける: invalid。endpoint は 1 つの route
  にまとめ、必要な method を `methods` に列挙する
- 複数 routes が match した場合: URL path segment として安全な longest prefix
  が勝つ
- prefix が同じ場合: manifest 内で先に宣言された route が勝つ

route publication は `publisher + route` で route を参照します。`publish` には
`methods` が無いため、method 別に同じ endpoint を公開したい場合でも publication
から見える route は 1 件にしてください。同じ `publisher + route` が複数件に一致
する manifest は invalid です。route publication の `publisher` には対応する
route の `target` を書きます。attached container を外に出したい場合も、親
worker / service が route と publication を持ちます。

## 次のステップ

- [環境変数](/apps/environment) --- 環境変数の詳細
- [Workers](/apps/workers) --- Worker の定義方法
