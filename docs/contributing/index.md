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

- [`smoke.md`](./smoke.md) — in-process lifecycle smoke のスコープ。実行可能な kernel カバレッジは `../takosumi` 配下の test にあります。
- [`runtime-agent-api-smoke.md`](./runtime-agent-api-smoke.md) — runtime-agent lifecycle API smoke。実行は `cd ../takosumi && deno test --allow-all packages/kernel/src/api/runtime_agent_routes_test.ts`。
- [`router-config-smoke.md`](./router-config-smoke.md) — memory / file router の config materialization smoke。
- [`self-host-e2e.md`](./self-host-e2e.md) — 静的な self-host Compose チェックと、単一ノード Docker による手動 smoke パス。
- [`self-host-runbook.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/self-host-runbook.md) — 実機 single-node self-host E2E のオペレータ runbook。
- [`compose-smoke.md`](./compose-smoke.md) — safe-by-default Compose チェックリストと optional stack smoke。
- [`git-source-smoke.md`](./git-source-smoke.md) — source adapter (manifest / local upload / git snapshot) の smoke スコープ。
- [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) — Postgres storage / migration smoke (real DB は opt-in)。
- [`redis-queue-smoke.md`](./redis-queue-smoke.md) — Redis queue adapter smoke (real Redis は opt-in)。
- [`object-storage-smoke.md`](./object-storage-smoke.md) — memory / S3 互換 object-storage smoke (real endpoint は opt-in)。
- [`docker-provider-smoke.md`](./docker-provider-smoke.md) — Docker provider materialization smoke。
- [`compose-real-smoke.md`](./compose-real-smoke.md) — real Compose harness の safe-by-default smoke。opt-in モードはローカルで通過実績あり (2026-04-28)。

## Production gap

- [`production-gap-burndown.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/production-gap-burndown.md) — implemented / safe-dry-run / opt-in-real / partial-boundary / environment-dependent の各領域を proof コマンド付きで整理した production readiness burndown。
- 残りの phase 境界・カタログ gap は [`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md) と [`acceptance-test-backlog.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md) で追跡。
- topology / resource 命名の整合 gap は [`deploy-topology-notes.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/deploy-topology-notes.md) で管理。

## Plugin-backed infrastructure

self-host / cloud 接続は kernel の責務ではなく、`TAKOS_KERNEL_PLUGIN_MODULES` で読み込まれる kernel plugin、もしくは host プロセスから注入される plugin 経由で外部システムと接続します。下記の proof パスは default では safe で、明示的に opt-in した場合のみ local adapter の挙動を実行します。

- 実際の git resolution: [`git-source-smoke.md`](./git-source-smoke.md) — `TAKOS_RUN_GIT_SMOKE=1` / `TAKOS_GIT_SMOKE_REPO` / `--allow-run=git`。
- 実際の Docker provider 実行: [`docker-provider-smoke.md`](./docker-provider-smoke.md) — `TAKOS_RUN_DOCKER_SMOKE=1` / `--allow-run=docker`。
- 実際の Compose stack smoke: [`compose-smoke.md`](./compose-smoke.md) — `TAKOS_RUN_COMPOSE_SMOKE=1` / 用意した env ファイル / `--allow-run=docker`。
- 実際の Compose harness: [`compose-real-smoke.md`](./compose-real-smoke.md) — `TAKOS_RUN_REAL_COMPOSE_SMOKE=1` / env ファイル / `--allow-run=docker` / `--allow-net=127.0.0.1`。
- 実際の Postgres storage smoke: [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) — `TAKOS_RUN_POSTGRES_SMOKE=1` / `DATABASE_URL` または `TAKOS_DATABASE_URL` / `--allow-net` / `--allow-read` が揃ったときに `npm:pg` 経由の SQL client を実行。
- 実際の Redis queue smoke: [`redis-queue-smoke.md`](./redis-queue-smoke.md) — `TAKOS_RUN_REDIS_QUEUE_SMOKE=1` / Redis URL / `--allow-net`。
- 実際の S3 互換 object-storage smoke: [`object-storage-smoke.md`](./object-storage-smoke.md) — `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1` / `TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1` / endpoint・bucket 資格情報 / `--allow-net`。
- 実機 single-node self-host proof: [`self-host-runbook.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/self-host-runbook.md) と [`self-host-e2e.md`](./self-host-e2e.md)。Docker Compose / image / open port / 資格情報 / オペレータが編集した `.env.local` が必要。

## 1.x Installable App Model Roadmap

1.0 Core Release (Part I) 後の Installable App Model 関連 phase は ROADMAP.md の Part II + Part III で管理します。

- ROADMAP.md Part II Phase 1.1-1.7 (ecosystem root の `ROADMAP.md` を参照)
- [Acceptance Backlog (Phase 1.x feature)](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-test-backlog.md)
- [Installable App Model 設計](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
