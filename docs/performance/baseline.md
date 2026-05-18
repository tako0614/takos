# パフォーマンスベースライン

> このページでわかること: Takosumi のデプロイ処理のベンチマーク結果。

`takos/scripts/load-test/` のスクリプトで計測したインプロセスのパフォーマンスベースラインです。

## 計測環境

- ランタイム: Deno (`deno task load-test`)
- ストレージ: `InMemoryDeploymentStore` (Map ベース、ネットワーク往復なし)
- プロバイダーアダプター: `SYNTHETIC_PROVIDER_ADAPTER` (常時成功、クラウド往復なし)
- トランスポート: kernel-api-bench は `Deno.serve` + 同 isolate からの loopback `fetch`
- 並行モデル: `Promise.all` でファンアウト
- 参考マシン: Linux x86_64、Deno プロセス 1 / isolate 1
- 計測日: 2026-04-30

raw データは `scripts/load-test/load-test-results.json` と
`scripts/load-test/kernel-api-bench-results.json` に出力されます。再実行で値は微変動します。

## ターゲット値

| 指標                                               | ターゲット      | 備考                                    |
| -------------------------------------------------- | --------------- | --------------------------------------- |
| `resolveDeployment` p50 (in-process)               | < 50 ms         | 単一 deployment、N=10                   |
| `applyDeployment` p50 (in-process)                 | < 200 ms        | synthetic provider adapter              |
| HTTP API スループット (installer dry-run)          | > 500 req/sec   | loopback / single isolate               |
| Cloudflare Workers CPU 時間 / resolve (100 component) | < 30,000 ms  | Workers Free / Paid 上限 (CPU time)     |
| HTTP エラー率 (実環境、k6)                          | < 1 %           | k6 threshold                            |
| HTTP p95 latency (実環境、k6)                       | < 500 ms        | k6 threshold                            |

## 計測結果 (in-process)

### 1. concurrent-deploys-test (resolveDeployment / applyDeployment)

`Promise.all` で N 並行リクエストを発行し、各操作の latency と全体スループットを集計します。

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
- p50 apply (N=10) **1.65 ms** (target < 200 ms) — 達成
- N=1000 でも resolve p50 < 110 ms に収まる
- apply は in-process な synthetic adapter のため latency が極めて小さく、`Promise.all`
  のファンアウトオーバーヘッドが支配的

### 2. Cloudflare Workers CPU バジェット (resolveDeployment)

複合 manifest で `compute` × N + `routes` × N の resolve 時間を計測しています。

| component 数    | 所要 (ms)     | Cloudflare Workers 上限 (30,000 ms) |
| --------------: | ------------: | ----------------------------------- |
|              10 |          2.91 | OK (約 0.01 % 消費)                 |
|              50 |          3.02 | OK (約 0.01 % 消費)                 |
|             100 |          6.18 | OK (約 0.02 % 消費)                 |

判定: 100 component の manifest でも Workers CPU time 30 秒制限の
**0.02 % 未満** で完了します。Workers 上で resolveDeployment を直接走らせても
実用上の問題はありません。

### 3. kernel-api-bench (HTTP loopback)

`Deno.serve` + 同 isolate からの `fetch` で計測します。
auth / catalog hash assertion を bypass した kernel-only handler を使用します。

| Endpoint                                           | Requests | Concurrency | p50 (ms) | p95 (ms) | p99 (ms) | Throughput (req/sec) | Errors |
| -------------------------------------------------- | -------: | ----------: | -------: | -------: | -------: | -------------------: | -----: |
| POST /v1/installations/dry-run (warmup)            |      100 |          16 |     5.62 |    19.56 |    20.21 |             1,955.02 |      0 |
| POST /v1/installations/dry-run                     |    1,000 |          32 |     8.58 |    13.35 |    31.52 |             3,346.28 |      0 |
| POST /v1/installations/{id}/deployments/dry-run    |      500 |          16 |     4.18 |     6.41 |     6.92 |             3,556.35 |      0 |
| POST /v1/installations/{id}/deployments            |    2,000 |          32 |     3.19 |     4.58 |     6.27 |            10,390.12 |      0 |

判定:

- deployment dry-run スループット **3,556 req/sec** (target > 500 req/sec) — 達成
- deployment apply スループット **10,390 req/sec** — 達成
- p95 < 50 ms (loopback、auth bypass)
- エラー 0 件

## ターゲット環境別の latency 目安 (推定)

in-process ベースライン + クラウド側トランスポートのオーバーヘッドから推定した、
実環境での deploy lifecycle latency 目安です。

| ターゲット              | resolveDeployment p50 | applyDeployment p50    | 備考                                |
| ----------------------- | --------------------: | ---------------------: | ----------------------------------- |
| Cloudflare Workers      |             ~10-20 ms | ~2-5 秒[^1]            | KV / DO 往復 + provider RPC         |
| AWS (Lambda + RDS)      |             ~30-60 ms | ~5-15 秒[^1]           | RDS 接続 + provider API             |
| GCP (Cloud Run)         |             ~30-50 ms | ~5-10 秒[^1]           | Cloud SQL + provider API            |
| Kubernetes (in-cluster) |              ~5-15 ms | ~3-8 秒[^1]            | Postgres in-cluster + kubectl apply |
| Self-hosted             |              ~5-10 ms | ~3-10 秒[^1]           | ローカル Postgres + provider RPC    |

[^1]: `applyDeployment` の latency は provider 側の materialize 時間が支配的で、
kernel オーケストレーションのコスト (in-process baseline) は ~100 ms 以下に収まります。
実環境のクラウドでは Workers / Lambda / Cloud Run のデプロイ / route attach に
数秒~数十秒かかります。

> in-process ベースラインは **kernel オーケストレーションのコストのみ** を表します。
> 実環境でのベースラインは operator が k6-load-test.js を staging で再測定し、
> このドキュメントに追記してください。

## スケーリング推奨値

in-process ベースラインと業務想定スループットから導いたスケーリング指針です。

| 項目                                  | 推奨値                  | 根拠                                              |
| ------------------------------------- | ----------------------- | ------------------------------------------------- |
| kernel の同時 resolveDeployment       | 50 / instance           | N=100 で resolve p95 30 ms、CPU bound             |
| kernel の同時 applyDeployment         | 20 / instance           | provider RPC 待ちが支配、IO bound                 |
| DB コネクションプール (Postgres)      | 20-50 / kernel instance | デプロイあたり 1 トランザクション + outbox dispatch |
| Outbox dispatch worker                | 4-8 / instance          | 下流の DLQ レプリケーションは IO bound            |
| Provider adapter のリトライ予算       | 3 / op                  | provider のリトライポリシーと整合                 |

## k6 ロードテスト (実環境、operator 用)

`takos/scripts/load-test/k6-load-test.js` を staging / production-mirror 環境で実行します。

```bash
k6 run \
  -e TAKOSUMI_BASE_URL=https://takosumi-staging.example.test \
  -e TAKOSUMI_TOKEN=$TAKOS_TOKEN \
  -e TAKOSUMI_SPACE_ID=space_bench \
  takos/scripts/load-test/k6-load-test.js
```

ramp プロファイル:

- 0:00-0:30 → 10 VUs
- 0:30-1:30 → 25 VUs
- 1:30-3:00 → 50 VUs
- 3:00-4:30 → 100 VUs
- 4:30-5:00 → 0 VUs (ramp-down)

threshold (失敗時 exit code != 0):

- `http_req_duration` p95 < 500 ms
- `http_req_failed` < 1 %
- `takos_endpoint_errors` < 1 %
- `checks` > 99 %

トラフィックミックス:

- 55 % POST /v1/installations/dry-run
- 30 % POST /v1/installations/{id}/deployments/dry-run → POST /v1/installations/{id}/deployments
- 15 % POST /v1/installations/{id}/deployments/dry-run

サマリは `k6-load-test-summary.json` に出力されます。

## 再実行手順

```bash
cd takos
deno task load-test                    # in-process 全シナリオ
deno task load-test:concurrent-deploys # 並行 deploy 単体
deno task load-test:kernel-api-bench   # HTTP API 単体
```

実環境 (k6) は operator が cluster-scoped credentials で実行します。
Takos core repo に値を commit しないでください。

## 判定サマリ

| 受け入れ基準                                  | 結果       |
| --------------------------------------------- | ---------- |
| resolveDeployment p50 < 50 ms (N=10)          | **OK** (3.86 ms) |
| applyDeployment p50 < 200 ms (N=10)           | **OK** (1.65 ms) |
| HTTP API スループット > 500 req/sec           | **OK** (3,556 req/sec) |
| Cloudflare Workers CPU < 30s (100 component)  | **OK** (6.18 ms) |
| `deno task load-test` 完走                    | **OK**           |
| in-process テスト 2 + k6 スクリプト 1         | **OK**           |
| baseline-metrics.md 完成                      | **OK**           |

operator 残務: 実環境のクラウドで k6 を走らせて p95 / p99 を測定し、
本ドキュメントの「ターゲット環境別の latency 目安」表を実測値で上書きしてください。
