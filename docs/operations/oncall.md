# Operations: On-call and SEV Policy

> このページでわかること: Takos operated environments の on-call rotation、SEV
> 分類、paging path、escalation matrix、staging SEV-1 simulation の実施基準。

この runbook は Takos product の運用正本です。Takosumi kernel の signal contract
は `takosumi/docs/reference/observability-stack.md` と
`takosumi/docs/reference/incident-model.md` を参照し、Takos 側では誰がいつ受け、
どの順序で判断・連絡・復旧するかを固定します。

## Scope

対象は Takos operated environments の `takos-app` / `takos-git` / `takos-agent`
/ `takosumi` / default apps です。Self-hosted operator は同じ SEV vocabulary
を使えますが、paging provider、担当者、customer comms は各 operator
が所有します。

Takos は基本 Web/API surface として運用します。CLI は operator/debug 補助で
あり、customer-facing primary UX ではありません。Takosumi CLI は manifest deploy
engine の explicit manifest path を扱うだけで、Takos product の incident command
surface にはしません。

## Roles

| Role                 | Owner                             | Responsibility                                      |
| -------------------- | --------------------------------- | --------------------------------------------------- |
| Primary on-call      | current rotation owner            | alert ack、初動 triage、mitigation owner            |
| Secondary on-call    | next rotation owner               | primary 不応答時の引き継ぎ、並行調査、rollback 承認 |
| Incident commander   | primary または指名された operator | SEV 宣言、war room、timeline、decision log          |
| Communications owner | support / product owner           | customer update、status page、support ticket sweep  |
| Subject-matter owner | service owner                     | deep dive、fix owner、postmortem action owner       |

Primary と secondary は同じ timezone / failure domain に置かないことを目標に
します。rotation handoff は 週次、handoff window は月曜 10:00 JST、祝日や
長期不在がある場合は前営業日までに secondary を primary に昇格します。

## SEV Classification

| SEV   | Customer impact                                                                                               | Examples                                                                                                                 | Ack target      | Update cadence              |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- | --------------------------- |
| SEV-1 | production-wide outage、data loss risk、security-critical exposure、deploy / login / repo access の大規模停止 | `takos-app` 全体 5xx、auth unavailable、Git Smart HTTP 全停止、known secret leak、cross-tenant data exposure             | 5 min           | 15 min                      |
| SEV-2 | single region / major feature degradation、複数 tenant 影響、workaround あり                                  | deploy apply が大半で timeout、runtime-agent queue backlog、billing / profile の write failure、default app の広範囲障害 | 15 min          | 30 min                      |
| SEV-3 | isolated tenant / non-critical degradation、operational toil、customer-visible but bounded issue              | single tenant deploy failure、docs / dashboard drift、slow background job、minor default app issue                       | 1 business hour | daily or on material change |

SEV は下げるより上げる判断を優先します。影響範囲が不明な production alert は
SEV-2 以上として開始し、customer data exposure の可能性がある場合は 調査完了まで
SEV-1 として扱います。

## Paging Path

1. Alert fires from Takos-managed monitoring: HTTP 5xx / latency SLO、deploy
   success rate、SLA breach、runtime-agent heartbeat、database / queue health、
   secret rotation failure。
2. Paging provider routes to primary on-call. Primary は ack target 内に
   acknowledge し、incident channel を開く。
3. Primary が ack しない場合、paging provider は 5 分後に secondary、さらに 10
   分後に incident commander backup / product owner へ escalate する。
4. SEV-1 / SEV-2 は incident record を作る。自動検知済み incident がある場合
   はその incident に attach し、なければ operator-declared incident として
   作成する。
5. Communications owner は SEV-1 で 15 分以内、SEV-2 で 30 分以内に customer
   update の要否を判断する。

## Escalation Matrix

| Trigger                              | Primary action                         | Escalate to secondary                     | Escalate to service owner        | Escalate to product / legal |
| ------------------------------------ | -------------------------------------- | ----------------------------------------- | -------------------------------- | --------------------------- |
| SEV-1 declared                       | immediate page + war room              | immediately                               | immediately for affected service | within 15 min               |
| SEV-2 declared                       | page primary                           | no ack after 15 min or unclear mitigation | no mitigation path after 30 min  | customer update needed      |
| Security / secret exposure suspected | page primary + freeze affected path    | immediately                               | security owner immediately       | immediately                 |
| Data integrity risk                  | stop writes if safe, preserve evidence | immediately                               | storage / app owner immediately  | within 15 min               |
| Failed deploy rollback               | start rollback SOP                     | rollback blocked after 15 min             | deploy / kernel owner            | if customer impact persists |
| Runtime-agent backlog                | drain / redistribute work              | no improvement after 30 min               | agent owner                      | if deploy SLA breached      |

## Incident Command Procedure

1. Declare SEV and appoint incident commander.
2. Open war room with `#inc-<date>-<slug>` naming and pin:
   - SEV level
   - start time
   - affected services / regions / tenants
   - customer-visible impact
   - current mitigation owner
3. Freeze non-essential deploys for affected services.
4. Capture timeline events every material change: alert, ack, mitigation
   attempt, rollback, customer update, recovery signal.
5. Prefer reversible mitigation: rollback, traffic shift, feature flag off,
   queue drain pause, credential disablement, dependency failover.
6. Resolve only when monitoring is green for two consecutive observation windows
   and no new customer impact is reported.

## Handoff

Rotation handoff must include:

- open incidents and pending postmortems
- active deploy freezes / rollback windows
- degraded SLOs or noisy alerts
- secret rotation / migration / release promotion tasks in progress
- known customer escalations and support ticket links

Primary cannot hand off an active SEV-1 without an explicit synchronous handoff
in the incident channel.

## SEV-1 Staging Simulation

Takos managed installation GA readiness (Phase 1.x in ROADMAP.md Part II)
requires at least one SEV-1 simulation in staging. The simulation is not a
production outage and must not page customers.

Required scenario:

1. Pick a staging-only failure injection:
   - block `takos-app` health route,
   - force deploy apply failure,
   - stop one runtime-agent pool,
   - or inject a database read-only error.
2. Confirm alert fires and routes to primary on-call.
3. Primary acknowledges within 5 minutes.
4. Incident commander opens a staging incident channel and records timeline.
5. Execute mitigation or rollback and confirm recovery signal.
6. Write simulation record with:
   - date / time
   - injected failure
   - alert id
   - ack latency
   - mitigation action
   - recovery time
   - follow-up actions

Takos-operated private environments record the evidence in `takos-private` run
logs. Public docs must not contain secret names, provider account ids, customer
identifiers, or private incident links.

## Postmortem Requirement

SEV-1 always requires a postmortem. SEV-2 requires one when customer impact
lasts more than 30 minutes, rollback fails, data integrity is involved, or
manual operator action was the only mitigation.

Postmortem must include:

- customer impact summary
- exact timeline
- root cause and contributing factors
- detection gap
- mitigation / recovery actions
- action items with owner and due date
- whether the SEV classification was correct

Postmortem review happens within 5 business days for SEV-1 and 10 business days
for qualifying SEV-2.
