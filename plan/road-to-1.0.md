# Road to Takos 1.0

この文書は Takos core の 1.0 OSS GA に向けた内部計画の正本です。1.0 の対象は
`takos/` と `takos-cli/` です。`agent/` agent service は core
に含めます。default apps は検証 fixture / example として扱い、1.0 blocker
にはしません。

この roadmap は gate-driven です。固定公開日は置かず、各 milestone の exit
criteria を満たした時点で次へ進みます。

## 1.0 Definition

Takos 1.0 は、外部ユーザーが OSS checkout から single-node production self-host
を立ち上げ、CLI で login / repo / deploy / rollback / uninstall を行い、Agent /
Thread / Run を production feature として利用できる状態です。

1.0 で互換性を約束する public surface:

- deploy manifest: `.takos/app.yml` / `.takos/app.yaml`
- CLI: auth / endpoint / deploy / install / rollback / uninstall / group /
  resource / thread / run
- REST API: public docs に載せる route と common error envelope
- Agent runtime: Thread / Run lifecycle、Rust agent、skill resolution、remote
  tool execution、local memory tools、run events、usage reporting

1.0 で production target とする hosting:

- single-node production self-host
- PostgreSQL / Redis / S3-compatible object storage
- TLS / reverse proxy は operator が前段で提供する
- Cloudflare は reference backend として維持する

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

## M0: Contract Freeze

Goal: 1.0 の compatibility boundary を固定し、以後の実装がぶれない状態にする。

Implementation:

- `docs/reference/manifest-spec.md` と parser contract を照合し、flat manifest
  schema を 1.0 canonical contract として固定する。
- CLI public help に出す command を auth / endpoint / deploy / install /
  rollback / uninstall / group / resource / thread / run に揃える。
- REST API reference の public route と internal RPC route を明確に分離する。
- `README.md`, `LICENSE`, `CLA.md`, package metadata の license 表記を 1.0
  方針に合わせる。
- `plan/docs-alignment/target-model.md` とこの文書の語彙を揃える。

Exit criteria:

- docs lint が public deploy terminology の drift を検出できる。
- CLI help snapshot または equivalent test が public command surface
  を固定する。
- manifest examples が parser / CLI / API contract test で検証される。
- 1.0 compatibility statement の draft がある。

## M1: OSS Self-Host GA

Goal: private repository に依存せず、OSS checkout だけで single-node production
self-host を再現できるようにする。

Implementation:

- `takos/` に public single-node production guide を整備する。
- secret generation command / procedure を docs に固定し、placeholder secret を
  production unsafe として fail-fast または warning できるようにする。
- PostgreSQL / Redis / S3-compatible storage の required config を整理する。
- migrations from empty DB と previous schema の手順を固定する。
- backup / restore / upgrade / rollback notes を self-host docs に追加する。
- local smoke と production-like single-node smoke を分ける。

Exit criteria:

- clean machine で self-host stack が起動する。
- user / space 作成、CLI login、repo clone/push、simple worker deploy、
  preview、rollback、uninstall が通る。
- `takos-private/` なしで public docs の手順が完結する。
- production unsafe defaults が docs と runtime guard の両方で明示される。

## M2: Deploy / Git / API GA

Goal: deploy kernel と Git-native workflow を 1.0 public surface
として安定化する。

Implementation:

- `takos deploy`, `takos deploy --plan`, `takos install`, `takos rollback`,
  `takos uninstall` を canonical lifecycle として test する。
- group deployment snapshot、inventory、rollback、uninstall の API / CLI
  behavior を docs と一致させる。
- Git Smart HTTP clone / fetch / push と repository source deploy を smoke test
  に含める。
- Store package install は release-backed deployable package の sugar として
  `takos deploy` pipeline に固定する。
- resource CRUD / access grant / runtime binding の境界を reference docs と
  tests で固定する。

Exit criteria:

- local manifest deploy と repository URL deploy が同じ group snapshot lifecycle
  を通る。
- non-mutating `--plan` が DB row / deployment artifact を作らないことを test
  する。
- docs の manifest examples が all-green。
- public API examples が schema / error envelope と一致する。

## M3: Agent GA

Goal: Agent / Chat を kernel feature として production quality にする。

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

## M4: Release Hardening

Goal: 1.0 release candidate を切れる品質状態にする。

Implementation:

- release candidate branch / tag policy を決める。
- `takos-cli` の installable release artifact を用意する。
- full CI, docs build, self-host smoke, agent smoke を release gate にする。
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
| Self-host  | clean-machine single-node smoke                                                                   |
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
