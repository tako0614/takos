# Takosumi Current State

> このページでわかること: Takosumi の現在の実装状態のスナップショット。

このスナップショットは、本プロダクトルートに存在する実装の要約です。前向きの計画は ecosystem root の
[`ROADMAP.md`](https://github.com/tako0614/takos-ecosystem/blob/master/ROADMAP.md) を参照してください。

## 実装アーキテクチャ

- `../takosumi/packages/kernel/src/index.ts` が `../takosumi/packages/kernel/src/api` から Hono HTTP アプリを起動し、standalone エントリポイントで kernel route を有効化します。
- `../takosumi/packages/kernel/src/api` の公開内容。
  - `GET /health` と `GET /capabilities`。
  - kernel deploy route `POST /v1/deployments` (コンパイル済み Shape manifest の apply)。
  - `/api/public/v1` 配下の Takos プロダクト gateway route は `takos/app` 側で管理しており、kernel 公開 contract としては扱いません。
  - `takosumi-contract` のパス定数を介した署名付き internal service route。
- `../takosumi/packages/contract` は共通 DTO と署名付き internal リクエストヘルパーを持ちます。internal 認証は method・path・timestamp・request id・actor コンテキスト・caller / audience・body digest を束ねます。
- `../takosumi/packages/kernel/src/app_context.ts` が in-process の主要 composition point。in-memory store、構成可能な local adapter、コアサービス、deploy apply サービス、runtime materializer を配線します。
- Runtime config と bootstrap チェックで production safety をモデル化: 安全でない production default は、storage / provider / source / secret / operator-config / 認証選択を明示しない限り reject されます。
- ドメインモジュールは core / deploy / runtime / resources / routing / network / registry / audit / events / app-output 依存 safety / supply-chain に存在。公開モデルは「app metadata / resource outputs / registry entries / explicit grants」として記述します。
- Takos product deploy artifacts are `takos-app` / `takos-git` / `takos-agent`。
  local/substrate stack may also include Takosumi kernel / Takosumi Accounts /
  takosumi-git, but they are not Takos product services.
- worker と orchestration ヘルパーは apply job、outbox dispatch、registry sync、repair、runtime vertical slice activation、deploy-to-runtime オーケストレーション、event planning、app-output 依存 planning、change-set planning、status / readiness projection、provider operation、resource operation、rollout canary step、supply-chain 準備、usage 集計、runtime ログ、direct deploy compile、approval、backup / restore、コントロールプレーン upgrade planning、bootstrap 診断に対応。
- Storage はトランザクション対応 in-memory driver と Postgres driver の境界の両方を持ちます。Postgres migration / statement と SQL-backed store は core / deploy / resources / registry / audit の各 store ファミリに存在。migration runner test は順序適用・dry-run レポート・チェックサム検証をカバー。Postgres smoke は optional な `npm:pg` client adapter 経由で実 DB を opt-in 検証できます。
- provider / source / secret / auth / operator-config / queue / object-storage adapter は port として実装され、ローカル default が用意されています。kernel / plugin ABI は `../takosumi/packages/contract/src/plugin.ts` で版管理され、型付き registry・env module loader・no-I/O reference plugin が `../takosumi/packages/kernel/src/plugins` にあります。self-host / cloud 接続は plugin の責務です。

## 実装済みの本番相当機能

- Runtime configuration は in-memory や default ローカル配線での production boot を reject しつつ、本番相当環境向けに安全な明示選択を許可します。
- 署名付き internal 認証は `WorkerAuthzService`・workload identity・service grant チェック・private-egress policy 否認テストと連動。
- Provider 実行は `ProviderOperationService` を介して表現され、idempotency-key リプレイ、永続化された operation 記録、成功 / 失敗の分類、再試行可能な一時障害のハンドリング、provider 失敗による activation truth 改変防止を備えます。
- Deploy-to-runtime オーケストレーションは plan / apply、artifact 準備、runtime output materialize、status projection、要求時の artifact 準備スキップに対応。
- supply-chain 準備は prepared artifact、mirror 決定、package 解決 digest、protected window、digest 衝突拒否、再利用検証を記録。
- registry は同梱の digest-pinned seed、trust / revocation 記録、provider support report、revoke された trust のセキュリティブロック報告を持ちます。
- event planning と app-output 依存 safety で、明示バインディング、曖昧出力ブロック、依存サイクル検出、breaking-change な依存先 plan、canary / shadow 挙動、external schedule の target デフォルト、queue consumer 切替プレビューをモデル化。
- resource operation で create / bind / unbind、migration ledger、checksum ブロック、imported / shared の migration 制限、resource operation としての restore をモデル化。
- router / status projection は commit 済み activation と観測された runtime state から導出され、canonical desired state を書き換えません。

## 検証済みテスト

`/home/tako/Desktop/takos/takos` から実行。

```sh
deno task check
cd ../takosumi && deno task test
```

2026-04-29 時点の結果: kernel-only smoke ベースラインは `240 passed | 0 failed` (`cd ../takosumi && deno task test`)。ecosystem release-gate (17 release gate + canonical full suite via `cd takos && deno task release-gate`) は **345 tests passed** で freeze 済 (ROADMAP.md Part I §3.1 / §6.2 を canonical value とする)。

カバー範囲。

- 署名付き internal API リクエスト生成 / 検証、ローカル actor 認証、署名付き service actor 認証。
- public / internal route mount 動作、standalone route default、未署名 internal route の rejection。
- 基本的な space / group 作成、owner membership、non-admin 拒否。
- non-mutating deploy plan、immutable activation 作成、pointer 進行、`must-replan` の stale apply rejection、stale apply-worker 失敗記録。
- memory / Postgres storage driver / store のラウンドトリップ、および migration runner の順序・dry-run・チェックサム検証。
- runtime desired / observed state の分離、runtime vertical slice materialization、provider-output 記録、observed-state キャプチャ、route projection、status projection。
- deploy-to-runtime のオーケストレーション (plan / apply、artifact 準備、runtime materialization、status projection)。
- provider operation の idempotency、成功 / 失敗分類、一時障害の再試行、Docker dry-run / injected コマンド挙動、commit 済み activation truth の隔離。
- rollout canary の activation-per-step 挙動と HTTP-only 割当 default。
- resource create / bind / unbind、migration checksum 検証、migration 適格性制限、restore-as-resource-operation のモデル化。
- registry resolution / trust store、trust 失効報告、bundled registry seed adapter、package support レポート、supply-chain prepared artifact の再利用 / GC 保護。
- event store と app-output 依存 planner、明示バインディング、依存サイクル検出、breaking-change な依存先 plan、queue / external-schedule のデフォルト、canary / shadow target 挙動。
- audit append / query / hash-chain、network report 集計、runtime agent registry と HTTP route、bootstrap adapter 選択 / 機密マスク、通知 sink、KMS / secret store、source snapshot、local / env operator config、readiness / status route、OpenAPI route inventory、direct deploy、approval、backup / restore、change-set オーケストレーション、conformance、GC / retention、runtime ログ、usage projection、コントロールプレーン upgrade planning、Redis queue adapter、S3 互換 object-storage adapter のリクエスト署名。

## Smoke 状況

safe-by-default smoke スクリプトは 2026-04-28 docs refresh 時点の状態です。

| Boundary                     | Default 状態                                | Real / opt-in                                                                                                                | 備考                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres storage / migration | Pass                                        | `TAKOS_RUN_POSTGRES_SMOKE=1` と `DATABASE_URL` で実行可能                                                                    | dry-run は 15 テーブル / 6 migration / SQL プレビューと fake `SqlClient` トランザクションパスを DB 接続なしで報告。                                                                                           |
| Redis queue                  | Pass                                        | `TAKOS_RUN_REDIS_QUEUE_SMOKE=1` と Redis URL で実行可能                                                                      | dry-run は注入された command client 越しに `RedisQueueAdapter` の enqueue / lease / ack / 空 lease を Redis 接続なしで検証。                                                                                  |
| S3 互換 object storage       | Pass                                        | `TAKOS_RUN_OBJECT_STORAGE_SMOKE=1` と `TAKOS_OBJECT_STORAGE_SMOKE_REAL_ENDPOINT=1` および endpoint 認証で実行可能             | dry-run は memory object storage の put / head / get / list / delete と、S3 PUT / HEAD / GET / LIST / DELETE のリクエスト署名を fetch / network なしで検証。                                                  |
| Docker Compose ローカル      | Safe dry-run pass / real harness local pass | Real モードは `TAKOS_RUN_REAL_COMPOSE_SMOKE=1`、Docker Compose、`.env.local`、空きポート、ローカルイメージビルドが必要        | 2026-04-28 の real 実行で Postgres / Redis / MinIO / PaaS プロセスロール / runtime / `takos-agent` を起動し、health endpoint を確認し、cleanup を実行。default release gate には含めません。                  |

## 実行可能コマンド

ルート `deno.json` のローカル検証コマンド。

```sh
deno task check
deno task lint:agent-docs
deno task lint:docs
deno task release-gate
deno lint
deno fmt --check
deno fmt
```

その他に便利なコマンド。

```sh
cd ../takosumi && deno task check
cd ../takosumi && deno test --allow-all packages/kernel/src/domains/deploy
deno task validate:service-set
deno task local:up
deno task local:logs
deno task local:down
```

メモ。

- Takosumi のフルテスト実行は sibling kernel リポ (`cd ../takosumi && deno test --allow-all`) が所有。
- Takosumi kernel のローカル開発は sibling `../takosumi` で行い、この shell ではローカル合成と Takos 固有 deploy artifact のみを扱う。
- docs ゲートは `takos/deno.json` の `lint:docs` / `lint:agent-docs` / `docs:build` / `docs:deploy`。
- ローカル Compose / Helm メタデータには Takos サービス ID と internal URL 配線を反映済み。

## In-memory と real の境界

default の runtime はローカル / in-memory です。

- `createInMemoryAppContext` は core / deploy / runtime / resources / registry / audit に in-memory store を使います。
- default adapter はローカル / メモリベース: ローカル actor / 認証、memory 通知、ローカル operator config、no-op provider、メモリ暗号化 secret store、`MemoryStorageDriver`。
- source adapter は immutable snapshot を生成。Git コマンド実行は default では dry-run、実 Git は明示的に `DenoGitCommandRunner` / runner 注入を行ったときのみ動きます。
- ローカル Docker materialization は決定論的な Docker operation を記録し、default の dry-run runner を使用。実 Docker 実行は注入されたコマンド runner が必要です。
- provider observed state は canonical な deploy / runtime desired state とは別にモデル化。テストでは observed drift / provider 失敗が canonical desired state や activation truth を書き換えないことを確認します。

コードとして存在するが default の配線ではない real / 本番向け境界。

- `createConfiguredAppContext` と runtime config 選択は、安全でない production default を reject し、plugin-backed な外部境界を選択し、operator 選択 plugin が未登録なら fail fast します。
- `PostgresStorageDriver`・SQL store 実装・storage migration runner・optional な `npm:pg` SQL client 生成は `StorageDriver` トランザクション境界の背後にありますが、同梱の app composition は引き続きメモリストアを使います。
- `DenoCommandDockerRunner` と `DenoGitCommandRunner` は明示選択 / 注入時に実外部コマンドを実行できます。
- env operator config は raw 値を露出せずに secret 参照を読めますが、本番 secret 管理は adapter 境界の作業であり、default context にデプロイ済みの secret backend は含まれません。
- 署名付き internal service 認証、workload identity、service grant、network policy チェックは service レベルの enforcement として存在。全 mutation 境界にまたがる runtime identity の発行 / enforcement は本番統合作業として残ります。

## 残りの具体ステップ

- HTTP / runtime エントリポイントを明示的な本番 storage 選択・migration 実行・health / readiness チェックに接続し、in-memory app state default をやめる。
- workload identity 発行、`ServiceGrant` lookup、entitlement チェック、mutation 境界 policy をすべての internal route / worker パスに接続する (現在は service レベルの認可 slice のみ)。
- provider operation 永続化を full apply パスに昇格し、durable retry key、object ref、package digest、status 永続化、materialization 各段階の non-mutating な失敗挙動を備える。
- trust 失効、provider support レポート、migration checksum ブロック、network enforcement、approval チェック、package digest チェックを単独サービス / store から plan / apply の phase 境界 enforcement に昇格する。
- durable な resource lifecycle の本番セマンティクス (backup / restore、migration、sharing / import 制限、rollback window、provider native restore、operator 向け復旧フロー) を完成させる。
- apply パイプラインにおける app-output / event / dependency オーケストレーション (cross-group grant、managed projection health、queue / external schedule の activation default、canary / shadow trafic の副作用制御) を完成させる。
- 実 self-host / cloud provider / source / storage / queue / object / KMS / secret 実装を kernel plugin に移し、kernel release gate の外で plugin 固有の release gate を回す。
- ローカル Compose / Helm のリソース名とコマンドパスを Takos プロダクトサービス + Takosumi substrate スタックに揃え続ける。
- 残りの本番 gap に route / worker レベルの regression test が付くまで、[`acceptance-matrix.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/acceptance-matrix.md) のカバレッジを広げ続ける。
