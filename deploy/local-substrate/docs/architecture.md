# local-substrate architecture

## 三層の責務

| 層                | 担当 container | 役割                                                                                                                              |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **ingress**       | `caddy`        | `*.takos.test` の TLS termination + reverse proxy。 Caddy admin API (`:2019`) で動的に route 追加可能                             |
| **TLS authority** | `pebble`       | ACME staging server。 Caddy に対して cert を issue。 ACME directory は `https://pebble:14000/dir`、 management API は `:15000`    |
| **DNS**           | `coredns`      | `*.takos.test → 127.0.0.1` の wildcard zone。 `selfhost-coredns` provider が動的に zone file へ append 可能な形に揃える (Phase 3) |

## TLS chain of trust

```
host trust store
  └── pebble issuance root          (up.sh が capture, ca-install.sh が install)
        └── certs Pebble issues to Caddy   (browser/curl が verify)

caddy/runtime/pebble.minica.pem      (up.sh が pebble container から cp)
  └── Pebble HTTPS endpoint cert     (Caddy が ACME directory を信頼する根)
```

Pebble は restart のたびに issuance root を regenerate するので、 stack を tear down してから再起動した場合は `up.sh`
後に `ca-install.sh` を再実行する。

## DNS path

```
host curl                     container (e.g. Pebble)
   │                                │
   ▼                                ▼
 systemd-resolved              docker embedded DNS (127.0.0.11)
   │ ~takos.test                    │ hello.takos.test → caddy IP (alias)
   ▼                                ▼
 CoreDNS @127.0.0.1:53        (Phase 1+ で CoreDNS を upstream にもする)
   │ takos.test zone
   ▼
 127.0.0.1 → published port → caddy:443
```

host のクエリは systemd-resolved の per-domain split で CoreDNS に流す。 container 内のクエリは Docker network alias
を最優先で解決する。 Phase 3 で 動的 subdomain を扱う際は CoreDNS を Docker network の upstream DNS にも 据える。

## Docker network 設計

Phase 0–2 では単一 bridge network `takos-local-internal`。 Phase 3 で:

- `takos-local-internal` — emulator / Caddy / CoreDNS / Pebble / kernel / accounts / takos-app / Miniflare Worker
  mirrors。 `internal: true` で外向き禁止
- `takos-local-egress` — 実 cloud compute (Fargate / Cloud Run / …) を呼ぶ runtime-agent のみ join。 default gateway
  経由で外向き可

これにより「実 cloud に出る path は runtime-agent からだけ」 を物理層で 保証する。
