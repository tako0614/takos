# Deploy System

Revision: 2026-03-28 current
Status: current public contract with implementation note

Takos の current deploy system は、**repo/ref から app deployment を作る** 方式です。
旧 docs の build/publish/promote 三段階モデルは現行 surface ではありません。

## このページで依存してよい範囲

- repo/ref + `.takos/app.yml` + workflow artifact という deploy contract
- `takos deploy` と `/api/spaces/:spaceId/app-deployments` family
- validation / rollout / rollback の意味

## このページで依存してはいけない範囲

- `POST /api/services/:id/deployments` などの lower-level deploy route を primary contract とみなすこと
- bundle 単体 deploy を repo-local app deploy の説明に持ち込むこと
- `build` / `publish` / `promote` の旧 CLI を現行モデルとして読むこと

## implementation note

2026-03-28 時点では、public contract としての `app-deployments` family は docs / CLI / route registration に存在しますが、app deployment の主要 service メソッドはまだ end-to-end で接続されていません。

利用者にとって重要なのは次の区別です。

- repo-local app deploy の **採用面** は `app deployment`
- 今日の実装で完全に置き換わっていない **内部 fallback** は worker/service 単位の lower-level deployment

つまり、Takos が将来どの面を正本にしたいかはこのページに従い、今日の実装差分は compatibility gap として読む必要があります。
lower-level route を public contract に昇格させるわけではありません。

## deploy が入力に取るもの

app deploy は次を入力に取ります。

- target space
- repo ID
- ref (`branch`, `tag`, `commit`)
- repo 内の `.takos/app.yml`
- manifest が参照する workflow artifact

## deploy の考え方

Takos における deploy の最小単位は、worker bundle 単体ではありません。
app deployment は、manifest と artifact provenance を束ねた app-level mutation です。

そのため deploy の結果には、少なくとも次が含まれます。

- app metadata
- service / route / hostname
- resource inventory
- OAuth / MCP / file handler の reconcile
- app deployment record

## validation

deploy 前に少なくとも次を検証します。

- `.takos/app.yml` が `kind: App` であること
- `build.fromWorkflow.path` が `.takos/workflows/` 配下であること
- service / resource / route 参照が整合していること
- OAuth auto env や source provenance 変更に approval が必要な場合は caller が承認していること

`takos deploy validate` は local manifest validation の入口です。

## public API / CLI

### CLI

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

### API

```text
POST   /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
GET    /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout
POST   /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/{pause|resume|abort|promote}
DELETE /api/spaces/:spaceId/app-deployments/:appDeploymentId
```

## deploy flow

```text
repo/ref
  -> validate .takos/app.yml
  -> resolve workflow artifact
  -> create or update app identity
  -> reconcile resources
  -> reconcile services / routes / hostnames
  -> reconcile OAuth / MCP / file handlers
  -> create app deployment record
  -> start rollout if needed
```

## rollout

rollout state は app deployment ごとに管理されます。
current public controls は次です。

- get rollout state
- pause
- resume
- abort
- promote

rollout は「段階的に公開する操作」であり、deploy そのものとは別の制御面です。
CLI では deploy/status/rollback が中心で、細かい rollout control は API 側を正本とします。

## rollback

rollback は「前の app deployment へ戻す」操作です。
次の意味は current contract に含めません。

- resource の即時削除
- schema/data の自動巻き戻し
- deploy 以前の全副作用の完全復元

## provider 差分

Takos は Cloudflare を primary surface としつつ、local-platform / Helm / OCI orchestrator 側へ同じ app deploy contract を投影します。
provider ごとの差分は [Platform Compatibility Matrix](/operations/platform-matrix) と [互換性と制限](/architecture/compatibility-and-limitations) を参照してください。

## non-goals / historical model

current public contract に **含まれない** もの:

- `takos build`
- `takos publish`
- `takos promote`
- top-level `takos rollback`
- multi-document package bundle spec
- worker/service/provider 単位の lower-level deploy route を public 正本にする説明

## 次に読むページ

- [`.takos/app.yml`](/specs/app-manifest)
- [CLI / Auth model](/specs/cli-and-auth)
- [API リファレンス](/reference/api)
