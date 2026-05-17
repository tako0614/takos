# Browser test playbook (claude-in-chrome)

Manually reproducible end-to-end test of the local-substrate's user-facing flows from the host's Chrome via the
claude-in-chrome MCP. CI automation is out of scope for the current plan; this playbook is the audit trail.

## Prerequisites

```bash
cd takos/deploy/local-substrate
bash scripts/up.sh --profile postgres
# Or use the Worker-first mirror where kernel.takos.test is the Takosumi
# kernel Worker on D1/R2/Queue/DO:
# bash scripts/up.sh --profile workers
sudo bash scripts/ca-install.sh         # trust Pebble issuance root
sudo bash scripts/configure-dns.sh      # *.takos.test → 127.0.0.1
```

After `ca-install.sh` Chrome trusts the Pebble-issued certs (no green-lock warning). After `configure-dns.sh` the host
resolves `accounts.takos.test`, `app.takos.test`, etc. via CoreDNS.

## Smoke flow A — accounts OIDC discovery

1. Navigate: `https://accounts.takos.test/.well-known/openid-configuration`
2. Expect: 200 with valid OIDC config JSON, `issuer` = `https://accounts.takos.test`
3. Verify cert chain: chrome:lock → certificate → root = `Pebble Root CA`

## Smoke flow B — kernel admin probe

1. Navigate: `https://kernel.takos.test/health`
2. Expect with `--profile postgres`: 200 with `{"ok":true,"service":"takosumi","domains":["core","deploy"]}`
3. Expect with `--profile workers`: 200 from the Takosumi kernel Worker routed through Cloudflare Worker bindings

## Smoke flow C — Takosumi kernel Worker probe

1. Navigate with `--profile postgres`: `https://kernel-worker.takos.test/healthz`
2. Navigate with `--profile workers`: `https://kernel.takos.test/healthz`
3. Expect: 200 with `{"ok":true,"provider":"cloudflare-worker"}`
4. Navigate with the same host: `/storage/healthz`
5. Expect: 200 with `{"ok":true,"storage":"cloudflare-d1-r2"}`
6. Navigate with the same host: `/coordination/healthz`
7. Expect: 200 with `{"ok":true,"role":"coordination"}`

## Smoke flow D — takos-app login (the canonical UX path)

1. Navigate: `https://app.takos.test/admin` (or whichever path initiates OIDC)
2. Expect: redirect to `https://accounts.takos.test/oauth/authorize?client_id=takos-app&...`
3. Complete login (use the test user seeded by accounts on first run, or create one via the Accounts admin if available)
4. Expect: redirect back to `https://app.takos.test/oauth/callback?code=...`
5. Expect: app sets a session cookie and shows the admin dashboard

## Smoke flow E — dynamic deploy subdomain

(Only after Phase 3 route-registrar is wired and a deployment with a route has been applied.)

1. POST a manifest that allocates `<id>.app.takos.test`:
   ```bash
   curl -k --cacert caddy/runtime/pebble-issuance-root.pem \
     --resolve kernel.takos.test:443:127.0.0.1 \
     -H "Authorization: Bearer local-substrate-deploy-token" \
     --data-binary @fixtures/manifest.hello-selfhost.yml \
     https://kernel.takos.test/v1/deployments
   ```
2. Wait ~5s for route-registrar to mirror the route into Caddy admin API
3. Navigate to the assigned subdomain in Chrome
4. Expect: the deployed service responds (e.g., nginx default page)

## Failure flow F — public-DNS deny

1. POST `manifest.fail-public-dns.yml` (asks for Route53 record)
2. Expect: HTTP 400 with `provider_not_registered` (the connector is not even imported in the local-substrate factory)
3. `tcpdump -i any port 443` on the host while POSTing — verify zero outbound packets to `acme-v02.api.letsencrypt.org`
   or AWS Route53 endpoints

## Notes

- The `--cacert` flag is needed only for `curl` from inside the local-substrate dir — Chrome uses the system trust store
  after `ca-install.sh`.
- If Pebble is restarted (down -v then up.sh) the issuance root regenerates and `ca-install.sh` must be re-run — host
  trust is invalidated otherwise.
