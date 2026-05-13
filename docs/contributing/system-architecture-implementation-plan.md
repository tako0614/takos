# Takosumi System Architecture Implementation Plan

> このページでわかること: 1.0 Core Release 当時のアーキテクチャ実装計画 (Historical)。

::: warning Historical 1.0 Core Release plan
本ドキュメントは **1.0 Core Release** (M0-M4 frozen 2026-04-29) の implementation plan です。コードレイアウト表記の `apps/paas/...` は当時の pre-split 名称であり、split 後のパスとは異なる historical reference として読んでください。**1.x Installable App Model (Phase 1.1-1.7)** の plan は ROADMAP.md Part II を参照してください。
:::

このプランは、`../architecture/system-architecture.md` のアーキテクチャ contract と `../takosumi/` の Takos Deploy spec kit を `takos` プロダクトルートにマップしたものです。

## Ground rules

- `takosumi` は単一プロダクトルートを維持。ドメイン境界はモジュールであり、default microservice ではない。
- Integrated モードと standalone モードは同じ PaaS コアセマンティクスを共有。差異は plugin・adapter・プロセスロール・トポロジー。
- `takos-deploy` と `takos-runtime` は `takosumi` 内部の `domains/deploy` と `domains/runtime` として実装。
- canonical な write は primary コントロールプレーンに留まる。provider / runtime の observed state は canonical にはならない。
- 各ドメインは command / query / event / port / store interface を公開する。他ドメインがあるドメインの store を直接 import してはいけない。
- self-host、cloud provider、DB、queue、object-storage、KMS、secret backend の実装は kernel の外。kernel は plugin ABI と reference な no-I/O adapter のみを所有し、実接続はオペレータ選択 plugin 経由で読み込まれる。

## ターゲットのコードレイアウト

```text
takosumi/packages/kernel/src/api/                  HTTP API, internal API, standalone host
takosumi/packages/kernel/src/domains/core/         tenant / space / group / membership / entitlement
takosumi/packages/kernel/src/domains/deploy/       Deployment / ProviderObservation / GroupHead
takosumi/packages/kernel/src/domains/runtime/      WorkloadRevision / ProviderMaterialization / observed state
takosumi/packages/kernel/src/domains/resources/    ResourceInstance / ResourceBinding / MigrationLedger
takosumi/packages/kernel/src/domains/routing/      route ownership / RouteProjection
takosumi/packages/kernel/src/domains/network/      RuntimeNetworkPolicy / ServiceGrant / WorkloadIdentity
takosumi/packages/kernel/src/domains/registry/     package resolution / trust / provider packages
takosumi/packages/kernel/src/domains/audit/        append-only audit and security events
takosumi/packages/kernel/src/workers/              apply jobs / materialization / outbox consumers
takosumi/packages/kernel/src/agents/               runtime agent protocol and work leases
takosumi/packages/kernel/src/adapters/             kernel reference ports and local adapters
takosumi/packages/kernel/src/plugins/              kernel plugin ABI registry, loader, reference plugin
takosumi/packages/kernel/src/shared/               ids / time / errors / common helpers
takosumi/packages/contract/src/                    public/internal/plugin TypeScript contracts
```

## マイルストーン

### M0: Contract freeze と初期ドメイン

Exit criteria。

- アーキテクチャ→コードのマップが存在する。
- contract パッケージが Takosumi の基本語彙を export している。
- app パッケージが core / deploy のドメイン境界を持つ。
- `deno task check` が通る。

### M1: Core ドメイン

実装内容。

- integrated / standalone 両モードで正規化された `ActorContext`。
- method・path・timestamp・request id・actor コンテキスト・body digest に紐付く署名付き internal RPC。
- Space / Group の command / query サービス。
- mutation 境界での membership / role / entitlement プレースホルダ。
- storage driver 境界の裏に置く memory store と storage port。
- ドメイン event / outbox インターフェース。

Exit criteria。

- health エンドポイントが動く。
- 署名付き internal space / group API が動く。
- space / group 作成が安定したサマリとドメインイベントを生成する。
- 不正 / malformed な internal 呼び出しが reject される。

### M2: Deploy kernel vertical slice

実装内容。

- フラットな公開 `.takosumi/manifest.yml` マニフェストモデル。
- 公開 manifest から内部 `AppSpec` / `EnvSpec` / `PolicySpec` へのコンパイラ。
- source adapter 用の immutable な `SourceSnapshot`。
- read set 付きの non-mutating な Deployment 解決。
- Deployment apply 状態機械。
- apply 後の immutable な `Deployment` state。
- store 境界における強整合な `GroupHead` 進行。

Exit criteria。

- resolve-only deploy が activation / workload materialization を作らない。
- apply が desired activation state を記録し、`GroupHead` を進める。
- provider / materialization の失敗が、apply 済み `Deployment` を mutation できない。

### M3: Runtime / routing kernel vertical slice

まず kernel セマンティクスを実装。

- `RuntimeHostCapability` と provider materialization port。
- target / package / object / status を記録する `ProviderMaterialization`。
- observed state の取り込みと readiness condition。
- activation と route ownership から導出される `RouteProjection`。
- desired / serving / dependencies / security に分割された status。

Exit criteria。

- provider plugin が canonical な activation truth を変えずに materialization を記録できる。
- route projection が生成される。
- provider drift が canonical activation ではなく observed state のみを変える。

### M4: Resources / network / secrets

実装内容。

- `ResourceInstance` / `ResourceBinding` / `BindingSetRevision`。
- provider credential / build secret と分離された runtime secret injection。
- assignment 意識付きの `RuntimeNetworkPolicy` セレクタ。
- `ServiceGrant` と `WorkloadIdentity` のチェック。

Exit criteria。

- resource create / bind が動く。
- rollback が durable な resource state を巻き戻さない。
- provider credential が workload からアクセスできない。

### M5: Registry / provider packages / trust

実装内容。

- 同梱の registry と ref→digest の package resolution。
- resource / data / provider package descriptor と app-output registry evidence。
- trust 記録、revocation、conformance tier。
- provider support と充足度レポート。

Exit criteria。

- package ref が digest に解決される。
- revoke された package が新規 plan をブロックする。
- 影響を受ける既存 group は silent な mutate ではなく degraded になる。

### M6: App outputs / events / dependencies

実装内容。

- 明示的な app-output consume binding。
- app metadata / route projection と withdraw / rebind ポリシー。
- default で `primaryAppReleaseId` を介して解決される event subscription。
- 依存先 group 向けの `ChangeSetPlan`。

Exit criteria。

- output が自動注入されない。
- breaking な app-output 変更が依存先 plan を生成する。
- デプロイ時の output サイクルがブロックされる。

### M7: Standalone kernel host

実装内容。

- integrated モードと同じ kernel サービスを使う standalone API プロセス。
- operator 限定の plugin 選択とモジュールロード。
- conformance / ローカル開発向けの reference no-I/O plugin。
- 未選択の外部境界を reject する production safety ガード。

Exit criteria。

- `takosumi` が `takos-app` 無しで起動できる。
- 注入された reference または operator plugin で space / group / deploy / rollback / uninstall が API 経由で動く。
- integrated モードと同じコアサービスが使われる。

### M8: Acceptance test の堅牢化

takosumi kernel の acceptance 範囲をテスト群に変換。グループ化軸。

- plan / apply
- activation
- provider materialization
- resource contract
- migration / restore
- canary 副作用
- event
- app output / 依存
- runtime セキュリティ
- direct deploy
- GC / retention
- セキュリティ / supply chain

## 検証

```bash
deno task check
cd ../takosumi && deno task test
deno lint
deno fmt --check
```
