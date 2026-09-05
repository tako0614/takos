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
- runner boundary: OpenTofu state backend、provider credential、Connection / ProviderBinding / policy の
  wiring は external Takosumi control plane が解決します。Takos product routes は Takosumi の StateVersion / Output
  ledger と、認可済みの Interface / InterfaceBinding を消費します。

## 検証

Takos の portable complete gate は product root の `bun run check` です。format
check、lint/static analysis、type/compile、portable tests、portable build を一度に
検証します。cross-repo 検証は sibling `takos-control` root で次を使います。

```bash
bun run check:workspace -- --changed
bun run check:workspace -- --task TASK-0003
bun run check:workspace -- --all
```

live service、operator-private state、readiness evidence、recovery drill は別の
credential boundary と cadence を持ち、product check や release approval に
混ぜません。

### 宣言済み debt ledger

type check、lint、portable test は対象を絞り込みません。3 つの gate はいずれも
repository 全体を対象にし、残っている例外だけを `quality/` の ledger に
書き出します。

| Ledger | Gate | 意味 |
| --- | --- | --- |
| [`quality/typescript-debt.json`](../../quality/typescript-debt.json) | `bun run check:types` | `tsconfig.check.json` と `web/tsconfig.json` を全量 compile し、ここに数えていない diagnostic を拒否します。 |
| [`quality/lint-debt.json`](../../quality/lint-debt.json) | `bun run check:lint` | oxlint (`.oxlintrc.json`) の finding のうち、ここに数えていないものを拒否します。 |
| [`quality/test-quarantine.json`](../../quality/test-quarantine.json) | `bun run test` / `bun run check:test-quarantine` | portable gate から除外する、現在失敗する tracked test file を理由付きで宣言します。 |
| [`quality/test-online.json`](../../quality/test-online.json) | `bun run test:online` | public network や operator-owned online evidence が必要で、portable gate から除外する test file を理由付きで宣言します。 |

件数は countdown です。増えれば gate が落ち、減っても ledger を下げるまで落ちます。
0 になった entry は削除します。quarantine は「今は失敗する」という主張なので、
`bun run check:test-quarantine` が該当 file を実行し、通ってしまったものを拒否します。

online evidence は portable gate に混ぜません。`bun run test:online` または
`bun scripts/run-portable-tests.ts --online` を明示的に実行してください。
`--list` は選択された file だけを表示し、test process を起動しません。

利用者向け docs を変更する場合は、[`documentation-style.md`](./documentation-style.md)
の順序と用語ルールに従い、`bun run docs:build` も実行します。

## Smoke テスト

- [`smoke.md`](./smoke.md) — Takos product root の portable gate と focused local smoke。
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
`bun run check` です。candidate manifest、artifact digest、secret-policy claim は
deploy entrypoint が owner gate として集める内部 evidence であり、deploy の
authority ではありません。実機 proof は target URL、provider credential、
operator が編集した env file、private evidence ref を持つ runbook に添付します。

publication / hosted deploy はこの repository の entrypoint を使います。詳細は
[`smoke.md`](./smoke.md) に記載しています。self-host 先への deploy は
self-hoster 自身の runbook と authority に従います。

## Takosumi Capsule Lifecycle

Takosumi Capsule Lifecycle の公開モデルは
[Takosumi specification](https://takosumi.com/docs/reference/model) を参照してください。Takos 側では
[Takos App Interface](../architecture/app-interface.md) と
[OpenTofu Outputs and Runtime Interfaces](../deploy/runtime-interfaces.md) を、app launcher / MCP / file handler / storage /
Git / agent runtime の product profile として扱います。
