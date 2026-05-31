# プロジェクト構成

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: Takosumi installer が読む `.takosumi.yml` と、アプリ
> source root の基本構成。

## ディレクトリ構成

Takos に install するアプリは、source root に `.takosumi.yml` を 1 つ置きます。

```text
my-app/
├── .takosumi.yml
├── package.json
├── src/
│   └── index.ts
└── ...
```

`.takosumi.yml` は Takosumi の AppSpec です。アプリの display metadata、runtime
component、kind-specific `spec`、same-AppSpec `connect`、manifest 外の platform
service を受け取る `listen` を同じファイルで宣言します。Installation output として
記録する publication が必要な場合だけ root `publish` を追加します。build command
は build service / CI の convention に置きます。

## `.takosumi.yml`

```yaml
apiVersion: v1
metadata:
  id: examples.my-app
  name: My App
  description: Example worker app
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
    spec:
      class: small
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: my-app.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

public app endpoint は adopted gateway/ingress component の gateway descriptor intent、launcher / MCP
metadata と capability request は Takos product 内部 metadata layer (= AppSpec
contract とは別) で表現します。

主な field:

| field                  | 役割                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `metadata`             | App ID、表示名、publisher、homepage など                                                     |
| `components`           | runtime / resource / ingress intent の map                                                   |
| `components.*.kind`    | component の contract (operator alias / URI で解決)                                          |
| `components.*.spec`    | kind ごとの open spec (= worker なら `entrypoint`、 gateway なら listener / gateway descriptor intent 等) |
| `components.*.connect` | same-AppSpec `component.output` への binding declaration                                      |
| `components.*.listen`  | platform service path または `kind`/labels discovery への binding declaration                 |

## Install lifecycle

開発者は source root をそのまま dry-run / apply します。

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

Git URL install では operator account plane (リファレンス実装: Takosumi Accounts) が repository を commit に pin し、
`.takosumi.yml` を読みます。

```bash
takosumi install dry-run \
  git:https://github.com/example/my-app#v1.0.0 \
  --space "$TAKOSUMI_SPACE_ID"
```

Takosumi installer は AppSpec から resource dependency と kind-owned gateway
`spec` を記録し、selected ingress binding に渡せる Installation と Deployment
record を残します。OIDC client は OIDC listen binding に対して operator account
plane が払い出し、runtime env は provider / operator projection が materialize
します。build
service / CI を使う場合は prepared source archive を Installer API に渡します。

## 制約

- `.takosumi.yml` は source root に置く
- `apiVersion: v1` は必須 (= AppSpec root の discriminator)
- workflow / CI DSL は AppSpec に入れない
- component 間の依存は AppSpec `connect` で宣言し、manifest 外の platform service
  は `listen.path` または `listen.kind` で受け取る
- retained implementation/operator evidence や provider resource ID
  はユーザーが手書きしない

## 次のステップ

- [はじめてのアプリ](/get-started/your-first-app) —実際にアプリを作って install
  する
- [Takos AppSpec 例](/deploy/manifest) — Takos 向けの短い例。canonical
  field/schema は
  [Takosumi AppSpec](https://takosumi.com/docs/reference/manifest)
- [サンプル集](/examples/) —コピペで始められるサンプル
