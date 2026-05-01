# Operations: Troubleshooting Playbook

> このページでわかること: 実運用 (operator 向け) で頻出する failure シナリオと
> その対処手順。 kernel が返す condition reason を起点に、原因切り分け → 暫定
> 復旧 → 恒久対策の順に書く。

`Deployment.conditions[].reason` の値は
[Condition Reason Catalog](/takos-paas/tests/condition-reason-catalog) が正本で、
ここでは operator が遭遇する代表シナリオに紐付けて手順をまとめる。

## 早見表

| シナリオ | 主な condition reason | 1st action |
| --- | --- | --- |
| Deploy が `AccessPathExternalBoundaryRequiresPolicy` で失敗 | `AccessPathExternalBoundaryRequiresPolicy` | space policy で external boundary を許可、または resource を internal boundary に閉じる |
| Rollback target not found | `RollbackDescriptorUnavailable` / `RollbackArtifactUnavailable` | retention 内の Deployment id を `takos deployments list` で確認 |
| Provider drift detected during canary | `ProviderConfigDrift` / `ProviderStatusDrift` | drift 内容確認 → 手動同期するか、新 Deployment を resolve して上書き |
| Agent disconnected, work stuck | `RuntimeNotReady` / `RuntimeReadinessUnknown` | agent process status 確認 → 再起動 → kernel の readiness 再 probe |
| PAT revoked but still cached | `SecretVersionRevoked` / `ProviderCredentialDenied` | secret version invalidate → kernel cache flush → re-resolve |
| Provider 429 rate limited | `ProviderRateLimited` | retry budget 確認、quota 引き上げ申請、apply を区切って実行 |
| Plan が古くて apply 拒否 | `PlanStale` / `ReadSetChanged` | re-resolve して新しい plan を取り直す |
| Approval pending で先に進まない | `ApprovalRequired` / `ApprovalMissing` | approver に escalation、break-glass が必要なら policy gate に通す |
| Publication が降格して route がない | `PublicationRouteUnavailable` / `PublicationWithdrawn` | producer 側の Deployment を健全化、または consumer 側を再 bind |
| Runtime drain timeout | `RuntimeDrainTimeout` / `RuntimeShutdownFailed` | 旧 runtime の outstanding work 確認 → 強制 shutdown は最後の手段 |
| DB failover 直後に apply が失敗 | `ProviderOperationTimedOut` / `ProviderMaterializationFailed` | kernel の DB connection pool 再初期化 → idempotent retry |
| Composite descriptor が trust 不足で展開不可 | `DescriptorBootstrapTrustMissing` / `DescriptorUntrusted` | trust list に provenance 追加、または signed descriptor を使用 |

## シナリオ別 runbook

### 1. Deploy fails with `AccessPathExternalBoundaryRequiresPolicy`

**症状**: `takos deploy --apply` 実行時、`Deployment.conditions[].reason` に
`AccessPathExternalBoundaryRequiresPolicy` が出て failed に遷移する。

**原因**: resource access path が space の external boundary を超えるが、
boundary を許可する policy が宣言されていない。

**対処**:

1. `takos deployments describe <id>` で `accessPath` の `boundary` 値を確認
2. policy 側で許可するなら space policy に
   `allowedAccessPaths.externalBoundary: true` 等の宣言を追加
3. boundary を超えない設計に変更するなら、resource を internal boundary 配下に
   配置し、別 Deployment へ移動する
4. 再 resolve して `AccessPathExternalBoundaryRequiresPolicy` が消えたことを確認

**恒久対策**: descriptor authoring guide で boundary 設計を review に含める。

---

### 2. Rollback target not found

**症状**: `takos rollback <deploymentId>` で
`RollbackDescriptorUnavailable` または `RollbackArtifactUnavailable` が返る。

**原因**: target Deployment の descriptor / artifact が retention 期間を超えて
削除されている。

**対処**:

1. `takos deployments list --space <space> --include-rolled-back` で
   retention 内 Deployment を列挙
2. 直近 healthy Deployment id を選び、再度 rollback を試す
3. retention 内に該当 Deployment が無い場合は forward fix:
   - 既知の安定版 manifest を `git checkout` して `takos deploy --apply`
   - 同じ output URL を `route` で指して publication を維持

**恒久対策**: `release-gate` の retention check (Phase 17 で追加) を CI に
追加し、retention 切れでの rollback 不可を未然に防ぐ。

---

### 3. Provider drift detected during canary

**症状**: canary deploy 中に `ProviderConfigDrift` /
`ProviderStatusDrift` / `ProviderSecurityDrift` が観測される。

**原因**: provider 側の object が kernel が管理する desired と乖離。
operator が手動で変更したか、別の deploy pipeline が走っている。

**対処**:

1. `takos deployments observe <id> --provider` で観測 diff を確認
2. drift 内容が intentional か確認:
   - intentional → 新 Deployment を resolve して desired を更新
   - unintended → kernel から再 materialize させ、provider 側を desired に戻す
3. canary を正常状態に戻したら、ownership label / annotation を設定して二重
   ownership を防止 (`ProviderOwnershipDrift` 防止)

**恒久対策**: provider 側の手動変更を検出する dashboard と、kernel 経由のみで
更新する CI policy を整備。

---

### 4. Agent disconnected, work stuck

**症状**: takos-agent が割り当てられた work を消化せず、kernel から
`RuntimeNotReady` / `RuntimeReadinessUnknown` が観測される。

**原因**: agent process が crash / network partition / OOM で kernel との
control RPC を維持できない。

**対処**:

1. agent host で `systemctl status takos-agent` (または container logs) を確認
2. crash していれば再起動、network partition なら kernel 側の reachability も
   検査
3. kernel に対して `takos agents readiness <agentId>` で再 probe を要求
4. work が他の agent に再割り当てされない場合、kernel の lease を
   `takos agents reset-lease <agentId>` で expire させる

**恒久対策**: agent の health check に kernel control RPC roundtrip を含める。
OOM 多発の場合は agent の resource budget を引き上げ、または work batch size
を縮小する。

---

### 5. PAT revoked but still cached

**症状**: PAT (personal access token) を revoke 済みだが、apply が
`SecretVersionRevoked` / `ProviderCredentialDenied` を出して失敗、または逆に
古い PAT で provider に到達してしまう。

**原因**: secret resolver の cache が revoke 直後の世代を保持している。

**対処**:

1. `takos secrets describe <secretRef>` で latest version を確認
2. `takos secrets cache:invalidate <secretRef>` を実行 (kernel cache flush)
3. 影響 Deployment に対して `takos deploy --re-resolve` を走らせ、新 version
   が binding に展開されたことを確認
4. provider 側の credential cache (例: Cloudflare API token cache) も別途
   invalidate が必要なケースがある

**恒久対策**: secret rotation を CI に組み込み、rotation 後に必ず影響
Deployment を re-resolve する pipeline を組む。

---

### 6. Provider 429 rate limited

**症状**: 大規模 deploy 中に `ProviderRateLimited` が連続発生し、apply が
進まないかタイムアウトする。

**原因**: provider API の rate limit に到達。バーストする apply 並列度が高い。

**対処**:

1. `takos deployments describe <id>` で retry budget の残り回数を確認
2. retry budget 枯渇前なら kernel の自動 backoff に任せる
3. 枯渇している場合は apply を区切って実行:
   - `takos deploy --apply --batch-size 5`
   - 既に進行中の apply は `takos deployments cancel <id>` で安全に止める
4. provider 側で quota 引き上げを申請

**恒久対策**: deploy pipeline に concurrency cap を入れ、同時 apply 数を
provider quota に合わせて調整する。

---

### 7. Plan stale: `PlanStale` / `ReadSetChanged`

**症状**: `takos deploy --apply` が `PlanStale` / `ReadSetChanged` で拒否
される。

**原因**: resolve 時の read set (descriptor digest / binding artifacts /
policy version) が apply 直前に変化している。

**対処**:

1. `takos deploy --plan` を再実行して新しい Deployment(preview) を作る
2. 差分が想定通りか `takos deployments diff <oldId> <newId>` で確認
3. 問題なければ新しい Deployment id で `takos deploy --apply`

**恒久対策**: 大規模変更を行う際は plan → review → apply の間隔を短く保ち、
descriptor 側の変更を staging 環境で先行させる。

---

### 8. Approval pending: `ApprovalRequired` / `ApprovalMissing`

**症状**: apply が `ApprovalRequired` / `ApprovalMissing` で保留される。

**対処**:

1. `takos deployments approvals list <id>` で必要 approver を確認
2. approver に escalation し、`takos deployments approve <id>` を依頼
3. 緊急対応が必要なら break-glass policy に従い
   `takos deployments break-glass <id> --reason "..."` を実行 (audit trail に
   `BreakGlassRequired` が記録される)

**恒久対策**: approval policy の SLA を明記し、approver 不在時の代理を
明確化する。

---

### 9. Publication route unavailable

**症状**: consumer 側の Deployment が `PublicationRouteUnavailable` /
`PublicationWithdrawn` で degraded になる。

**対処**:

1. producer 側 Deployment の状態を確認 (`takos deployments describe <id>`)
2. producer が unhealthy なら producer の trouble に従って復旧
3. publication が intentionally withdrawn なら consumer 側を別 publication に
   rebind (`PublicationConsumerRebindRequired`)

**恒久対策**: critical publication の health を監視 dashboard に追加し、
withdrawn は事前通知を必須化する。

---

### 10. Runtime drain timeout

**症状**: 旧 runtime の shutdown 中に `RuntimeDrainTimeout` /
`RuntimeShutdownFailed` が発生し、新 runtime への切替が完了しない。

**対処**:

1. 旧 runtime の outstanding work 数を `takos runtimes describe <id>` で確認
2. work が消化中なら drain timeout を延長 (`takos runtimes drain <id>
   --timeout 600s`)
3. 完全停止が必要なら `takos runtimes shutdown <id> --force` (最後の手段、
   inflight work は失われる可能性あり)

**恒久対策**: 長時間 work の最大時間を SLO に組み込み、drain timeout を
work プロファイルに合わせて調整する。

---

### 11. DB failover で apply が一時失敗

**症状**: DB failover 直後に apply が `ProviderOperationTimedOut` /
`ProviderMaterializationFailed` で散発的に失敗する。

**対処**:

1. kernel の DB connection pool が再構築されるまで 30-60s 待機
2. failed Deployment は `takos deploy --apply --retry` で idempotent retry
3. 同じ symptom が連発する場合は kernel pod / process を rolling restart

**恒久対策**: kernel に DB failover 検知 → connection pool 再初期化 hook を
入れる (Phase 20D chaos test で検証済み)。

---

### 12. Descriptor untrusted / bootstrap trust missing

**症状**: composite descriptor を resolve しようとして
`DescriptorBootstrapTrustMissing` / `DescriptorUntrusted` で停止。

**対処**:

1. descriptor の provenance を確認 (`takos descriptors describe <ref>`)
2. trust list に追加して良いなら kernel の trust config を更新
3. 信頼できない場合は signed descriptor を upstream に依頼するか、内部 fork
   を作成して署名し直す

**恒久対策**: descriptor 公開 pipeline に署名を必須化、trust list の管理を
audit に組み込む。

## エスカレーション

- 30 分以内に復旧見込みが立たない場合: incident channel に連絡し、影響範囲
  (space / tenant / publication consumer) を共有する
- audit trail (`Deployment.conditions[]` 履歴 + ProviderObservation) を保全
- post-mortem template に従って原因 / 暫定 / 恒久を記録

## 関連ドキュメント

- [Condition Reason Catalog](/takos-paas/tests/condition-reason-catalog)
- [Architecture Diagrams](/architecture/diagrams)
- [Deploy: Troubleshooting (manifest validation)](/deploy/troubleshooting) —
  manifest 入力エラーはこちら
- [Performance Baseline](/performance/baseline)
