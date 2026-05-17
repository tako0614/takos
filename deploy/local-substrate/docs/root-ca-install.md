# Root CA install + DNS split (Linux native)

`https://*.takos.test` を Pebble-issued cert で local termination するため、 host に 2 つの設定を一回だけ入れる:

1. Pebble issuance root を host trust store に追加 (curl / chrome / firefox が緑鍵で verify するため)
2. systemd-resolved を `*.takos.test → 127.0.0.1` で per-domain split (host から CoreDNS に流すため)

両方とも対応 script があるので、 `up.sh` 後に下記を一回流せばよい:

```bash
sudo bash scripts/ca-install.sh
sudo bash scripts/configure-dns.sh
```

## 手で確認したい場合

### Pebble issuance root の install

```bash
# up.sh が capture した root を確認
file caddy/runtime/pebble-issuance-root.pem

# host trust store に install
sudo cp caddy/runtime/pebble-issuance-root.pem \
  /usr/local/share/ca-certificates/takos-local-substrate-pebble.crt
sudo update-ca-certificates
```

Pebble は restart のたびに issuance root を regenerate するので、 stack を 完全に tear down (`docker compose down -v`)
した後に再起動した場合は `ca-install.sh` を再実行する。 既存の `.crt` は上書きされる。

### systemd-resolved per-domain split

```bash
sudo tee /etc/systemd/resolved.conf.d/takos-local-substrate.conf <<'EOF'
[Resolve]
DNS=127.0.0.1
Domains=~takos.test
EOF

sudo systemctl restart systemd-resolved
```

`~takos.test` の leading tilde は 「`takos.test` で終わるクエリ **のみ** この DNS server に送る」 の意。 他の DNS
解決は通常の path を踏むので WAN 解決が壊れない。

設定を解除する場合は config を消して resolved を再起動する:

```bash
sudo rm /etc/systemd/resolved.conf.d/takos-local-substrate.conf
sudo systemctl restart systemd-resolved
```

## 検証

```bash
# CoreDNS が答えているか
dig hello.takos.test @127.0.0.1 +short
# → 127.0.0.1 が返る

# Pebble-issued cert で TLS termination されているか
curl -v https://hello.takos.test/ 2>&1 | grep "subject"
# → CN=hello.takos.test とその chain が表示される

# trust が通っているか (curl が -k 無しで成功するか)
curl https://hello.takos.test/
# → "hello from local-substrate (Phase 0)" が返る
```
