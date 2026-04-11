# Takos Docs Alignment Audit

public docs を正本仕様として、`takos/` 実装を照合した監査台帳。
判定対象は `docs/apps`, `docs/deploy`, `docs/reference`, `docs/architecture` の current surface のみ。

## Summary

- 基本方針はすでに docs-first に寄っている
- ただし deploy/manifest まわりには Phase 1/2 の暫定層が残っている
- public surface は概ね `takos deploy` 中心に整理されているが、legacy surface の痕跡が README や内部文言に残る
- すぐ直すべき docs 不一致は `compute.<name>.depends` の解釈

## Findings

| ID | Priority | Class | Contract | Finding | Evidence |
| --- | --- | --- | --- | --- | --- |
| A-001 | P0 | implementation must change | Manifest | docs は `compute.<name>.depends` で compute 名と storage 名の両方を許可するが、parser は compute 名しか受けていなかった | `docs/apps/manifest.md`, `docs/reference/manifest-spec.md`, `packages/control/src/application/services/source/app-manifest-parser/index.ts` |
| A-002 | P1 | implementation must change | Manifest/deploy internals | flat manifest は正本になっているが、deploy 層に legacy mirror と transitional alias が残っている。新規コードは canonical type を直接参照すべき | `packages/control/src/application/services/source/app-manifest-types.ts`, `packages/control/src/application/services/deployment/group-deploy-manifest.ts` |
| B-001 | P1 | docs must be clarified | Architecture docs | current architecture index から `implementation-plan.md` に直接リンクされており、現仕様と将来計画が同列に見える | `docs/architecture/index.md`, `docs/architecture/implementation-plan.md` |
| B-002 | P2 | docs must be clarified | Public vs auxiliary docs | public docs は `takos deploy` を唯一の entrypoint と定義しているが、補助文書には `takos apply` / `takos plan` の記述が残る | `docs/reference/cli.md`, `apps/cli/README.md` |
| C-001 | P1 | compatibility layer allowed but hidden | CLI | removed legacy surface は hidden command と redirect で封じ込められている。public help に出さない方針は維持でよい | `apps/cli/src/commands/api.ts`, `apps/cli/src/index.ts` |
| C-002 | P1 | compatibility layer allowed but hidden | Manifest typing | `AppWorker`, `AppService`, `AppResource` などの deprecated alias は移行用としてのみ許容。public import には使わせない | `packages/control/src/application/services/source/app-manifest-types.ts` |
| C-003 | P2 | compatibility layer allowed but hidden | Deploy events | rollback は deploy event に相乗りしており、専用 lifecycle event への整理が未完了 | `packages/control/src/server/routes/groups/deployment-routes.ts` |

## Current Decisions

- public docs と不一致の parser 振る舞いは実装修正する
- hidden legacy surface は互換層として残してよいが、public help や current docs には露出させない
- 将来計画は current public contract と混線させない

## Next Backlog

1. deploy 層から flat canonical manifest type への直接依存を進め、legacy mirror import を減らす
2. architecture docs で current spec と migration plan の境界を明記する
3. 補助文書の `takos apply` / `takos plan` 残骸を削る
4. rollback lifecycle event を `group.rollback` に分離する
