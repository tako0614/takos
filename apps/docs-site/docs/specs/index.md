# 独自仕様の全体像

Takos の利用者が前提として知るべき仕様は、大きく 3 つに分かれます。

1. `.takos/app.yml` で app をどう記述するか
2. deployment がどの artifact と target をどう扱うか
3. CLI と auth がどの usage model を前提にしているか

## この章で扱うもの

- [`.takos/app.yml`](/specs/app-manifest)
- [deployment model](/specs/deployment-model)
- [Deploy System v1](/specs/deploy-system) — App deploy, release, rollout, resource, migration の確定仕様
- [CLI / Auth model](/specs/cli-and-auth)
