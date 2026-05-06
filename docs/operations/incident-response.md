# Operations: Incident Response Runbook

> このページでわかること: Takos operated environments で incident を宣言し、
> war room を立て、mitigation / customer comms / RCA / postmortem を進める
> 標準手順。

この runbook は [On-call and SEV Policy](/operations/oncall) の実行手順です。
SEV 判断、paging、escalation は on-call policy を正本とし、このページでは
incident 開始後の進め方、記録形式、RCA template、postmortem cadence を固定
します。

## Trigger

Incident response を開始する条件:

- SEV-1 / SEV-2 が宣言された
- customer data exposure / data loss / secret exposure の疑いがある
- deploy rollback が失敗し、customer impact が継続している
- SLA breach が medium 以上で検知され、誤検知と断定できない
- support 経由の customer report が monitoring と矛盾し、影響範囲が不明

不明な場合は incident として開始します。false positive は postmortem ではなく
alert tuning action として閉じます。

## War Room Setup

Incident commander は 5 分以内に war room を作ります。

Naming:

```text
#inc-YYYYMMDD-short-slug
```

Pinned header:

```text
SEV: SEV-<1|2|3>
State: detecting | acknowledged | mitigating | monitoring | resolved
Start: YYYY-MM-DD HH:mm TZ
Incident commander:
Primary on-call:
Comms owner:
Affected services:
Affected regions:
Known customer impact:
Current mitigation owner:
Next update due:
```

War room の最初の 10 分で決めること:

1. SEV level と scope
2. customer-visible impact の有無
3. writes / deploy / background jobs を止めるか
4. rollback / traffic shift / feature flag / credential disablement の候補
5. customer update の初回時刻

## Lifecycle

| State | Entry condition | Exit condition |
| --- | --- | --- |
| detecting | alert or report received | incident commander が SEV / scope を確認 |
| acknowledged | operator が実インシデントとして扱う | mitigation owner が決まり、行動開始 |
| mitigating | active mitigation in progress | recovery signal が出る、または別 mitigation に切替 |
| monitoring | customer impact は止まったが再発監視中 | 2 observation windows green |
| resolved | impact が解消し、follow-up owner が割り当て済み | postmortem / action tracking へ移行 |

State transition は timeline に残します。Kernel incident API が使える環境では
同じ state を incident record に反映します。

## First 15 Minutes

1. Acknowledge page and open war room.
2. Declare initial SEV and scope.
3. Freeze non-essential deploys for affected service set.
4. Assign:
   - incident commander
   - mitigation owner
   - investigation owner
   - communications owner
5. Capture current signals:
   - HTTP 5xx / latency
   - deploy success / rollback metrics
   - runtime-agent heartbeat / queue backlog
   - database / queue / object storage health
   - recent deploys and config / secret rotations
6. Pick the least risky mitigation and write the decision in the channel before
   executing it.

## Mitigation Priority

Prefer reversible actions in this order:

1. stop new writes / deploys for the affected path
2. rollback to a known healthy deployment
3. route traffic away from a bad runtime / region
4. disable a feature flag or integration
5. drain or restart affected runtime-agent pools
6. rotate / revoke compromised credentials
7. apply a forward fix

Forward fixes are allowed for SEV-1 only when rollback is impossible or clearly
slower than a small, reviewed fix. Record the reviewer and rollback plan before
shipping.

## Customer Communications

SEV-1:

- initial customer/status update within 15 minutes
- update every 15 minutes until monitoring state
- final update after resolution

SEV-2:

- initial update within 30 minutes when customer-visible
- update every 30 minutes or on material state change
- final update if customers were notified

Customer updates must include impact and next update time. Do not include raw
stack traces, secret names, provider account ids, private channel links, or
unconfirmed root cause.

## Timeline Format

Every material event is recorded as:

```text
HH:mm TZ - actor - event - evidence/link - decision/next action
```

Examples:

```text
10:03 JST - primary - page acknowledged - alert deploy-success-rate-low - SEV-2 declared
10:09 JST - mitigation owner - rollback started - deployment dep_123 -> dep_120 - monitoring apply latency
10:18 JST - comms - status update posted - status page incident inc_456 - next update 10:33
```

## RCA Template

Use this template for SEV-1 and qualifying SEV-2 incidents.

```md
# Incident RCA: <title>

## Summary

- SEV:
- Start:
- End:
- Duration:
- Affected services:
- Affected customers / tenants:
- Customer impact:

## Detection

- How was it detected:
- Detection time:
- Ack time:
- Detection gap:

## Timeline

| Time | Actor | Event | Evidence | Decision |
| --- | --- | --- | --- | --- |

## Root Cause

What failed:

Why it failed:

Why existing controls did not prevent it:

## Mitigation and Recovery

- Mitigation actions:
- Rollback / forward-fix details:
- Recovery signal:
- Time to recovery:

## Customer Communication

- Initial update time:
- Update cadence:
- Final update:

## Action Items

| Action | Owner | Due | Severity | Verification |
| --- | --- | --- | --- | --- |

## Classification Review

- Was SEV correct:
- Should alerts / thresholds change:
- Should runbooks change:
```

## Postmortem Cadence

| Incident | Draft due | Review due | Action review |
| --- | --- | --- | --- |
| SEV-1 | 2 business days | 5 business days | weekly until all critical actions closed |
| SEV-2 with customer impact > 30 min | 5 business days | 10 business days | biweekly |
| SEV-2 rollback failure / data risk | 3 business days | 7 business days | weekly |
| SEV-3 | not required unless recurring | incident commander decides | normal backlog |

Postmortem review is blameless and focuses on system changes. Action items must
have a single owner, a due date, and a verification method.

## Closure Checklist

- incident state is `resolved`
- affected metrics are green for two observation windows
- deploy freeze is lifted or explicitly extended
- customer final update is sent when applicable
- RCA owner is assigned
- action items are filed and linked
- monitoring / alert tuning gaps are captured
- runbook gaps are captured

Do not close a SEV-1 without a named RCA owner and postmortem date.
