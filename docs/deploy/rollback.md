# ロールバック

> このページでわかること: インストール済みアプリを以前のバージョンに戻す方法。

ロールバックは Installation のバージョンを戻す操作です。

## Installation rollback

install された app は resolved source identity、`.takosumi.yml` AppSpec digest、
Deployment record を Installation ledger に pin しています。source identity は
git source なら commit、prepared source なら prepared archive payload digest
(`source.digest` / dry-run guard の `expected.sourceDigest`) です。rollback は
以前の pinned Deployment を選び、Installation の current pointer をその retained
Deployment へ戻します。新しい Deployment record は作りません。source の再 fetch
/ rebuild は行わず、retained activation/materialization snapshot を使って
runtime pointer / routing assignment を target に戻します。provider data copy / schema migration の巻き戻しは rollback の current guarantee ではありません。

```bash
takosumi rollback inst_abc dep_previous
```

成功すると Installation の `currentDeploymentId` が target Deployment を指し、
ledger に rollback event が残ります。

## Kernel rollback

rollback は retained Deployment を入力に、Installation の current pointer を
過去の `succeeded` Deployment へ戻します。operation metadata / audit は
append-only ですが、Deployment は追加しません。internal activation / routing
details は reference architecture の実装メモです。

## 戻るもの

- retained Deployment の runtime pointer / routing assignment
- retained Deployment の public/non-secret outputs
- AppSpec の `publish` / `listen` declaration から materialize された runtime
  binding
- retained source identity / manifest digest / retained evidence refs

## 戻らないもの

- provider resource contents and schema state
- database の data
- object store / key-value の data
- migration result
- 外部 API で発生した副作用
- Accounts 側で現在有効な issuer / billing / authorization policy

DB migration は expand-only にし、destructive change は段階的に進めます。

## Retention requirements

rollback target には次が残っている必要があります。

- manifest snapshot
- resolved source identity
- retained succeeded Deployment
- source identity (`commit` or prepared archive payload digest)
- `Deployment.status == "succeeded"`
- public/non-secret outputs
- retained activation evidence / exposure health summary

これらが GC された Deployment は rollback target にできません。

## Next

- [Deployment Group](/deploy/deploy-group)
- [Git / Store install](/deploy/store-deploy)
- [トラブルシューティング](/deploy/troubleshooting)
