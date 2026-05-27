# Deployment History

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: Installation に紐づく Deployment 履歴と rollback
> の単位。

Takosumi v1 の public concept は AppSpec / Installation / Deployment の 3
つです。複数 component の apply 結果は、Installation に紐づく 1 つの Deployment
として履歴化されます。

## Installation との関係

| 階層         | 表すもの                                                                            | 所有者                      |
| ------------ | ----------------------------------------------------------------------------------- | --------------------------- |
| AppSpec      | source root の `.takosumi.yml`                                                      | app author                  |
| Installation | Space に install された app 1 件の core record                                      | Takosumi installer / kernel |
| Deployment   | 1 回の apply 結果                                                                   | Takosumi installer / kernel |
| Component    | AppSpec 内の runtime / resource / ingress intent。implementation は operator が選ぶ | AppSpec entry               |

Core Installation は current Deployment pointer と core status を持ちます。
ownership、billing、authorization、launch token は operator account-plane projection
が持 ちます。Deployment は resolved source identity、manifest
digest、public/non-secret outputs、apply status、audit / operation evidence
への参照を持ちます。

## 何が履歴化されるか

- resolved source identity / manifest digest
- created / updated / deleted component
- prepared archive payload digest (`source.digest` / `expected.sourceDigest`)
- resolved publication / platform service snapshot
- provider resource ID と output
- apply status と observation
- rollback audit / pointer movement の対象になった Deployment ID

## AppSpec との対応

```yaml
apiVersion: v1
metadata:
  id: example.full-stack
  name: Full Stack
components:
  api:
    kind: worker
    spec:
      entrypoint: src/api.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  jobs:
    kind: worker
    spec:
      entrypoint: src/jobs.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
  public:
    kind: gateway
    connect:
      upstream:
        output: api.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: api.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

この AppSpec を apply すると、`api` / `jobs` / `db` の materialization が同じ
Deployment record に保存されます。

## Rollback

rollback は過去 Deployment を改竄せず、その retained succeeded Deployment を
`currentDeploymentId` と public/non-secret outputs の authority として再選択する
操作です。必要な runtime routing は retained activation evidence から再有効化しま
す。新しい Deployment record は作らず、append-only rollback event / operation metadata として
記録します。

```bash
takosumi rollback "$INSTALLATION_ID" --to "$DEPLOYMENT_ID"
```

## 関連ページ

- [Git / Store install](/deploy/store-deploy)
- [ロールバック](/deploy/rollback)
- [Takosumi installer API](https://takosumi.com/docs/reference/installer-api)
