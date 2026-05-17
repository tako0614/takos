# local-substrate

`*.takos.test` の DNS / TLS / ingress / OIDC / kernel deploy / cloud emulator を すべて 1 つの docker network
で完結させる cloud-independent test bed。

既存 `takos/compose.local.yml` (postgres + redis + takos-app の軽量 dev) と `takos/deploy/{docker,helm,terraform,...}`
(operator-owned distribution artifact) に並ぶ第 3 の deploy 形態で、 「public network 依存ゼロで full deploy path
を踏む」 ことが唯一の存在意義。

Linux native 前提 (systemd-resolved / Docker daemon)。 macOS / WSL / native Windows は対象外。

## Phases

| Phase | scope                                                                                       | DoD                                                                          |
| ----- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 0     | Pebble (ACME staging) + CoreDNS + Caddy で `*.takos.test` を local TLS termination          | `curl https://hello.takos.test/` が 200                                      |
| 1     | takosumi kernel + Accounts + takos 製品 を同 stack に統合                                   | OIDC discovery 解決 + `POST /v1/deployments` 成功                            |
| 2     | LocalStack / k3d / fake-gcs / Azurite / miniflare を `compose.emulators.yml` 1 本で並行統合 | `scripts/smoke.sh` 全 cloud fixture が pass                                  |
| 3     | factory で endpoint override + Caddy admin route registrar + 公開面 deny 多重防御           | dynamic subdomain が deploy 直後に hit する + `prove-no-public-leak.sh` pass |

現在 Phase 0–3 まで実装済み。`scripts/smoke.sh` は canonical `POST /v1/deployments` path も含めて検証する。

## Current smoke coverage (38 checks)

`scripts/smoke.sh` のチェック一覧 — 「smoke green = deploy しても 99% 動く」 を目標に、 honest pass のみを数える。 各
ファイル詳細は [TODO-SMOKE.md](TODO-SMOKE.md) と script header を参照。

| 範疇            | 件数 | 代表 check                                                                                                  |
| --------------- | ---: | ----------------------------------------------------------------------------------------------------------- |
| ingress         |    4 | `hello.tls`, `accounts.oidc-discovery`, `kernel.healthz`, `takos.healthz`                                   |
| prod-mirror     |   10 | `prod-mirror.{landing,docs,cloud.*,takos.*,yurucommu.*}`                                                    |
| install flow    |    3 | `install.preview`, `install.materialize`, `install.uninstall`                                               |
| OAuth           |    3 | `oauth.e2e`, `oauth.csrf-replay`, `oauth.tls-negative`                                                      |
| tenant          |    1 | `tenant.isolation` (cross-subject installation read must fail)                                              |
| docs            |    1 | `docs.link-check` (one-hop link audit across 4 docs surfaces)                                               |
| passkey         |    1 | `passkey.e2e` (register + authenticate with virtual P-256)                                                  |
| kernel deploy   |    1 | `kernel.deploy.e2e` (full POST /v1/deployments manifest path)                                               |
| federation      |    2 | `federation.infra`, `federation.follow` (reachability + strict Follow → Accept exchange)                    |
| workers         |    1 | `workers.cli-smoke` (Accounts Worker D1 health / R2 signed-route + kernel Worker D1/R2/Queue/DO on workerd) |
| route-registrar |    1 | `registrar.alive` (kernel → Caddy admin sync via internal network)                                          |
| takos-private   |    1 | `private.lint` (yaml/compose syntax across all manifests)                                                   |
| object store    |    1 | `minio.roundtrip` (mb → put → get → sha256 round-trip)                                                      |
| bundled apps    |    1 | `bundled.apps` (5 advertised .takosumi/app.yml resolvable)                                                  |
| migrations      |    1 | `migration.idempotency` (Accounts Worker D1 restart preserves schema byte-identical)                        |
| otel            |    1 | `otel.pipeline` (synthetic OTLP trace lands in Jaeger)                                                      |
| k6 perf         |    1 | `k6.baseline` (20 RPS × 20s with `p(95)<50ms` install_preview + `<30ms` oidc — regression watch, NOT SLO)   |
| mailpit         |    1 | `mailpit` (SMTP catcher reachable + probe email delivered)                                                  |
| stripe          |    1 | `stripe.webhook.e2e` (HMAC verify + idempotency + tolerance)                                                |
| public-leak     |    1 | `prove-no-public-leak.sh` (separate script — DNS / ACME / network egress audit)                             |

加えて vitest 4 case (COSE/JWK decode) + worker_test.ts 30 case (issuer policy + IPv6/CGNAT + fail-closed + R2
route-level signed export / malformed URL / data-bearing refusal) + Playwright 2 spec (install wizard happy path + TLS
trust regression) を CI で並列実行する。

CI workflow は ecosystem-root の `.github/workflows/local-substrate-smoke.yml` を参照。 3 job (smoke / vitest /
playwright) が submodule checkout 経由で takos + takosumi-cloud + yurucommu を同時に揃え、 ca-install.sh の sudo run +
Pebble root の NSS install を含めた full chain を毎 PR で再現する。

## Quick start

```bash
cd takos/deploy/local-substrate

# Phase 0: ingress only (Pebble + CoreDNS + Caddy)
bash scripts/up.sh

# Phase 1+: substrate (kernel + accounts + takos-app + takos-git +
# route-registrar) on top of Phase 0 ingress
bash scripts/up.sh --profile postgres

# Worker-first substrate mirror: Accounts Worker on D1/R2 plus Takosumi
# kernel Worker on D1/R2/Queue/DO. Here kernel.takos.test is the Worker.
bash scripts/up.sh --profile workers

# one-time per host
sudo bash scripts/ca-install.sh
sudo bash scripts/configure-dns.sh

# verify
bash scripts/smoke.sh
bash scripts/prove-no-public-leak.sh
curl https://hello.takos.test/
curl https://accounts.takos.test/.well-known/openid-configuration
curl https://kernel-worker.takos.test/healthz  # postgres profile mirror
curl https://kernel.takos.test/healthz         # workers profile
```

詳細は [docs/root-ca-install.md](docs/root-ca-install.md) と [docs/operator-runbook.md](docs/operator-runbook.md)。

## ファイル layout

```
takos/deploy/local-substrate/
├── README.md
├── docs/
│   ├── architecture.md
│   ├── root-ca-install.md
│   ├── operator-runbook.md
│   └── browser-test-playbook.md
├── compose.ingress.yml          # Pebble + CoreDNS + Caddy
├── compose.substrate.yml        # kernel + accounts + takos-app + takos-git + route-registrar
├── compose.emulators.yml        # opt-in: localstack, k3d
├── caddy/
│   ├── Caddyfile
│   └── runtime/                 # up.sh が生成 (gitignored)
├── coredns/
│   ├── Corefile
│   └── zones/{takos.test.zone, deny-letsencrypt.zone}
├── pebble/pebble-config.json
├── factories/
│   └── local-substrate-factories.ts   # 公開 DNS provider import-time deny
├── wrappers/
│   ├── kernel-with-embedded-agent.ts  # postgres profile kernel + agent in-process
│   └── takosumi-kernel-worker-runner.mjs # local-only Miniflare D1/R2/Queue/DO runner
├── route-registrar/
│   ├── deno.json
│   └── mod.ts                   # poll kernel → patch Caddy admin API
├── fixtures/manifest.*.yml
└── scripts/
    ├── up.sh
    ├── down.sh
    ├── ca-install.sh
    ├── configure-dns.sh
    ├── smoke.sh
    └── prove-no-public-leak.sh
```

## Browser trust (Chrome / Firefox 上で `.test` を踏める状態にする)

Pebble は毎回 root CA を再生成するので、 ホストの trust store にも、 Chrome / Firefox の NSS DB にも root
を入れる必要がある。 `ca-install.sh` は両方を一括で処理する:

```bash
sudo bash deploy/local-substrate/scripts/ca-install.sh
```

実行後の手動確認 checklist:

- [ ] Chromium / Chrome を完全終了 (タスクトレイ含む) → 再起動 → `https://takos.test/` で privacy error が出ないこと
- [ ] 同じく `https://cloud.takosumi.test/` が緑鍵で開くこと
- [ ] Firefox (snap か deb どちらでも) を再起動 → 同様に確認
- [ ] `scripts/up.sh` で Pebble を再起動した場合は root が rotation されているので、 `sudo bash scripts/ca-install.sh`
      を再実行 + ブラウザ再起動

`certutil` が無い場合 `sudo` ありで実行すれば `libnss3-tools` を 自動 install する。 非 sudo で実行すると system trust
は skip、 NSS DB のみ更新する (NSS は per-user)。

最後に手動 verification した日付を以下に記録:

| 日付     | Chrome | Firefox (snap) | 確認者 | 環境 | メモ                                                                                                                                       |
| -------- | ------ | -------------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| _未確認_ | _-_    | _-_            | _-_    | _-_  | _CI (.github/workflows/local-substrate-smoke.yml) で毎 PR 自動実行されている (smoke + dashboard-ui-playwright job)。 ローカル目視は別途要_ |

CI で自動検証されるパス:

- ecosystem-root の `.github/workflows/local-substrate-smoke.yml`
  - `smoke` job: `up.sh → sudo bash scripts/ca-install.sh → bash scripts/smoke.sh`
  - `dashboard-ui-playwright` job: 同 install + Playwright が **`ignoreHTTPSErrors=false`** で Chromium が Pebble 経由の
    cert を NSS DB から validate するかを assert
  - `dashboard-ui-vitest` job: COSE/JWK unit test

ローカル目視は dev iteration の中で実行し、 上記 table に行追加して commit する。

## 制約

- **公開面は絶対に出さない**: ACME は Pebble 固定、 DNS は CoreDNS 固定、 emulator は内部 network。 Phase 3 で多重防御
  guard と `prove-no-public-leak.sh` を追加
- **実 cloud compute は credentials で叩いてよい**: emulator 無し compute (Fargate / Cloud Run / Container Apps /
  Cloudflare Container) は `.env` に credentials を入れた場合に限り real cloud を呼ぶ。 default では factory が register
  せず "provider not configured" で fail させる
- **upstream `takosumi/` は変更しない**: connector の endpoint override は takos 側の factory wrapper で吸収する
