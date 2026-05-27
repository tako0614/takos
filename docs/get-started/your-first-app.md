# はじめてのアプリ

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: シンプルな Worker アプリを作って Takos
> にデプロイするまでの手順。所要時間 10 分。

## 作るもの

- HTTP で "Hello" を返すシンプルな Worker アプリ
- Takosumi Accounts の OIDC material を受け取る AppSpec wiring を確認する

## 前提

- `takos-cli` がインストール済み ([はじめる](/get-started/) を参照)
- Takosumi Accounts の PAT (Personal Access Token) を設定済み

## 1. プロジェクトを作る

```bash
mkdir my-first-app && cd my-first-app
npm init -y
mkdir -p src
```

## 2. Worker のコードを書く

```typescript
// src/worker.ts
export default {
  async fetch(
    request: Request,
    env: {
      OIDC_ISSUER_URL?: string;
      OIDC_CLIENT_ID?: string;
      OIDC_CLIENT_SECRET?: string;
      OIDC_REDIRECT_URI?: string;
      TAKOS_INSTALLATION_ID?: string;
    },
  ): Promise<Response> {
    return new Response(
      `Hello from Takos! (installation=${env.TAKOS_INSTALLATION_ID ?? "n/a"})`,
      { headers: { "content-type": "text/plain" } },
    );
  },
};
```

AppSpec は `identity.primary.oidc` の listen を宣言します。operator account
plane が OIDC binding material を払い出し、provider / operator projection が
`OIDC_*` runtime env として worker に渡します。この tutorial の worker は public
hello endpoint だけを実装し、OIDC login / callback / launch consume handler は
実装しません。認証付きアプリでは標準的な OIDC client ライブラリで
`OIDC_ISSUER_URL` を使います。

## 3. マニフェストを書く

```yaml
# .takosumi.yml
apiVersion: v1
metadata:
  id: examples.my-first-app
  name: my-first-app
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker.ts
    listen:
      oidc:
        path: identity.primary.oidc
        kind: identity.oidc@v1
        inject: secret-env
        prefix: OIDC
        required: true
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
          host: my-first-app.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

adopted gateway/ingress component は public endpoint を作ります。launcher や health の runtime
path は worker 実装と Takos product metadata で扱います。

## 4. runtime file を確認

この tutorial の `--source .` は local/demo 用で、kernel process から同じ
filesystem path が見える場合だけ使います。AppSpec の `spec.entrypoint` は
resolved source 内に既に存在する runtime file を指します。managed operator に送
る場合は build service / CI が必要な runtime file を含む prepared source archive
を作り、その archive URL と archive payload `source.digest` を Installer API に
渡します。dry-run response の `expected.sourceDigest` は Installer が取得 payload
から計算した resolved digest で、apply 時の TOCTOU guard です。

## 5. Install dry-run と apply

```bash
# インストール内容の dry-run
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json

# デプロイ
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

成功すると Installation が作成され、最初の Deployment が記録されます。

## 認証付きアプリに進む場合

この tutorial のコードは認証 handler を実装していません。認証付きアプリでは:

- **通常ログイン**: app が `/auth/oidc/login` などの route から Takosumi Accounts
  にリダイレクトされ、コールバックでセッションが作られます
- **初回インストール直後**: launch token
  を app の launch consume handler が Accounts `/consume` で redeem します

OIDC の設定 (clientId, clientSecret 等) は AppSpec で
`listen.oidc.path: identity.primary.oidc` を宣言するだけで、 takosumi-cloud
(operator account plane、リファレンス実装: Takosumi Accounts) がインストール時に自動で払い出します。 worker は
secretRef-mediated `OIDC_*` env を読みます。

詳しくは [OIDC consumer](/apps/oidc-consumer) を参照。

## 次のステップ

- [プロジェクト構成](/get-started/project-structure) — `.takosumi.yml` の全体像
- [Worker + Database](/examples/worker-with-db) — DB を追加する
- [Worker + Container](/examples/worker-with-container) — Docker
  コンテナと組み合わせる
- [サンプル集](/examples/) —その他のサンプル
