# 開発者向け情報

> このページでわかること: Takos の開発に参加するための現行仕様と検証手順の目次。

## アーキテクチャ

- [`current-state.md`](./current-state.md) — Takos product shell と external Takosumi control plane の実装スナップショット。
- [`api-surface.md`](./api-surface.md) — Takos product routes と、Takos が消費する Takosumi deploy-control /
  account-plane surface。
- Takosumi deploy topology notes (`takosumi/docs/operations/deploy-topology-notes.md`)
  — hosted operator / self-host distribution の deploy target と ownership boundary。
- [`operator-boundary-audit.md`](./operator-boundary-audit.md) — Takos product と operator-owned infrastructure の境界を
  docs / 実装間で揃えるためのチェックリスト。
- runner boundary: OpenTofu state backend、provider credential、Connection / ProviderBinding /
  policy / runtime-agent handler wiring は external Takosumi control plane が解決します。Takos product routes は Takosumi
  の StateVersion / Output / Capsule output projection records を消費します。

## 検証

- ecosystem root `docs/quality/` — ecosystem 横断の quality index。
- ecosystem root `docs/quality/acceptance-matrix.md`
  — local / repository-proven acceptance coverage。
- ecosystem root `docs/quality/takosumi-completion-audit.md`
  — repo regression evidence と live operator evidence を分離する strict completion gate。
- ecosystem root `docs/quality/platform-readiness-evidence-summary.md`
  — public-safe hosted Takosumi readiness / hardening summary。
- ecosystem root `docs/quality/release-gate.md` — Takos
  product の release validator。

## Smoke テスト

- [`smoke.md`](./smoke.md) — Takos product root の current smoke / release gate。
- [`runtime-agent-api-smoke.md`](./runtime-agent-api-smoke.md) — runtime-agent API の Takosumi test path。
- [`router-config-smoke.md`](./router-config-smoke.md) — router config contract の Takosumi test path。
- [`self-host-e2e.md`](./self-host-e2e.md) — self-host distribution smoke と local Compose proof。
- [`compose-smoke.md`](./compose-smoke.md) — `bun run local:*` による current Compose smoke。
- [`git-source-smoke.md`](./git-source-smoke.md) — `takosumi` の Git URL install / source proof。
- [`postgres-storage-smoke.md`](./postgres-storage-smoke.md) — SQL storage / migration proof。
- [`redis-queue-smoke.md`](./redis-queue-smoke.md) — queue / background worker proof。
- [`object-storage-smoke.md`](./object-storage-smoke.md) — object-store / R2 export artifact proof。
- [`docker-provider-smoke.md`](./docker-provider-smoke.md) — Docker / self-host proof。
- [`compose-real-smoke.md`](./compose-real-smoke.md) — 実 Docker Compose を起動する local proof。

## Operator-owned Infrastructure

self-host / cloud 接続は Takos product source checks と live operator proof を分けます。source-controlled な current proof は
`bun run release-gate` / `bun scripts/build-release-manifest.ts` / `bun run validate:opentofu-secrets` です。実機 proof は
target URL、provider credential、operator が編集した env file、private evidence ref を持つ runbook に添付します。

## Takosumi Capsule Lifecycle

Takosumi Capsule Lifecycle の正本は
[Takosumi core spec](https://takosumi.com/docs/core-spec) と
[core conformance](https://takosumi.com/docs/core-conformance) です。Takos 側では
[Capsule output projection profile](../architecture/app-interface.md) と
[OpenTofu Service Exports](../deploy/service-exports.md) を、app launcher / MCP / file handler / storage / Git / agent runtime の
product profile として扱います。
