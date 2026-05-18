# 開発者向け情報

> このページでわかること: Takos の開発に参加するための実装計画と検証手順の目次。

## アーキテクチャ

- [`current-state.md`](./current-state.md) — kernel API・ドメイン・プロセス役割・adapter・storage・production-safety チェックの実装スナップショット。
- [`api-surface.md`](./api-surface.md) — `takosumi/packages/kernel/src/api/openapi.ts` が source of truth として保持する OpenAPI 風の route 一覧。
- [`deploy-topology-notes.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/deploy-topology-notes.md) — Compose / Helm 向けの Takos サービス構成メモ。
- [`kernel-plugin-boundary-audit.md`](./kernel-plugin-boundary-audit.md) — kernel と plugin-backed infrastructure の境界を docs / 実装間で揃えるためのチェックリスト。
- kernel / plugin 境界: `../takosumi/packages/contract/src/plugin.ts` が公開 plugin ABI、`../takosumi/packages/kernel/src/plugins/` が registry・module loader・no-I/O reference plugin を持ちます。

## 検証

- [`quality/`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/) — ecosystem 横断の quality インデックス。
- [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md) — acceptance 項目と実装カバレッジの対応表。
- [`acceptance-test-backlog.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md) — 残作業の acceptance test backlog。
- [`release-gate.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/release-gate.md) — Takos プロダクトの release validator (サービス構成・アーキテクチャ整合チェックを含む) のリファレンス。

## Smoke テスト

- [`smoke.md`](./smoke.md) — Takos product root の current smoke / release gate。
- [`runtime-agent-api-smoke.md`](./runtime-agent-api-smoke.md) — runtime-agent API の Takosumi test path。
- [`router-config-smoke.md`](./router-config-smoke.md) — router config contract の Takosumi test path。
- [`self-host-e2e.md`](./self-host-e2e.md) — self-host distribution smoke と local Compose proof。
- [`self-host-runbook.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/self-host-runbook.md) — 実機 single-node self-host E2E のオペレータ runbook。
- [`compose-smoke.md`](./compose-smoke.md) — `deno task local:*` による current Compose smoke。
- [`git-source-smoke.md`](./git-source-smoke.md) — `takosumi` の Git URL install / source proof。
- [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) — SQL storage / migration proof。
- [`redis-queue-smoke.md`](./redis-queue-smoke.md) — queue / background worker proof。
- [`object-storage-smoke.md`](./object-storage-smoke.md) — object-store / R2 export artifact proof。
- [`docker-provider-smoke.md`](./docker-provider-smoke.md) — Docker / self-host proof。
- [`compose-real-smoke.md`](./compose-real-smoke.md) — 実 Docker Compose を起動する local proof。

## Production gap

- [`production-gap-burndown.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/production-gap-burndown.md) — implemented / safe-dry-run / opt-in-real / partial-boundary / environment-dependent の各領域を proof コマンド付きで整理した production readiness burndown。
- 残りの phase 境界・カタログ gap は [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md) と [`acceptance-test-backlog.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md) で追跡。
- topology / resource 命名の整合 gap は [`deploy-topology-notes.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/deploy-topology-notes.md) で管理。

## Plugin-backed infrastructure

self-host / cloud 接続は Takos product source checks と live operator proof を分けます。
source-controlled な current proof は `deno task validate:distributions` /
`deno task distribution:smoke` / `deno task release-gate` です。実機 proof は
target URL、provider credential、operator が編集した env file、private evidence ref を持つ
runbook に添付します。

## 1.x Installable App Model Roadmap

1.0 Core Release (Part I) 後の Installable App Model 関連 phase は ROADMAP.md の Part II + Part III で管理します。

- ROADMAP.md Part II Phase 1.1-1.7 (ecosystem root の `ROADMAP.md` を参照)
- [Acceptance Backlog (Phase 1.x feature)](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md)
- [Installable App Model 設計](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
