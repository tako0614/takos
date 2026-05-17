# Operator runbook

## 起動 / 停止

```bash
cd takos/deploy/local-substrate

# 起動 (Pebble + CoreDNS + Caddy。 minica と issuance root を auto-capture)
bash scripts/up.sh

# Postgres profile: Deno+Postgres Takosumi kernel + Accounts + Takos product.
bash scripts/up.sh --profile postgres

# Workers profile: Accounts Worker on D1/R2 + Takosumi kernel Worker on
# D1/R2/Queue/DO. In this profile kernel.takos.test is the Worker endpoint.
bash scripts/up.sh --profile workers

# 停止 (volume は残る)
bash scripts/down.sh

# 停止 + volume も消す (Pebble の issuance root が regen される)
bash scripts/down.sh -v
```

## ホスト初期設定 (一回だけ)

```bash
sudo bash scripts/ca-install.sh         # Pebble issuance root を host trust store に install
sudo bash scripts/configure-dns.sh      # systemd-resolved per-domain split
```

詳細は [root-ca-install.md](root-ca-install.md)。

## よくある障害

### `curl https://hello.takos.test/` が `SSL certificate problem` で失敗

- `caddy/runtime/pebble-issuance-root.pem` が存在するか確認
- `sudo bash scripts/ca-install.sh` を実行
- Pebble を restart した直後は issuance root が変わるので再 install 必須

### `curl: (6) Could not resolve host: hello.takos.test`

- `dig hello.takos.test @127.0.0.1` で CoreDNS 自体が答えているか確認
- 答えていれば systemd-resolved の per-domain split 未設定 → `sudo bash scripts/configure-dns.sh`
- 答えていなければ CoreDNS container が落ちている → `docker compose -f compose.ingress.yml logs coredns`

### Caddy が cert を obtain できない

```bash
docker compose -f compose.ingress.yml logs caddy | grep -i "error\|acme"
```

典型例:

- `caddy/runtime/pebble.minica.pem` が無い → `bash scripts/up.sh` を再実行
- Pebble が起動しきっていない → up.sh の `Waiting for Pebble` ループに任せる
- 新しい hostname を `compose.ingress.yml` の Caddy network alias に追加した直後 →
  `docker compose -f compose.ingress.yml up -d --force-recreate caddy` で Caddy container を作り直す。Caddyfile reload
  だけでは Docker network alias は増えない。

### Caddy admin API への curl が refused

Phase 0 では `127.0.0.1:2019` に bind 済み。 host から:

```bash
curl http://127.0.0.1:2019/config/
```

container 内からは `http://caddy:2019/config/` で接続する。

## 状態確認

```bash
# 全 container の状態
docker compose -f compose.ingress.yml ps

# Pebble 管理 API
curl -sk https://127.0.0.1:15000/dir

# CoreDNS 経由の wildcard 解決
dig random-name.takos.test @127.0.0.1 +short

# Postgres profile kernel + Worker mirror
curl -sk --cacert caddy/runtime/pebble-issuance-root.pem https://kernel.takos.test/health
curl -sk --cacert caddy/runtime/pebble-issuance-root.pem https://kernel-worker.takos.test/healthz

# Workers profile kernel Worker
curl -sk --cacert caddy/runtime/pebble-issuance-root.pem https://kernel.takos.test/healthz
curl -sk --cacert caddy/runtime/pebble-issuance-root.pem https://kernel.takos.test/storage/healthz
```
