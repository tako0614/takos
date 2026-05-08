# Operations: Capacity Planning Baseline

> このページでわかること: Takos operated environments の現 traffic baseline、 1
> 年 growth forecast、headroom 計算、capacity review cadence。

この baseline は Takos managed installation GA readiness (Phase 1.x in
ROADMAP.md Part II) 用です。Kernel orchestration の実測値は
[Performance Baseline](/performance/baseline) を参照します。このページでは Takos
product 全体の運用 capacity floor と、telemetry が集まり始めた後の
更新ルールを固定します。

Takos の主要 customer surface は Web/API です。Takos CLI を primary capacity
surface として扱わず、developer / operator CLI traffic は `takosumi` /
`takosumi-git` 側の API call として capacity review に含めます。

## Current Traffic Baseline

As of 2026-05-07, Takos managed production is pre-GA. Customer production
traffic baseline is therefore 0 customer RPS. Capacity planning uses:

- current internal / staging validation signals
- in-process kernel benchmark from `docs/performance/baseline.md`
- launch floor assumptions for the first public managed environment

| Surface                     | Current measured production traffic |         Planning floor for launch | Source                                             |
| --------------------------- | ----------------------------------: | --------------------------------: | -------------------------------------------------- |
| Takos Web/API read traffic  |                      0 customer RPS |                       50 RPS peak | pre-GA baseline + launch floor                     |
| Takos Web/API write traffic |                      0 customer RPS |                       10 RPS peak | pre-GA baseline + launch floor                     |
| Git Smart HTTP traffic      |                      0 customer RPS |                       20 RPS peak | pre-GA baseline + launch floor                     |
| Deploy plan/resolve         |                      0 customer RPS |                        5 RPS peak | kernel API bench supports > 500 RPS target         |
| Deploy apply                |              0 customer applies/min |               30 applies/min peak | provider RPC bound; throttle below provider limits |
| Runtime-agent work queue    |               0 customer work items |           500 queued / 100 active | launch floor                                       |
| Default app routed traffic  |                      0 customer RPS | 50 RPS peak per default app class | launch floor                                       |

The launch floor is intentionally higher than current traffic so the first GA
environment does not need immediate capacity resizing.

## One-year Forecast

Forecast horizon: 12 months after public managed launch.

Assumptions:

- monthly peak traffic growth: 15 %
- traffic concentration: top 10 % of tenants can produce 60 % of requests
- deploy traffic grows slower than read traffic but has higher tail latency
- default apps can burst independently of control-plane deploy traffic

Formula:

```text
forecast_peak = max(current_peak, launch_floor) * 1.15^12
required_capacity = forecast_peak * 2.0 headroom
```

`1.15^12` is approximately `5.35`. The `2.0` multiplier reserves room for
regional failover, noisy tenants, and traffic spikes.

| Surface                     |   Launch floor | 12-month forecast peak | Required headroom capacity |
| --------------------------- | -------------: | ---------------------: | -------------------------: |
| Takos Web/API read traffic  |         50 RPS |                268 RPS |                    536 RPS |
| Takos Web/API write traffic |         10 RPS |                 54 RPS |                    108 RPS |
| Git Smart HTTP traffic      |         20 RPS |                107 RPS |                    214 RPS |
| Deploy plan/resolve         |          5 RPS |                 27 RPS |                     54 RPS |
| Deploy apply                | 30 applies/min |        161 applies/min |            322 applies/min |
| Runtime-agent active work   |     100 active |             535 active |               1,070 active |
| Default app routed traffic  | 50 RPS / class |        268 RPS / class |            536 RPS / class |

## Sizing Baseline

| Component                | Initial floor               | Scale trigger                                 | Headroom rule                                  |
| ------------------------ | --------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `takos-app` Web/API      | 2 instances per region      | p95 latency > target for 30 min or CPU > 60 % | keep N+1 instance capacity                     |
| `takos-git`              | 2 instances per region      | queue / request p95 > target or CPU > 60 %    | isolate Git Smart HTTP from Web/API            |
| Takosumi API             | 2 instances per region      | deploy plan p95 > target or 5xx > 1 %         | keep deploy plan below 50 % of tested capacity |
| Takosumi worker          | 2 workers per region        | WAL backlog or outbox age above target        | workers can double without DB saturation       |
| Runtime-agent pool       | 2 agents per provider class | active work > 60 % of cap for 15 min          | keep one provider-agent failure domain spare   |
| Postgres / durable store | managed HA tier             | connection pool > 70 % or storage > 65 %      | provision 90 days storage runway               |
| Object/artifact storage  | provider managed            | storage growth > forecast for 7 days          | lifecycle policy reviewed monthly              |

Conservative per-instance safe capacity for planning:

| Component                        |                Safe capacity used for planning | Evidence / limit                                      |
| -------------------------------- | ---------------------------------------------: | ----------------------------------------------------- |
| Takosumi deploy plan/resolve API |                             500 RPS / instance | Phase 20C target, below 3,556 RPS loopback result     |
| Takosumi concurrent resolve      |                       50 concurrent / instance | `docs/performance/baseline.md` scaling recommendation |
| Takosumi concurrent apply        |                       20 concurrent / instance | provider RPC bound; keep under provider limits        |
| Takos Web/API                    | 250 RPS / instance until real telemetry exists | launch floor, conservative web/API planning value     |
| Takos Git Smart HTTP             | 100 RPS / instance until real telemetry exists | isolate from Web/API and revisit after staging k6     |
| Runtime-agent active work        |                   50 active work items / agent | launch floor; provider class can override lower       |

## Headroom Checks

Capacity review uses these queries / signals:

- Web/API RPS and p95 latency
- Git Smart HTTP RPS and p95 latency
- deploy operation count and apply latency
- rollback latency and failure count
- runtime-agent active leases, queue depth, and stale heartbeat count
- DB CPU, connection pool, lock wait, and storage growth
- object/artifact storage growth
- per-tenant top-N usage concentration

Minimum acceptable headroom:

| Resource                  | Warning                         | Action                                            |
| ------------------------- | ------------------------------- | ------------------------------------------------- |
| CPU                       | sustained > 60 %                | add capacity or reduce concurrency                |
| Memory                    | sustained > 70 %                | add capacity / inspect leaks                      |
| DB connections            | sustained > 70 %                | add pool capacity or reduce worker fan-out        |
| Storage                   | > 65 % used or < 90 days runway | expand storage / tighten retention                |
| Runtime-agent active work | > 60 % cap                      | add agents or split provider class                |
| Deploy apply p95          | above SLO for 30 min            | inspect provider latency / throttle / add workers |

Required capacity is calculated per surface:

```text
design_peak = max(current_30d_p95_peak, launch_floor) * growth_multiplier * burst_multiplier
instance_count = ceil(design_peak / per_instance_safe_capacity)
headroom_ratio = provisioned_safe_capacity / design_peak
```

Release blocker thresholds:

- Web/API and Git read/write surfaces: `headroom_ratio < 2.0`
- Background workers and runtime-agent pools: `headroom_ratio < 1.5`
- DB / object storage: less than 30 days projected runway
- Any single tenant can consume more than 50 % of available regional capacity

## Review Cadence

- Weekly during pre-GA / first 30 days after GA.
- Monthly once traffic is stable.
- Immediately after SEV-1 / SEV-2 incidents involving saturation.
- Before enabling a new default app or provider target.
- Before major pricing / quota changes.

Each review updates this page or records why the baseline remains valid.

## Update Rule

When managed production telemetry exists, replace the pre-GA current traffic row
with observed 30-day p95 peak values. Keep the forecast formula stable unless
product planning explicitly changes the growth assumption.

Do not use single-day spikes as the baseline. Use 30-day p95 peak and record the
largest single-day spike separately as stress evidence.
