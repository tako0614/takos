# Takos 専任から統合への引継ぎ — 2026-09-30

Takos 全体の GA は未完了。この引継ぎは source と実環境の証拠を分ける。
配置・課金・権限変更・削除の許可は追加しない。

## 担当と保護した作業

- Takos 専任: この `dev/takos-ga-20260930-1737` branch と専用 worktree。
- 主担当: Takoserver、共通契約、最終統合。Takosumi と yuru family は別担当。
- 元 `/root/dev/takos/takos` の chat/feed/model/tool-label の未commit差分は読んで
  境界を確認した。コピー、stage、commit、reset はしていない。
- 旧 adapter/notifier/install 等の worktree は採用・完了・削除可能と判断していない。
- 主の `/root/hdd/takos-dev/handoffs/takos-ga-owner-20260930.md`、control の
  `docs/handoff/product-sessions-20260930/{README,takos}.md` と
  `docs/quality/product-maturity-work-20260930.md` を読んだ。
  control のローカル文書を Git 同期済みとは扱わない。

## 今回の source 成果

開始 HEAD `43b5fe68` は古かったため、remote readback で確認した main
`1da7a7d0e5e3d6a0c552cd29976c0fc9abe9105b` を専用 branch へ統合した。
元 checkout は変更していない。

- `e71164fd0`: Node SSE の replay 正本を永続 timeline に統一。
  notifier 再起動・ring eviction 後の履歴と terminal cursor を復旧し、通知は
  永続履歴の再読込を起こす。2000件の page と client pull で読み込みを制限し、
  terminal/error/disconnect 時に subscription と timer を解放する。
- `de7708852`: 現行 main を統合。upstream の全 portable-test discovery を維持。
- `8fb9a25b9`: install CTA の複数行 shell 表示を契約テストで正規化。
  完全なコマンド引数と順序の検査は維持する。
- 配置文書: 通常の OpenTofu module、optional disposable bridge、Takos 所有の
  production entrypoint の担当を明記。`--vectorize` は index 作成、`--apply` は
  Worker upload と Container 反映、`--containers` は読み戻し。
  container-enabled DO bootstrap はこの二つの phase では補えず、optional bridge の
  別途 bootstrap と container-ready namespace の読み戻し、live 資格確認が残る。

検証の詳細は [SSE task ledger](TASK-takos-ga-sse-recovery-20260930.md)。
現行 code commit `8fb9a25b90c00f7eaa4753d9b646ca6f729ecdd5` の `bun run check`
は Bun 1.4.0 で成功した。1316 Bun tests、20 OpenTofu mock-plan tests、全 declared
format/drift/schema/static/type/architecture/build phase が通過。
既存 ledger の lint 112件、TypeScript 98件は残るが、未申告 diagnostic は0件。
配置文書変更後の `bun run docs:build` も成功。独立 Sol review で具体的な
P1/correctness P2 は指摘されなかった。remote CI、release、deploy の証拠ではない。

## 製品の確認 journey

既存 owning contract に基づく受入候補。製品全体の新しい共通 GA gate ではない。
Worker が Thread/history/Run/tool operation/checkpoint/lease の正本を持ち、
container は run-scoped executor、engine は library とする。

| Journey | 必要な source 契約と受入候補 | 今確認した証拠 / 残る確認 |
| --- | --- | --- |
| Login | `identity.oidc`、同一 browser state/nonce/PKCE、Accounts の実 client と session | `node-resolver-oidc.integration.test.ts` は模擬 OIDC。実 Accounts login/client grants 未確認 |
| Workspace → Thread | DB/session と space access、`POST /api/spaces/:spaceId/threads` | public API の local proof source はある。live owner session での作成は未確認 |
| Thread → Run | `agentContainers` capability、固定 model、DB と versioned `RUN_QUEUE`、executor dispatch と terminal status | `agent-proof.test.ts` 等の component tests。現在の artifact に結び付いた queue/container 実行は未確認 |
| MCP admission | `mcp.server/2025-11-25`、declared/resolved endpoint、streamable-http、現在の Ready Principal binding と `mcp.invoke` | runtime-interface/exposure tests。live Interface/Binding revision、tools/list と tools/call は未確認 |
| Tool safety | Worker catalog/schema/policy と correlated operation ledger、side effect の不確定 outcome は再実行しない | `idempotency-uncertain.test.ts` 等。実 remote backend での proof は未確認 |
| Checkpoint → executor replacement | lease-CAS checkpoint、protocol v2、inline 上限超過時 `TAKOS_OFFLOAD`。旧 executor を止め、新 lease が prior checkpoint から再開する | `executor-control-rpc-checkpoint.test.ts` は保存/lease turnover/uncertain/R2 を検査。container 中断から再開までの統合 E2E は未確認 |
| 観測と復旧 | 永続 timeline の cursor replay、terminal closure、実 binding/resource/image/version readback、監視と復旧 | 今回 SSE 15 tests を追加・確認。実 Redis/offload、負荷、alert、restore drill は未確認 |

正本: [runtime service](../docs/architecture/runtime-service.md)、
[Thread/Run](../docs/platform/threads-and-runs.md)、
[managed Interfaces](../docs/deploy/runtime-interfaces.md)。
`scripts/local-agent-proof.ts` の bootstrap identity は実 OIDC login の証拠ではない。
`scripts/first-install-functional-proof.ts` の存在と mock test 成功も、実行成功ではない。

## 必要な graph と統合待ち

[product-resources.json](../deploy/product-resources.json) は provider-neutral な
製品要求であり、published Form refs や Host admission の証明ではない。
現在の唯一の install module は `deploy/opentofu/cloudflare`。
Cloudflare provider `= 5.19.1`、OpenTofu `>= 1.5`、Worker compatibility date
`2026-04-01` は source 宣言。稼働先の資格確認ではない。

| 製品要求 | 正確な runtime binding / 契約 | 残存作業と owner |
| --- | --- | --- |
| Worker・DB・session・KV | `DB` (`sql.binding.v1`)、`SESSION_DO` (`stateful.binding.v1`)、`HOSTNAME_ROUTING` (`keyvalue.binding.v1`) | Takos は adapter/consumer を所有。Host上は主が選んだ exact Form/Binding と backend lifecycle/readback が必要 |
| Object storage | `WORKER_BUNDLES`、`TENANT_BUILDS`、`TENANT_SOURCE`、`GIT_OBJECTS`、`TAKOS_OFFLOAD` (`object.binding.v1`) | 共通 object primitive の資格は主。checkpoint/offload consumer と復旧は Takos |
| Queues/DLQ/schedules | `RUN_QUEUE`、`INDEX_QUEUE`、`TAKOS_NOTIFICATION_PUSH_QUEUE` (`queue.binding.v1`)、3組の Queue/DLQ、2 Schedule | source graph と queue handler は Takos。exact delivery/retry/DLQ/schedule backend の実 lifecycle は主との integration 待ち |
| Stateful service | `RUN_NOTIFIER`、`NOTIFICATION_NOTIFIER`、`RATE_LIMITER_DO`、`ROUTING_DO` (`stateful.binding.v1`) | Actor/DO の exact admission と HTTP/WSS/storage/restart proof が必要。Takos専用Host分岐は追加しない |
| Executor | `EXECUTOR_CONTAINER`、`EXECUTOR_CONTAINER_TIER2`、`EXECUTOR_CONTAINER_TIER3` (`service.binding.v1`) | Container backend の exact lifecycle/route/image/health は主との integration 待ち。Takos は control RPC/checkpoint/lease と consumer を所有 |
| Semantic retrieval | `VECTORIZE` (`vector.binding.v1`) と embedding model | current native provider gap と Host Vector backend は別。無い場合の disabled は source 契約であり完全機能の証拠ではない |
| Identity/UI/MCP | manifest `takosumi.com/v2.4`、`identity.oidc` callback `/auth/oidc/callback`、launcher `interface.ui.surface@1` + `ui.open`/none、MCP `mcp.server/2025-11-25` + `mcp.invoke`/none または supported oauth2 | Accounts/InterfaceBinding の実 readback は Takosumi owner と連携。既存 scope/delivery の解釈や権限を変更しない |

OIDC scopes は `openid profile email offline_access capsules:read capsules:write`。
runtime secret 名は `ENCRYPTION_KEY`、`TAKOS_AGENT_START_TOKEN`、
`TAKOS_INTERNAL_API_SECRET`、`PLATFORM_PRIVATE_KEY`、`PLATFORM_PUBLIC_KEY`。
値は読まず、作成・更新していない。

Takoserver への現在の具体的な source は、Provider `= 4.0.0` の opt-in
[fetch tracer](../deploy/opentofu/takoserver-fetch-tracer/README.md)。対象は
`takoform_module_worker`、`takoform_worker_bundle`、`takoform_worker_version`、
`takoform_worker_deployment`、`takoform_worker_endpoint` の5 resources と
`edge.forms.takoform.com` の discovery identity。実行時の definitionVersion /
schemaDigest は exact readback で固定する。fetch-only、`fullRuntime: false` であり、
これを製品の full graph、Actor、Vector、Container の実行証拠へ拡張しない。

**主への提案:** 上記 graph に対応する現行 published Form/Interface/Binding の
exact package closure と対象 backend を選定し、足りない契約は中央で決定する。
Takos側にはその closure を使う full-runtime adapter/consumer qualification が残る。
version と schemaDigest の未選定を「Hostが未対応」と断定しない。解除には、その exact
closure の admit/activate readback と create/update/delete、HTTP/WSS、復旧の runtime proof
を必要とする。自製品内 source/UX/docs はこの待ちと独立に進める。

## 短期 engine 成果と次の独立作業

`ga-takos-agent-engine-20260930` の `src/engine/session_engine.rs` を照合済み。
base `0a1216b22d8d175c0735dadef54573eadc252d2a` に62行の履歴 regression test追加。
runtime/API は変更しない。差分 SHA-256 は SSE ledger に記録した。
未commitの候補を別 worktree で保持し、コピーや重複実装はしていない。
短期worker報告の focused 1/1 と rustfmt は引継ぎ証拠であり、今回の full gate ではない。

Takos image の engine source pin は `containers/agent/engine-source.json` の
`c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d`。
その pin から候補 base までの committed diff は4つの文書だけだった。
`scripts/release-artifact-deploy.ts` は exact pin を fetch して image context を作る。
最新 main という理由だけで pin を変更しない。Rust library full gate、wrapper の
consumer check、mock-LLMを含む実行境界の qualification は別に残る。

次の独立作業は、engine候補の isolated qualification、wrapper と Worker を通した
中断後再開の local proof、Node SSE の subscriber/history 規模別容量確認。
通常の Node executor event は一秒 polling に依存し、一部通知だけが即 wakeup する。
offload/DO read の subscriber 数に応じた負荷を GA 解除済みとは扱わない。
native/mobile、remote CI、published/deployed identity、実 user journey、監視/復旧は未検証。
