# ロールバック

> このページでわかること: インストール済みアプリを以前のバージョンに戻す方法。

ロールバックは Installation のバージョンを戻す操作です。

## Installation rollback

install された app は source commit、`.takosumi.yml` AppSpec digest、Deployment
record を Installation ledger に pin しています。rollback は以前の pinned
Deployment を選び、install dry-run と同じ確認を通して新しい Deployment を記録します。
provider data copy / schema migration の巻き戻しは rollback の current guarantee ではありません。

```bash
takosumi rollback inst_abc dep_previous
```

成功すると Installation の current Deployment が rollback Deployment に進み、
ledger に rollback event が残ります。

## Kernel rollback

kernel は group ごとに GroupHead を持ちます。

```text
current_deployment_id  -> dep_new
previous_deployment_id -> dep_old
```

rollback は retained Deployment を入力に、新しい rollback Deployment record を
forward-only に追加します。

## 戻るもの

- workload code
- AppSpec の namespace `publish` / `listen` declaration から materialize された env
- route / custom-domain desired state
- resource desired state
- retained artifact digest

## 戻らないもの

- database の data
- object store / key-value の data
- 外部 API で発生した副作用
- Accounts 側で現在有効な issuer / billing / grant policy

DB migration は expand-only にし、destructive change は段階的に進めます。

## Retention requirements

rollback target には次が残っている必要があります。

- manifest snapshot
- descriptor closure
- desired state
- artifact digest
- status / conditions

これらが GC された Deployment は rollback target にできません。

## Next

- [Deployment Group](/deploy/deploy-group)
- [Git / Store install](/deploy/store-deploy)
- [トラブルシューティング](/deploy/troubleshooting)
