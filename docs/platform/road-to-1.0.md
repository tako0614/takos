# Road to Takos 1.0

この文書は Takos core の 1.0 OSS GA に向けた計画の正本です。1.0 の対象は
`takos/` と `takos-cli/` です。`agent/` agent service は core
に含めます。default apps は検証 fixture / example として扱い、1.0 blocker
にはしません。

この roadmap は gate-driven です。固定公開日は置かず、各 milestone の exit
criteria を満たした時点で次へ進みます。

## Phase 7-16 Status (Deploy-Ready Completion)

Phase 1-6 で v3 Deployment-centric simplification (Core Contract / 型 / API /
CLI surface / docs) を完了したあと、Phase 7-16 で deploy-ready 状態まで
詰めました。本セクションは milestone (M0-M4) との mapping 用です。

| Phase | 担当 | M-mapping | 状態 |
| ----- | ---- | --------- | ---- |
| 7 (small rework) | apply_worker / vertical_slice / cli lint / types shim | M0 contract freeze 残課題 | done |
| 8 (cli install/uninstall + test migration) | takos-cli を `/api/public/v1/deployments` に migrate | M2 deploy GA | done |
| 9 (takos-app 旧 endpoint 削除) | `/api/deploy/*` / `group-deployment-snapshots` を完全削除 | M2 deploy GA | done |
| 10 (DeploymentService 本格実装) | descriptor closure / resolved graph / binding / apply orchestration / 51 ignored test re-enable | M0 contract freeze + M2 deploy GA | done |
| 11 (migration runner + bootstrap) | `db:migrate` / `bootstrap-initial.ts` / `generate-platform-keys.ts` | M1 self-host GA | done |
| 12 (4 cloud provider plugin live-smoke) | Cloudflare / AWS / GCP / k8s 全 4 cloud で `live-smoke-*.ts` 完備 | M1 self-host GA + post-1.0 multi-cloud | done |
| 13 (composite descriptor reference 実装) | `composite.serverless-with-postgres@v1` / `composite.web-app-with-cdn@v1` を canonical components に expand | M0 contract freeze | done |
| 14 (takos-private staging integration test) | key gen → control deploy → DB migrate → bootstrap の dry-run / real pipeline | M1 self-host GA | done |
| 15 (auth / 3rd party smoke) | Google OAuth / takos login / PAT issue / OpenAI agent run の dry-run + live smoke | M3 agent GA | done |
| 16 (e2e smoke + release gate) | `e2e:smoke:dry-run` / `release-gate` 17 gate green / `road-to-1.0.md` 更新 | M4 release hardening | done |

Phase 7-16 完了時点で `cd takos/paas && deno task release-gate` は 17 gate
すべて green、`cd takos-private && deno task e2e:smoke:dry-run` は 5 step
すべて success / skip 0 fail で完走します。`deno test --allow-all` は
345 passed / 0 failed / 21 ignored (intentional contract gaps) です。

operator が 1.0 release candidate を切る前に必ず通すべきコマンドは:

```bash
cd takos/paas && deno task release-gate            # 17 gate green
cd takos-private && deno task e2e:smoke:dry-run    # 5 step success
cd takos-private && deno task e2e:smoke:real \
  --api-url=https://staging.takos.example.com      # live staging smoke
```

最後の `--real` 実行前に `takos-private/apps/control/.secrets/<env>/` に
credentials 一式 (platform secret 5 個 + Google OAuth + OPENAI_API_KEY)
を投入し、Cloudflare API token を `CF_API_TOKEN` で export してください。

## 1.0 Definition

Takos 1.0 は、外部ユーザーが OSS checkout から single-node production self-host
を立ち上げ、CLI で login / repo / deploy / rollback / uninstall を行い、Agent /
Thread / Run を production feature として利用できる状態です。

1.0 で互換性を約束する public surface:

- deploy manifest: `.takos/app.yml` / `.takos/app.yaml`
- Deployment lifecycle: Deployment record (input / resolution / desired /
  status)、ProviderObservation stream、GroupHead pointer
- CLI: auth / endpoint / deploy / apply / diff / approve / install / rollback /
  uninstall / group / resource / thread / run
- REST API: public docs に載せる route と common error envelope。
  Deployment lifecycle は `POST /api/public/v1/deployments` 系を canonical
  endpoint とする
- Agent runtime: Thread / Run lifecycle、Rust agent、skill resolution、remote
  tool execution、local memory tools、run events、usage reporting

1.0 で production target とする hosting bundle:

- single-node production self-host
- PostgreSQL / Redis / S3-compatible object storage through Takos PaaS kernel
  plugins
- TLS / reverse proxy は operator が前段で提供する
- Cloudflare は kernel 外の reference plugin/backend として維持する

1.0 で GA とする model backend:

- OpenAI official Chat Completions compatible path
- OpenAI-compatible API endpoint with configurable base URL

Post-1.0:

- Anthropic / Google first-class GA
- ANN vector index
- distributed scheduler
- planner / subgoal 専用 graph preset
- multi-agent memory federation
- Helm production hardening beyond documented baseline

## M0: Contract Freeze (status: complete)

Goal: 1.0 の compatibility boundary を固定し、以後の実装がぶれない状態にする。

Phase 7-13 mapping:

- Phase 7D で `deploy/types.ts` の `corePlan` / `coreActivation` shim を解消
- Phase 10 で descriptor closure / resolved graph / binding resolution を
  v3 spec に準拠して実装し、`emptyResolution()` / `emptyDesired()` stub を
  完全に置換
- Phase 13 で composite descriptor reference 実装
  (`composite.serverless-with-postgres@v1` /
  `composite.web-app-with-cdn@v1`) を追加し、authoring expansion descriptor
  digest を `Deployment.resolution.descriptor_closure` に pin する path
  を完成

Implementation:

- [`../reference/manifest-spec.md`](../reference/manifest-spec.md) と parser
  contract を照合し、flat manifest schema を 1.0 canonical contract として固定する。
- Core Deployment 仕様 (Deployment record / ProviderObservation / GroupHead)
  を [`../takos-paas/core/01-core-contract-v1.0.md`](../takos-paas/core/01-core-contract-v1.0.md)
  と一致させ、Deployment.input / Deployment.resolution / Deployment.desired /
  Deployment.status の field を 1.0 contract として固定する。
- CLI public help に出す command を auth / endpoint / deploy / apply / diff /
  approve / install / rollback / uninstall / group / resource / thread / run
  に揃える。`takos deploy` が default で resolve + apply、`--preview` /
  `--resolve-only` で stage を分離する canonical surface とする。
- REST API reference の public route と internal RPC route を明確に分離し、
  `POST /api/public/v1/deployments` を deploy lifecycle の canonical endpoint
  として固定する。
- `README.md`, `LICENSE`, `CLA.md`, package metadata の license 表記を 1.0
  方針に合わせる。

Exit criteria:

- docs lint が public deploy terminology の drift を検出できる。
- CLI help snapshot または equivalent test が public command surface
  を固定する。
- manifest examples が parser / CLI / API contract test で検証される。
- Deployment / ProviderObservation / GroupHead の record shape が contract
  test で検証される。
- 1.0 compatibility statement の draft がある。

## M1: OSS Self-Host GA (status: complete)

Goal: private repository に依存せず、OSS checkout だけで single-node production
self-host を再現できるようにする。これは PaaS kernel そのものではなく、 kernel
plugin bundle と operator runbook の GA milestone として扱う。

Phase 11-14 mapping:

- Phase 11A: `db:migrate` / `db:migrate:dry-run` task と
  `apps/paas/scripts/db-migrate.ts` runner、init hook を完成
- Phase 11B: `takos-private/scripts/generate-platform-keys.ts` で
  5 platform secret を生成し、`secrets:sync` で Cloudflare Worker secret
  に upload する pipeline を整備
- Phase 11C: `apps/paas/scripts/bootstrap-initial.ts` で initial admin
  user / tenant / space / registry trust roots / default app distribution
  を seed
- Phase 12: Cloudflare / AWS / GCP / k8s 4 cloud provider plugin を
  `live-smoke-{cloudflare,aws,gcp,k8s}.ts` で opt-in live-smoke
  実行できる状態に整備
- Phase 14: `takos-private/scripts/staging-integration-test.ts` で
  key gen → control deploy → DB migrate → bootstrap pipeline の
  dry-run / real 両 mode 動作確認

Implementation:

- `takos/` に public single-node production guide を整備する。
- secret generation command / procedure を docs に固定し、placeholder secret を
  production unsafe として fail-fast または warning できるようにする。
- PostgreSQL / Redis / S3-compatible storage plugin の required config
  を整理する。
- migrations from empty DB と previous schema の手順を固定する。
- backup / restore / upgrade / rollback notes を self-host docs に追加する。
- local smoke と production-like single-node smoke を分ける。

Exit criteria:

- clean machine で self-host stack が起動する。
- user / space 作成、CLI login、repo clone/push、simple worker deploy、
  preview、rollback、uninstall が通る。
- `takos-private/` なしで public docs の手順が完結する。
- production unsafe defaults が docs と runtime guard の両方で明示される。

## M2: Deploy / Git / API GA (status: complete)

Goal: deploy kernel と Git-native workflow を 1.0 public surface
として安定化する。

Phase 8-10 mapping:

- Phase 8: takos-cli `install` / `uninstall` / `deploy` / `rollback`
  を `/api/public/v1/deployments` (mode=preview/resolve/apply/rollback) に
  migrate、test 8 箇所を新 endpoint expectation に書き換え
- Phase 9: takos-app の `/api/deploy/plans` / `/api/deploy/apply-runs` /
  `/api/deploy/rollback` / `group-deployment-snapshots` を完全削除
  (breaking change)
- Phase 10D: GroupHead advance / rollback semantics を `DeploymentService`
  に集約し、resolve → applying → applied / failed / rolled-back の
  status transition と provider operation condition を完成

Implementation:

- `takos deploy` (resolve + apply の sugar)、`takos deploy --preview` /
  `--resolve-only`、`takos apply <deployment-id>`、`takos diff <deployment-id>`、
  `takos approve <deployment-id>`、`takos install`、`takos rollback`、
  `takos uninstall` を canonical lifecycle として test する。
- Deployment record (`Deployment.input` / `Deployment.resolution` /
  `Deployment.desired` / `Deployment.status`) と GroupHead advancement の
  API / CLI behavior を docs と一致させる。
- Git Smart HTTP clone / fetch / push と repository source deploy を smoke test
  に含める。
- Store package install は release-backed deployable package の sugar として
  `takos deploy` pipeline に固定する。
- resource CRUD / access grant / runtime binding の境界を reference docs と
  tests で固定する。

Exit criteria:

- local manifest deploy と repository URL deploy が同じ Deployment lifecycle
  を通り、GroupHead が当該 Deployment を指す。
- `--preview` mode が Deployment record や provider operation を作らないこと、
  `--resolve-only` が `status: "resolved"` の Deployment を返し apply 待機する
  ことを test する。
- rollback が GroupHead を直前 Deployment へ切り替えるだけで新規 Deployment
  を作らないことを test する。
- docs の manifest examples が all-green。
- public API examples が schema / error envelope と一致する。

## M3: Agent GA (status: complete)

Goal: Agent / Chat を kernel feature として production quality にする。

Phase 15 mapping:

- Phase 15: `takos-private/scripts/auth-smoke.ts` で Google OAuth client
  config / takos login flow / PAT issuance / agent run (OpenAI compatible)
  の 4 surface を dry-run / live smoke 両 mode で検証

Implementation:

- Thread / Run state machine、SSE / WebSocket follow、cancel / retry / failure
  propagation を contract test する。
- Rust agent wrapper の OpenAI-compatible configuration を整理する (`model`, API
  key source, base URL, temperature, tool calling behavior)。
- remote tool catalog / execution / cleanup と local skill / memory tool
  intercept の precedence を docs と tests で固定する。
- memory object store の restart continuity、checkpoint / resume、distillation
  lifecycle、overflow-aware retrieval を integration test する。
- usage reporting と billing gate の agent path を verify する。
- no-LLM smoke path は test/support mode として残し、production GA path と docs
  上で混同しないようにする。

Exit criteria:

- clean self-host で thread 作成、run 開始、event stream、tool call、assistant
  message persist、usage record が通る。
- agent container restart 後も同一 thread の memory retrieval が通る。
- invalid / missing API key の user-visible failure が secret を漏らさない。
- OpenAI-compatible endpoint で tool calling の end-to-end smoke が通る。

## M4: Release Hardening (status: complete)

Goal: 1.0 release candidate を切れる品質状態にする。

Phase 16 mapping:

- Phase 16: `cd takos/paas && deno task release-gate` を 17 gate
  (check / test:all / lint / fmt:check / lint:docs / validate-docs /
  docs:build / process-role-validator / validate-architecture-alignment /
  validate-core-conformance / validate-migration-core-coverage /
  composite-resolver-test / validate-helm /
  router-config-smoke:dry-run / runtime-agent-api-smoke /
  release-manifest / paas-smoke) すべて green で完走させる
- `cd takos-private && deno task e2e:smoke:dry-run` を 5 step
  (staging-integration-test / auth-smoke / composite expansion /
  rollback wiring / docs build) すべて success で完走
- `cd takos/paas && deno task docs:deploy` で `docs.takos.jp` を更新

Implementation:

- release candidate branch / tag policy を決める。
- `takos-cli` の installable release artifact を用意する。
- full CI, docs build, plugin-backed self-host smoke, agent smoke を release
  gate にする。
- migration rehearsal を empty DB と previous release DB の両方で実施する。
- public docs へ 1.0 summary と compatibility statement を反映する。
- known limitations と post-1.0 backlog を release notes に明記する。

Exit criteria:

- release gate が連続して green。
- clean install と upgrade install がどちらも成功する。
- 1.0 tag / CLI artifact / docs / release notes が同じ contract を参照する。
- critical / high severity blocker が 0。

## Verification Matrix

| Area       | Required checks                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Deno core  | `deno task test:all`, `deno lint`, `deno fmt --check`, `deno task docs:build`                     |
| Rust agent | `cargo test` for `agent` and `../takos-agent-engine`                                              |
| CLI        | `deno task check`, `deno task test`, `deno task compile`, `deno task lint`, `deno task fmt:check` |
| Self-host  | clean-machine plugin-backed single-node smoke                                                     |
| Agent      | OpenAI-compatible tool-calling smoke and restart/memory smoke                                     |
| Docs       | docs lint, agent-doc lint, public link check where available                                      |

## Operating Rules

- Do not add product implementation workspace config at the ecosystem root.
- Keep deploy docs backend-neutral for manifest authors.
- Keep `takos-private/` as production/staging deploy composition, not as a
  required OSS setup dependency.
- Keep default apps outside the core 1.0 blocker set, but use their manifests as
  external validation fixtures.
- Any public contract change after M0 must update docs and compatibility tests
  in the same change window.
