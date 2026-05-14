# local-substrate

`*.takos.test` の DNS / TLS / ingress / OIDC / kernel deploy / cloud emulator を
すべて 1 つの docker network で完結させる cloud-independent test bed。

既存 `takos/compose.local.yml` (postgres + redis + takos-app の軽量 dev) と
`takos/deploy/{docker,helm,terraform,...}` (operator-owned distribution
artifact) に並ぶ第 3 の deploy 形態で、 「public network 依存ゼロで full
deploy path を踏む」 ことが唯一の存在意義。

Linux native 前提 (systemd-resolved / Docker daemon)。 macOS / WSL / native
Windows は対象外。

## Phases

| Phase | scope | DoD |
|---|---|---|
| 0 | Pebble (ACME staging) + CoreDNS + Caddy で `*.takos.test` を local TLS termination | `curl https://hello.takos.test/` が 200 |
| 1 | takosumi kernel + Accounts + takos 製品 を同 stack に統合 | OIDC discovery 解決 + `POST /v1/deployments` 成功 |
| 2 | LocalStack / k3d / fake-gcs / Azurite / miniflare を `compose.emulators.yml` 1 本で並行統合 | `scripts/smoke.sh` 全 cloud fixture が pass |
| 3 | factory で endpoint override + Caddy admin route registrar + 公開面 deny 多重防御 | dynamic subdomain が deploy 直後に hit する + `prove-no-public-leak.sh` pass |

現在 Phase 0–3 まで実装済み (kernel db_migrations 由来の `POST /v1/deployments` 500
は upstream 側で別途修正待ち)。

## Quick start

```bash
cd takos/deploy/local-substrate

# Phase 0: ingress only (Pebble + CoreDNS + Caddy)
bash scripts/up.sh

# Phase 1+: substrate (kernel + accounts + takos-app + takos-git +
# route-registrar) on top of Phase 0 ingress
bash scripts/up.sh --profile postgres

# one-time per host
sudo bash scripts/ca-install.sh
sudo bash scripts/configure-dns.sh

# verify
bash scripts/smoke.sh
bash scripts/prove-no-public-leak.sh
curl https://hello.takos.test/
curl https://accounts.takos.test/.well-known/openid-configuration
```

詳細は [docs/root-ca-install.md](docs/root-ca-install.md) と
[docs/operator-runbook.md](docs/operator-runbook.md)。

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
│   └── kernel-with-embedded-agent.ts  # local source kernel + agent in-process
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

## 制約

- **公開面は絶対に出さない**: ACME は Pebble 固定、 DNS は CoreDNS 固定、
  emulator は内部 network。 Phase 3 で多重防御 guard と
  `prove-no-public-leak.sh` を追加
- **実 cloud compute は credentials で叩いてよい**: emulator 無し compute
  (Fargate / Cloud Run / Container Apps / Cloudflare Container) は `.env` に
  credentials を入れた場合に限り real cloud を呼ぶ。 default では factory が
  register せず "provider not configured" で fail させる
- **upstream `takosumi/` は変更しない**: connector の endpoint override は
  takos 側の factory wrapper で吸収する
