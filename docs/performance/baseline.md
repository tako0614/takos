# Performance Baseline Metrics (Phase 20C)

Takos PaaS deploy lifecycle の in-process performance baseline。Phase 20C
で計測。`takos/paas/scripts/load-test/` の Deno スクリプトと
`k6-load-test.js` を用いて計測した結果をまとめる。

## 計測環境

- Runtime: Deno (`deno task load-test`)
- Storage: `InMemoryDeploymentStore` (Map ベース、network round-trip なし)
- Provider adapter: `SYNTHETIC_PROVIDER_ADAPTER` (常時成功、cloud round-trip なし)
- Transport: kernel-api-bench は `Deno.serve` + 同 isolate からの loopback `fetch`
- Concurrency model: `Promise.all` で fan-out
- Reference machine: Linux x86_64, single Deno process / single isolate
- Date of run: 2026-04-30

`scripts/load-test/load-test-results.json` と
`scripts/load-test/kernel-api-bench-results.json` に raw data
を出力する。再実行で値は微変動する。

## ターゲット値 (Phase 20C SLO)

| 指標                                               | ターゲット      | 備考                                    |
| -------------------------------------------------- | --------------- | --------------------------------------- |
| `resolveDeployment` p50 (in-process)               | < 50 ms         | 単一 deployment、N=10                  |
| `applyDeployment` p50 (in-process)                 | < 200 ms        | synthetic provider adapter             |
| HTTP API throughput (POST /deployments resolve)    | > 500 req/sec   | loopback / single isolate              |
| Cloudflare Workers CPU time per resolve (100 comp) | < 30,000 ms     | Workers Free / Paid 上限 (CPU time)    |
| HTTP error rate (real env, k6)                     | < 1 %           | k6 thresholds                           |
| HTTP p95 latency (real env, k6)                    | < 500 ms        | k6 thresholds                           |

## 計測結果 (in-process)

### 1. concurrent-deploys-test (resolveDeployment / applyDeployment)

`Promise.all` で N 並行リクエストを発行、各 op の latency と全体 throughput
を集計。

| Tier | Op      | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Max (ms) | Throughput (ops/sec) |
| ---: | ------- | -------: | -------: | -------: | --------: | -------: | -------------------: |
|   10 | resolve |     3.86 |     8.87 |    10.31 |      4.31 |    10.67 |               934.87 |
|   10 | apply   |     1.65 |     1.75 |     1.82 |      1.67 |     1.84 |             5,314.74 |
|  100 | resolve |    15.92 |    30.25 |    32.18 |     15.77 |    32.67 |             3,058.01 |
|  100 | apply   |     9.07 |     9.08 |     9.08 |      9.07 |     9.09 |            10,963.62 |
| 1000 | resolve |   102.75 |   212.00 |   222.84 |    105.80 |   226.52 |             4,409.50 |
| 1000 | apply   |    92.47 |    92.52 |    92.53 |     92.45 |    92.53 |            10,788.75 |

判定:

- p50 resolve (N=10) **3.86 ms** (target < 50 ms) — 達成
- p50 apply   (N=10) **1.65 ms** (target < 200 ms) — 達成
- N=1000 でも resolve p50 < 110 ms に収まる
- apply は in-process synthetic adapter のため latency が小さく `Promise.all`
  fan-out のオーバーヘッドが支配的

### 2. Cloudflare Workers CPU budget (resolveDeployment)

複合 manifest で `compute` × N + `routes` × N の resolve 時間を計測。

| Component count | Duration (ms) | Cloudflare Workers 上限 (30,000 ms) |
| --------------: | ------------: | ----------------------------------- |
|              10 |          2.91 | OK (約 0.01 % 消費)                 |
|              50 |          3.02 | OK (約 0.01 % 消費)                 |
|             100 |          6.18 | OK (約 0.02 % 消費)                 |

判定: 100 component の manifest でも Workers CPU time 30s 制限の
**0.02 % 未満**で完了する。Workers 上で resolveDeployment を直接走らせて
も実用上問題ない。

### 3. kernel-api-bench (HTTP loopback)

`Deno.serve` + 同 isolate からの `fetch`。auth / catalog hash assertion を
bypass した kernel-only handler で計測。

| Endpoint                                | Requests | Concurrency | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/sec) | Errors |
| --------------------------------------- | -------: | ----------: | -------: | -------: | -------: | -------------------: | -----: |
| POST /deployments (preview, warmup)     |      100 |          16 |     5.62 |    19.56 |    20.21 |             1,955.02 |      0 |
| POST /deployments (preview)             |    1,000 |          32 |     8.58 |    13.35 |    31.52 |             3,346.28 |      0 |
| POST /deployments (resolve)             |      500 |          16 |     4.18 |     6.41 |     6.92 |             3,556.35 |      0 |
| GET  /deployments/:id                   |    2,000 |          32 |     3.19 |     4.58 |     6.27 |            10,390.12 |      0 |

判定:

- POST resolve throughput **3,556 req/sec** (target > 500 req/sec) — 達成
- GET throughput **10,390 req/sec** — 達成
- p95 < 50 ms (loopback、auth bypass)
- 0 errors

## ターゲット環境別 latency 目安 (推定)

in-process baseline + cloud transport overhead から推定した、実環境での
deploy lifecycle latency 目安。

| Target            | resolveDeployment p50 | applyDeployment p50 | 備考                                 |
| ----------------- | --------------------: | ------------------: | ------------------------------------ |
| Cloudflare Workers |              ~10-20 ms |          ~2-5 sec[^1] | KV / DO round-trip + provider RPC    |
| AWS (Lambda + RDS) |              ~30-60 ms |          ~5-15 sec[^1] | RDS connection + provider API        |
| GCP (Cloud Run)    |              ~30-50 ms |          ~5-10 sec[^1] | Cloud SQL + provider API             |
| Kubernetes (in-cluster) |          ~5-15 ms |          ~3-8 sec[^1] | Postgres in-cluster + kubectl apply |
| Self-hosted        |              ~5-10 ms |          ~3-10 sec[^1] | local Postgres + provider RPC       |

[^1]: `applyDeployment` の latency は provider 側の materialize 時間が支配的
で、kernel orchestration cost (in-process baseline) は ~100ms 以下に収まる。
real cloud では Workers / Lambda / Cloud Run の deploy / route attach に
数秒-数十秒かかる。

> in-process baseline は **kernel orchestration cost のみ**を表す。real env
> での baseline は operator が k6-load-test.js を staging 環境で再測定し、
> このドキュメントに追記すること。

## Scaling 推奨値

in-process baseline + 業務想定 throughput から導いた scaling 指針。

| 項目                              | 推奨値                  | 根拠                                                     |
| --------------------------------- | ----------------------- | -------------------------------------------------------- |
| kernel concurrent resolveDeployment | 50 / instance          | N=100 で resolve p95 30 ms、CPU bound                     |
| kernel concurrent applyDeployment | 20 / instance           | provider RPC 待ちが支配、IO bound                         |
| DB connection pool (Postgres)     | 20-50 / kernel instance | per-deployment 1 transaction + outbox dispatch          |
| Outbox dispatch worker            | 4-8 / instance          | downstream DLQ replication が IO bound                   |
| Provider adapter retry budget     | 3 retries / op          | Phase 17A retry policy と整合                             |

## k6 load test (real env、operator 用)

`takos/paas/scripts/load-test/k6-load-test.js` を staging / production-mirror
で実行する。

```bash
k6 run \
  -e TAKOS_PAAS_BASE_URL=https://paas-staging.example.test \
  -e TAKOS_PAAS_TOKEN=$TAKOS_TOKEN \
  -e TAKOS_PAAS_SPACE_ID=space_bench \
  takos/paas/scripts/load-test/k6-load-test.js
```

ramp profile:

- 0:00-0:30  → 10 VUs
- 0:30-1:30  → 25 VUs
- 1:30-3:00  → 50 VUs
- 3:00-4:30  → 100 VUs
- 4:30-5:00  → 0 VUs (ramp-down)

thresholds (失敗するとexit code != 0):

- `http_req_duration` p95 < 500 ms
- `http_req_failed` < 1 %
- `takos_endpoint_errors` < 1 %
- `checks` > 99 %

混在 mix:

- 55 % POST /deployments (preview)
- 30 % POST /deployments (resolve) → GET /deployments/:id round-trip
- 15 % POST /deployments (resolve)

`k6-load-test-summary.json` に summary が出力される。

## 再実行手順

```bash
cd takos/paas
deno task load-test                    # in-process 全 scenario
deno task load-test:concurrent-deploys # 並行 deploy 単体
deno task load-test:kernel-api-bench   # HTTP API 単体
```

real env (k6) は operator が cluster-scoped credentials で実行。Takos
core repo に値を commit しない。

## Phase 20C 判定サマリ

| Acceptance criterion                          | 結果       |
| --------------------------------------------- | ---------- |
| resolveDeployment p50 < 50 ms (N=10)          | **OK** (3.86 ms) |
| applyDeployment p50 < 200 ms (N=10)           | **OK** (1.65 ms) |
| HTTP API throughput > 500 req/sec             | **OK** (3,556 req/sec) |
| Cloudflare Workers CPU < 30s (100 component)  | **OK** (6.18 ms) |
| `deno task load-test` 完走                    | **OK**           |
| in-process test 2 + k6 script 1               | **OK**           |
| baseline-metrics.md 完成                      | **OK**           |

operator 残務: real cloud 環境で k6 を走らせて p95/p99 を測定し、本ドキュ
メントの「ターゲット環境別 latency 目安」表を実値で上書きする。
